// Punto de emisión predeterminado propio y preparación para emitir (design D8, D9 y D12), para
// administradores y operadores.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuditLog } from "../../src/modules/audit/infrastructure/prisma-audit-log.ts";
import { createMember, type AuthApp } from "./auth-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertCompany } from "./fixtures.ts";
import { buildTaxpayerApp, sessionCookie } from "./taxpayer-harness.ts";

type Body = { data: Record<string, unknown> | null; error: { code: string; message: string } };
const bodyOf = (res: { body: unknown }) => res.body as Body;

describe("punto predeterminado y preparación para emitir", () => {
  let db: MigratedSchema;
  let api: AuthApp;
  let companyA: string;
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    db = await createMigratedSchema("account_status_api");
    api = buildTaxpayerApp(db);
    companyA = await insertCompany(db.database.prisma, "Empresa A");
    const companyB = await insertCompany(db.database.prisma, "Empresa B");
    for (const [key, companyId, email, role] of [
      ["adminA", companyA, "admin@a.ec", "ADMIN"],
      ["operatorA", companyA, "operador@a.ec", "OPERATOR"],
      ["adminB", companyB, "admin@b.ec", "ADMIN"],
    ] as const) {
      await createMember(api.uow, companyId, { name: key, email, role });
      cookies[key] = await sessionCookie(api.app, email);
    }
  });

  afterAll(async () => {
    await db.drop();
  });

  const call = (method: "get" | "post" | "put", path: string, who: string) =>
    request(api.app)[method](`/api/v1${path}`).set("Cookie", cookies[who]!);
  const status = async (who: string) =>
    bodyOf(await call("get", "/company/status", who)).data as {
      environment: string;
      displayName: string | null;
      readiness: { ready: boolean; checks: { key: string; status: string }[] };
    };

  describe("preparación para emitir", () => {
    it("una empresa nueva tiene los tres requisitos pendientes y está en Pruebas", async () => {
      for (const who of ["adminA", "operatorA"]) {
        const res = await call("get", "/company/status", who);
        expect(res.status, who).toBe(200);
        expect(bodyOf(res).data).toEqual({
          environment: "TEST",
          displayName: null,
          readiness: {
            ready: false,
            checks: [
              { key: "TAXPAYER_DATA", status: "PENDING" },
              { key: "EMISSION_POINT", status: "PENDING" },
              { key: "SIGNING_CERTIFICATE", status: "PENDING" },
            ],
          },
        });
      }
    });

    it("con datos y un punto disponible cumple dos requisitos y la firma sigue pendiente", async () => {
      await call("put", "/taxpayer", "adminA").send({
        ruc: "1790012345001",
        legalName: "Comercial Andina S.A.",
        headOfficeAddress: "Quito",
        accountingRequired: true,
        expectedVersion: null,
      });
      const first = await call("post", "/establishments", "adminA").send({
        code: "001",
        address: "Quito",
      });
      ids.first = (bodyOf(first).data as { id: string }).id;
      const second = await call("post", "/establishments", "adminA").send({
        code: "002",
        address: "Guayaquil",
      });
      ids.second = (bodyOf(second).data as { id: string }).id;
      for (const [key, establishment, code] of [
        ["p1", ids.first, "001"],
        ["p2", ids.first, "002"],
        ["p3", ids.second, "001"],
      ] as const) {
        const res = await call(
          "post",
          `/establishments/${establishment}/emission-points`,
          "adminA",
        ).send({ code });
        ids[key] = (bodyOf(res).data as { id: string }).id;
      }
      const current = await status("operatorA");
      expect(current.displayName).toBe("Comercial Andina S.A.");
      expect(current.readiness).toEqual({
        ready: false,
        checks: [
          { key: "TAXPAYER_DATA", status: "MET" },
          { key: "EMISSION_POINT", status: "MET" },
          { key: "SIGNING_CERTIFICATE", status: "PENDING" },
        ],
      });
    });

    it("el nombre visible es el nombre comercial cuando existe", async () => {
      await call("put", "/taxpayer", "adminA").send({
        ruc: "1790012345001",
        legalName: "Comercial Andina S.A.",
        tradeName: "Andina",
        headOfficeAddress: "Quito",
        accountingRequired: true,
        expectedVersion: 1,
      });
      expect((await status("adminA")).displayName).toBe("Andina");
    });
  });

  describe("punto predeterminado propio", () => {
    it("sin predeterminado responde null", async () => {
      const res = await call("get", "/me/default-emission-point", "operatorA");
      expect(res.status).toBe(200);
      expect(bodyOf(res).data).toBeNull();
    });

    it("administrador y operador eligen un punto disponible", async () => {
      for (const who of ["adminA", "operatorA"]) {
        const res = await call("put", "/me/default-emission-point", who).send({
          emissionPointId: ids.p2,
        });
        expect(res.status, who).toBe(200);
        expect(bodyOf(res).data).toEqual({
          establishment: { id: ids.first, code: "001", address: "Quito", status: "ACTIVE" },
          emissionPoint: { id: ids.p2, code: "002", status: "ACTIVE" },
          available: true,
        });
      }
      const res = await call("get", "/me/default-emission-point", "operatorA");
      expect(bodyOf(res).data).toMatchObject({ emissionPoint: { code: "002" }, available: true });
    });

    it("no se audita y GET /me conserva su lista permitida", async () => {
      const audit = createAuditLog(db.database.prisma);
      const before = (await audit.listForCompany(companyA)).length;
      for (const emissionPointId of [null, ids.p2]) {
        const res = await call("put", "/me/default-emission-point", "operatorA").send({
          emissionPointId,
        });
        expect(res.status).toBe(200);
      }
      expect(await audit.listForCompany(companyA)).toHaveLength(before);
      const me = await call("get", "/me", "operatorA");
      expect(Object.keys(bodyOf(me).data!).sort()).toEqual(["email", "name", "role"]);
    });

    it("un punto de otra empresa responde 404", async () => {
      const other = await call("post", "/establishments", "adminB").send({
        code: "001",
        address: "Cuenca",
      });
      const point = await call(
        "post",
        `/establishments/${(bodyOf(other).data as { id: string }).id}/emission-points`,
        "adminB",
      ).send({ code: "001" });
      const res = await call("put", "/me/default-emission-point", "operatorA").send({
        emissionPointId: (bodyOf(point).data as { id: string }).id,
      });
      expect(res.status).toBe(404);
      expect(bodyOf(res).error.code).toBe("EMISSION_POINT_NOT_FOUND");
    });

    it("un punto inactivo o de un establecimiento inactivo responde 409", async () => {
      await call("put", `/establishments/${ids.second}/status`, "adminA").send({
        status: "INACTIVE",
      });
      const ofInactive = await call("put", "/me/default-emission-point", "operatorA").send({
        emissionPointId: ids.p3,
      });
      expect(ofInactive.status).toBe(409);
      expect(bodyOf(ofInactive).error.code).toBe("EMISSION_POINT_UNAVAILABLE");
      await call(
        "put",
        `/establishments/${ids.first}/emission-points/${ids.p1}/status`,
        "adminA",
      ).send({ status: "INACTIVE" });
      const inactive = await call("put", "/me/default-emission-point", "operatorA").send({
        emissionPointId: ids.p1,
      });
      expect(inactive.status).toBe(409);
    });

    it("un predeterminado que deja de estar disponible se conserva como no disponible", async () => {
      await call(
        "put",
        `/establishments/${ids.first}/emission-points/${ids.p2}/status`,
        "adminA",
      ).send({ status: "INACTIVE" });
      const res = await call("get", "/me/default-emission-point", "operatorA");
      expect(bodyOf(res).data).toMatchObject({
        emissionPoint: { id: ids.p2, status: "INACTIVE" },
        available: false,
      });
    });

    it("sin puntos disponibles el requisito vuelve a quedar pendiente", async () => {
      const current = await status("adminA");
      expect(current.readiness.checks).toContainEqual({
        key: "EMISSION_POINT",
        status: "PENDING",
      });
    });

    it("el usuario quita su predeterminado", async () => {
      const res = await call("put", "/me/default-emission-point", "operatorA").send({
        emissionPointId: null,
      });
      expect(res.status).toBe(200);
      expect(bodyOf(res).data).toBeNull();
    });

    it("el predeterminado no cambia lo que el usuario ve ni sus permisos", async () => {
      const list = await call("get", "/establishments", "adminA");
      expect((bodyOf(list).data as unknown as unknown[]).length).toBe(2);
      const forbidden = await call("post", "/establishments", "operatorA").send({
        code: "005",
        address: "Loja",
      });
      expect(forbidden.status).toBe(403);
    });
  });
});
