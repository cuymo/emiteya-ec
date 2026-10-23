// API de terceros con dos empresas (add-parties-and-products, specs `parties` y `audit-trail`):
// alta con la identificación validada por el catálogo fiscal, unicidad por empresa con altas
// simultáneas, corrección con versión, desactivación como estado deseado, búsqueda sin tildes con
// orden estable, consumidor final protegido, permisos, aislamiento y auditoría.
import request from "../support/http-client.ts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PartyView } from "@facturador/contracts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { createMember } from "./auth-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertCompany } from "./fixtures.ts";
import { buildTaxpayerApp, sessionCookie } from "./taxpayer-harness.ts";

type Body = {
  data: PartyView & PartyView[];
  meta?: { page: number; pageSize: number; total: number };
  error: { code: string; message: string };
};
const bodyOf = (res: { body: unknown }) => res.body as Body;
// 10:00 del 3 de octubre de 2026 en Ecuador.
const NOW = new Date("2026-10-03T15:00:00Z");

describe("API de terceros", () => {
  let db: MigratedSchema;
  let api: ReturnType<typeof buildTaxpayerApp>;
  let companyA: string;
  let companyB: string;
  const cookies: Record<string, string> = {};

  const call = (who: string, method: "get" | "post" | "put" | "delete", path: string) =>
    request(api.app)[method](`/api/v1${path}`).set("Cookie", cookies[who]!);
  const create = (who: string, body: Record<string, unknown>) =>
    call(who, "post", "/parties").send(body);
  const list = async (who: string, query = "") =>
    bodyOf(await call(who, "get", `/parties${query}`));
  const audits = (companyId: string) =>
    db.database.prisma.auditEvent.findMany({
      where: { companyId, action: { startsWith: "party." } },
      orderBy: { occurredAt: "asc" },
    });
  const party = (overrides: Record<string, unknown> = {}) => ({
    identificationType: "04",
    identification: "1790012345001",
    legalName: "Comercial Andina S.A.",
    ...overrides,
  });
  async function created(who: string, overrides: Record<string, unknown>) {
    const res = await create(who, party(overrides));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return bodyOf(res).data;
  }

  beforeAll(async () => {
    db = await createMigratedSchema("parties_api");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    api = buildTaxpayerApp(db, { now: () => NOW });
    companyA = await insertCompany(db.database.prisma, "Empresa A");
    companyB = await insertCompany(db.database.prisma, "Empresa B");
    for (const [name, companyId, email, role] of [
      ["adminA", companyA, "admin@a.ec", "ADMIN"],
      ["adminA2", companyA, "admin2@a.ec", "ADMIN"],
      ["operatorA", companyA, "operador@a.ec", "OPERATOR"],
      ["adminB", companyB, "admin@b.ec", "ADMIN"],
    ] as const) {
      await createMember(api.uow, companyId, { name, email, role });
      cookies[name] = await sessionCookie(api.app, email);
    }
  });

  afterAll(async () => {
    await db.drop();
  });

  describe("catálogo único", () => {
    it("el operador registra un tercero activo con la denominación oficial de su tipo", async () => {
      const view = await created("operatorA", {});
      expect(view).toMatchObject({
        identificationType: "04",
        identificationTypeLabel: "RUC",
        identification: "1790012345001",
        legalName: "Comercial Andina S.A.",
        status: "ACTIVE",
        roles: [],
        systemRecord: null,
        version: 1,
        address: null,
      });
    });

    it("un tercero con varios roles es un solo registro en cada filtro; sin roles no aparece al filtrar", async () => {
      const both = await created("adminA", {
        identification: "1791111111001",
        legalName: "Ferretería Doble Rol",
        roles: ["SUPPLIER", "CUSTOMER"],
      });
      expect(both.roles).toEqual(["CUSTOMER", "SUPPLIER"]);
      for (const role of ["CUSTOMER", "SUPPLIER"]) {
        const ids = (await list("adminA", `?role=${role}&pageSize=100`)).data.map((p) => p.id);
        expect(ids.filter((id) => id === both.id)).toHaveLength(1);
      }
      const none = await created("adminA", {
        identification: "1792222222001",
        legalName: "Sin Rol Cía. Ltda.",
      });
      expect((await list("adminA", "?search=sin%20rol")).data.map((p) => p.id)).toContain(none.id);
      expect((await list("adminA", "?role=CUSTOMER&search=sin%20rol")).data).toEqual([]);
    });

    it("registra un tercero con dos correos, en su orden (add-email-delivery)", async () => {
      const view = await created("adminA", {
        identification: "1791212121001",
        emails: ["compras@cliente.ec", "contabilidad@cliente.ec"],
      });
      expect(view.emails).toEqual(["compras@cliente.ec", "contabilidad@cliente.ec"]);
      const read = await call("adminA", "get", `/parties/${view.id}`);
      expect(bodyOf(read).data.emails).toEqual(["compras@cliente.ec", "contabilidad@cliente.ec"]);
    });

    it("rechaza datos fuera de sus límites sin crear nada", async () => {
      const before = await db.database.prisma.party.count();
      for (const body of [
        party({ identification: "1793333333001", legalName: "" }),
        party({ identification: "1793333333001", legalName: "x".repeat(301) }),
        party({ identification: "1793333333001", emails: ["no-es-correo"] }),
        party({
          identification: "1793333333001",
          emails: ["a@x.ec", "b@x.ec", "c@x.ec", "d@x.ec"],
        }),
        party({ identification: "1793333333001", emails: ["a@x.ec", "A@X.EC"] }),
        party({ identification: "1793333333001", email: "a@x.ec" }),
      ]) {
        expect((await create("adminA", body)).status).toBe(400);
      }
      expect(await db.database.prisma.party.count()).toBe(before);
    });
  });

  describe("identificación", () => {
    it("acepta un RUC con formato válido aunque no cumpla un algoritmo de módulo", async () => {
      expect(
        (
          await create(
            "adminA",
            party({ identification: "1234567890001", legalName: "Sin Módulo" }),
          )
        ).status,
      ).toBe(201);
    });

    it("rechaza el formato inválido, el tipo reservado y un tipo inexistente", async () => {
      const short = await create(
        "adminA",
        party({ identificationType: "05", identification: "123456789" }),
      );
      expect(bodyOf(short).error).toMatchObject({ code: "PARTY_IDENTIFICATION_INVALID" });
      expect(bodyOf(short).error.message).toContain("CÉDULA");
      expect(
        bodyOf(
          await create(
            "adminA",
            party({ identificationType: "07", identification: "9999999999999" }),
          ),
        ).error.code,
      ).toBe("PARTY_IDENTIFICATION_RESERVED");
      expect(bodyOf(await create("adminA", party({ identificationType: "09" }))).error.code).toBe(
        "PARTY_IDENTIFICATION_TYPE_UNAVAILABLE",
      );
    });
  });

  describe("unicidad", () => {
    it("una identificación repetida, también la de un tercero desactivado, se rechaza con el existente", async () => {
      const repeated = await create("adminA", party());
      expect(bodyOf(repeated).error.code).toBe("PARTY_IDENTIFICATION_TAKEN");
      expect(bodyOf(repeated).error.message).toContain("Comercial Andina S.A.");
      const inactive = await created("adminA", {
        identification: "1794444444001",
        legalName: "Inactiva S.A.",
      });
      await call("adminA", "put", `/parties/${inactive.id}/status`).send({ status: "INACTIVE" });
      const again = await create("adminA", party({ identification: "1794444444001" }));
      expect(bodyOf(again).error.message).toContain("desactivado");
    });

    it("dos altas simultáneas con la misma identificación dejan exactamente un tercero", async () => {
      const body = party({ identification: "1795555555001", legalName: "Simultánea S.A." });
      const results = await Promise.all([create("adminA", body), create("adminA2", body)]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(results.find((r) => r.status === 409)!.body).toMatchObject({
        error: { code: "PARTY_IDENTIFICATION_TAKEN" },
      });
      expect(
        await db.database.prisma.party.count({
          where: { companyId: companyA, identification: "1795555555001" },
        }),
      ).toBe(1);
    });

    it("la misma identificación existe en otra empresa sin indicio de la primera", async () => {
      expect((await create("adminB", party())).status).toBe(201);
      const fromB = (await list("adminB", "?search=1790012345001")).data;
      expect(fromB).toHaveLength(1);
      expect(fromB[0]!.id).not.toBe((await list("adminA", "?search=1790012345001")).data[0]!.id);
    });
  });

  describe("corrección", () => {
    it("corrige con la versión vigente, rechaza una versión desactualizada y una identificación ocupada", async () => {
      const view = await created("adminA", {
        identification: "1796666666001",
        legalName: "Original S.A.",
      });
      const fixed = await call("adminA", "put", `/parties/${view.id}`).send(
        party({
          identification: "1796666666001",
          legalName: "Corregida S.A.",
          roles: ["CARRIER"],
          expectedVersion: 1,
        }),
      );
      expect(bodyOf(fixed).data).toMatchObject({
        legalName: "Corregida S.A.",
        roles: ["CARRIER"],
        version: 2,
      });
      const stale = await call("adminA2", "put", `/parties/${view.id}`).send(
        party({ identification: "1796666666001", legalName: "Pisada S.A.", expectedVersion: 1 }),
      );
      expect(bodyOf(stale).error.code).toBe("PARTY_CHANGED");
      const taken = await call("adminA", "put", `/parties/${view.id}`).send(
        party({
          identification: "1790012345001",
          legalName: "Corregida S.A.",
          roles: ["CARRIER"],
          expectedVersion: 2,
        }),
      );
      expect(bodyOf(taken).error.code).toBe("PARTY_IDENTIFICATION_TAKEN");
      expect(bodyOf(await call("adminA", "get", `/parties/${view.id}`)).data).toMatchObject({
        legalName: "Corregida S.A.",
        identification: "1796666666001",
        version: 2,
      });
    });

    it("dos correcciones simultáneas de la misma versión: se aplica exactamente una", async () => {
      const view = await created("adminA", {
        identification: "1797777777001",
        legalName: "Carrera S.A.",
      });
      const results = await Promise.all(
        ["Primera S.A.", "Segunda S.A."].map((legalName, i) =>
          call(i === 0 ? "adminA" : "adminA2", "put", `/parties/${view.id}`).send(
            party({ identification: "1797777777001", legalName, expectedVersion: 1 }),
          ),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(results.find((r) => r.status === 409)!.body).toMatchObject({
        error: { code: "PARTY_CHANGED" },
      });
      expect(bodyOf(await call("adminA", "get", `/parties/${view.id}`)).data.version).toBe(2);
    });
  });

  describe("desactivación", () => {
    it("desactiva, reactiva, repetir no cambia nada y no hay borrado", async () => {
      const view = await created("adminA", {
        identification: "1798888888001",
        legalName: "Ciclo S.A.",
      });
      const active = async () => (await list("adminA", "?search=ciclo")).data.map((p) => p.id);
      await call("adminA", "put", `/parties/${view.id}/status`).send({ status: "INACTIVE" });
      expect(await active()).toEqual([]);
      expect((await list("adminA", "?search=ciclo&status=INACTIVE")).data.map((p) => p.id)).toEqual(
        [view.id],
      );
      const again = await call("adminA", "put", `/parties/${view.id}/status`).send({
        status: "INACTIVE",
      });
      expect(bodyOf(again).data).toMatchObject({ status: "INACTIVE", version: 2 });
      await call("adminA", "put", `/parties/${view.id}/status`).send({ status: "ACTIVE" });
      expect(await active()).toEqual([view.id]);
      expect((await call("adminA", "delete", `/parties/${view.id}`)).status).toBe(404);
      expect(await db.database.prisma.party.count({ where: { id: view.id } })).toBe(1);
    });

    it("dos desactivaciones simultáneas producen un solo evento", async () => {
      const view = await created("adminA", {
        identification: "1799999999001",
        legalName: "Doble Baja S.A.",
      });
      await Promise.all([
        call("adminA", "put", `/parties/${view.id}/status`).send({ status: "INACTIVE" }),
        call("adminA2", "put", `/parties/${view.id}/status`).send({ status: "INACTIVE" }),
      ]);
      const events = (await audits(companyA)).filter(
        (e) =>
          e.action === "party.deactivated" &&
          (e.changes as { partyId?: string }).partyId === view.id,
      );
      expect(events).toHaveLength(1);
    });
  });

  describe("búsqueda y paginación", () => {
    it("por prefijo de identificación y por nombre sin tildes ni mayúsculas", async () => {
      for (const [identification, legalName] of [
        ["0102030405001", "García Hermanos"],
        ["0102030406001", "GARCIA DISTRIBUCIONES"],
        ["0102030407001", "garcía y asociados"],
      ]) {
        await created("adminA", { identification, legalName });
      }
      const byName = (await list("adminA", "?search=garcia")).data.map((p) => p.legalName).sort();
      expect(byName).toEqual(["GARCIA DISTRIBUCIONES", "García Hermanos", "garcía y asociados"]);
      expect((await list("adminA", "?search=17900")).data.map((p) => p.identification)).toEqual([
        "1790012345001",
      ]);
    });

    it("orden estable al recorrer las páginas aunque la razón social se repita", async () => {
      for (let i = 0; i < 5; i += 1) {
        await created("adminA", { identification: `050000000${i}001`, legalName: "Mismo Nombre" });
      }
      const walk = async () => {
        const ids: string[] = [];
        for (let page = 1; page <= 3; page += 1) {
          const body = await list("adminA", `?search=mismo%20nombre&pageSize=2&page=${page}`);
          expect(body.meta).toMatchObject({ page, pageSize: 2, total: 5 });
          ids.push(...body.data.map((p) => p.id));
        }
        return ids;
      };
      const first = await walk();
      expect(new Set(first).size).toBe(5);
      expect(await walk()).toEqual(first);
    });

    it("rechaza más de 100 por página y filtra por rol", async () => {
      expect((await call("adminA", "get", "/parties?pageSize=101")).status).toBe(400);
      const carriers = (await list("adminA", "?role=CARRIER&pageSize=100")).data;
      expect(carriers.length).toBeGreaterThan(0);
      expect(carriers.every((p) => p.roles.includes("CARRIER"))).toBe(true);
    });
  });

  describe("consumidor final", () => {
    it("aparece en la búsqueda como registro del sistema y la API no lo corrige ni lo desactiva", async () => {
      const found = (await list("adminA", "?search=consumidor")).data;
      expect(found).toHaveLength(1);
      const consumer = found[0]!;
      expect(consumer).toMatchObject({
        systemRecord: "CONSUMER_FINAL",
        status: "ACTIVE",
        identificationType: "07",
        identification: "9999999999999",
      });
      const fix = await call("adminA", "put", `/parties/${consumer.id}`).send({
        identificationType: "07",
        identification: "9999999999999",
        legalName: "OTRO",
        expectedVersion: consumer.version,
      });
      expect(bodyOf(fix).error.code).toBe("PARTY_SYSTEM_RECORD");
      const off = await call("adminA", "put", `/parties/${consumer.id}/status`).send({
        status: "INACTIVE",
      });
      expect(bodyOf(off).error.code).toBe("PARTY_SYSTEM_RECORD");
      for (const companyId of [companyA, companyB]) {
        const consumers = await db.database.prisma.party.findMany({
          where: { companyId, systemRecord: "CONSUMER_FINAL" },
        });
        expect(consumers).toHaveLength(1);
        expect(consumers[0]).toMatchObject({
          legalName: "CONSUMIDOR FINAL",
          status: "ACTIVE",
          version: 1,
        });
      }
    });
  });

  describe("permisos y aislamiento", () => {
    it("el operador no desactiva ni reactiva", async () => {
      const view = await created("adminA", {
        identification: "1780000000001",
        legalName: "Permisos S.A.",
      });
      const res = await call("operatorA", "put", `/parties/${view.id}/status`).send({
        status: "INACTIVE",
      });
      expect(res.status).toBe(403);
      expect(bodyOf(await call("adminA", "get", `/parties/${view.id}`)).data.status).toBe("ACTIVE");
    });

    it("un tercero de otra empresa responde como inexistente y no cambia", async () => {
      const fromB = await created("adminB", {
        identification: "1781111111001",
        legalName: "Solo de B",
      });
      expect(bodyOf(await call("adminA", "get", `/parties/${fromB.id}`)).error.code).toBe(
        "PARTY_NOT_FOUND",
      );
      expect(
        (
          await call("adminA", "put", `/parties/${fromB.id}`).send(
            party({ legalName: "X", expectedVersion: 1 }),
          )
        ).status,
      ).toBe(404);
      expect(
        (await call("adminA", "put", `/parties/${fromB.id}/status`).send({ status: "INACTIVE" }))
          .status,
      ).toBe(404);
      expect((await list("adminA", "?search=1781111111001")).data).toEqual([]);
      expect(bodyOf(await call("adminB", "get", `/parties/${fromB.id}`)).data).toMatchObject({
        legalName: "Solo de B",
        status: "ACTIVE",
        version: 1,
      });
    });

    it("un companyId en el cuerpo se rechaza sin crear nada", async () => {
      const res = await create(
        "adminA",
        party({ identification: "1782222222001", companyId: companyB }),
      );
      expect(res.status).toBe(400);
      expect(
        await db.database.prisma.party.count({ where: { identification: "1782222222001" } }),
      ).toBe(0);
    });
  });

  describe("auditoría", () => {
    it("registra el alta, la identificación anterior y nueva, y los campos de contacto sin sus valores", async () => {
      const view = await created("adminA", {
        identification: "1783333333001",
        legalName: "Auditada S.A.",
        emails: ["antes@auditada.ec"],
        phone: "022222222",
      });
      const fix = await call("adminA", "put", `/parties/${view.id}`).send(
        party({
          identification: "1783333334001",
          legalName: "Auditada S.A.",
          emails: ["despues@auditada.ec", "otro@auditada.ec"],
          phone: "023333333",
          expectedVersion: 1,
        }),
      );
      expect(fix.status).toBe(200);
      const events = (await audits(companyA)).filter(
        (e) => (e.changes as { partyId?: string }).partyId === view.id,
      );
      expect(events.map((e) => e.action)).toEqual(["party.created", "party.updated"]);
      expect(events[0]!.changes).toMatchObject({
        identificationType: "04",
        identification: "1783333333001",
        legalName: "Auditada S.A.",
        roles: [],
      });
      expect(events[1]!.changes).toEqual({
        partyId: view.id,
        "identification.from": "1783333333001",
        "identification.to": "1783333334001",
        changedFields: ["emails", "phone"],
      });
      const json = JSON.stringify(events);
      for (const secret of ["antes@auditada.ec", "despues@auditada.ec", "022222222", "023333333"]) {
        expect(json).not.toContain(secret);
      }
    });

    it("ni una corrección sin cambios, ni una rechazada, ni una desactivación repetida registran eventos", async () => {
      const view = await created("adminA", {
        identification: "1784444444001",
        legalName: "Quieta S.A.",
      });
      const count = async () => (await audits(companyA)).length;
      const before = await count();
      await call("adminA", "put", `/parties/${view.id}`).send(
        party({ identification: "1784444444001", legalName: "Quieta S.A.", expectedVersion: 1 }),
      );
      await call("adminA", "put", `/parties/${view.id}`).send(
        party({ identification: "1784444444001", legalName: "Otra", expectedVersion: 9 }),
      );
      await call("operatorA", "put", `/parties/${view.id}/status`).send({ status: "INACTIVE" });
      // Rechazada por validación y por identificación repetida.
      expect(
        (
          await call("adminA", "put", `/parties/${view.id}`).send(
            party({
              identification: "1784444444001",
              emails: ["no-es-correo"],
              expectedVersion: 1,
            }),
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await call("adminA", "put", `/parties/${view.id}`).send(
            party({
              identification: "1790012345001",
              legalName: "Quieta S.A.",
              expectedVersion: 1,
            }),
          )
        ).status,
      ).toBe(409);
      expect(await count()).toBe(before);
      await call("adminA", "put", `/parties/${view.id}/status`).send({ status: "INACTIVE" });
      await call("adminA", "put", `/parties/${view.id}/status`).send({ status: "INACTIVE" });
      expect(await count()).toBe(before + 1);
    });
  });
});
