// Establecimientos y puntos de emisión contra PostgreSQL (design D7 y D11): aislamiento por
// empresa, códigos únicos con altas simultáneas, estado deseado sin eventos repetidos y disponibilidad.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuditLog } from "../../src/modules/audit/infrastructure/prisma-audit-log.ts";
import { createAuthorizer } from "../../src/modules/identity/application/authorization.ts";
import type { RequestContext } from "../../src/modules/identity/application/request-context.ts";
import type { SecurityEvent } from "../../src/modules/identity/application/security-events.ts";
import { createMembershipReader } from "../../src/modules/identity/infrastructure/prisma-memberships.ts";
import { createEstablishments } from "../../src/modules/taxpayer/application/establishments.ts";
import { isEmissionPointAvailable } from "../../src/modules/taxpayer/domain/emission-structure.ts";
import { createEstablishmentRepository } from "../../src/modules/taxpayer/infrastructure/prisma-establishments.ts";
import { createTaxpayerUnitOfWork } from "../../src/modules/taxpayer/infrastructure/unit-of-work.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertCompany, insertMember } from "./fixtures.ts";

describe("establecimientos y puntos de emisión", () => {
  let db: MigratedSchema;
  let companyA: string;
  let companyB: string;
  const users: Record<string, string> = {};
  const events: SecurityEvent[] = [];

  const ctx = (user: string, companyId: string): RequestContext => ({
    userId: users[user]!,
    companyId,
    role: "ADMIN",
    requestId: randomUUID(),
  });

  const service = () => {
    const prisma = db.database.prisma;
    return createEstablishments({
      uow: createTaxpayerUnitOfWork(prisma),
      establishments: createEstablishmentRepository(prisma),
      authorizer: createAuthorizer({
        memberships: createMembershipReader(prisma),
        securityEvents: { emit: (event) => void events.push(event) },
      }),
    });
  };

  const auditOf = (companyId: string) =>
    createAuditLog(db.database.prisma).listForCompany(companyId);

  beforeAll(async () => {
    db = await createMigratedSchema("establishments");
    companyA = await insertCompany(db.database.prisma, "Empresa A");
    companyB = await insertCompany(db.database.prisma, "Empresa B");
    users.adminA = (
      await insertMember(db.database.prisma, companyA, { name: "Ana", role: "ADMIN" })
    ).userId;
    users.adminB = (
      await insertMember(db.database.prisma, companyB, { name: "Beto", role: "ADMIN" })
    ).userId;
  });

  afterAll(async () => {
    await db.drop();
  });

  describe("establecimientos", () => {
    it("crea un establecimiento activo con su evento", async () => {
      const created = await service().createEstablishment(ctx("adminA", companyA), {
        code: "001",
        address: "Av. Amazonas N24-03, Quito",
      });
      expect(created).toMatchObject({ code: "001", status: "ACTIVE", emissionPoints: [] });
      const [event] = await auditOf(companyA);
      expect(event).toMatchObject({
        action: "establishment.created",
        changes: {
          establishmentId: created.id,
          establishmentCode: "001",
          "address.to": "Av. Amazonas N24-03, Quito",
        },
      });
    });

    it("rechaza un código existente, activo o inactivo, sin crear ni auditar", async () => {
      const inactive = await service().createEstablishment(ctx("adminA", companyA), {
        code: "009",
        address: "Bodega",
      });
      await service().changeEstablishmentStatus(ctx("adminA", companyA), inactive.id, {
        status: "INACTIVE",
      });
      const before = (await auditOf(companyA)).length;
      for (const code of ["001", "009"]) {
        await expect(
          service().createEstablishment(ctx("adminA", companyA), { code, address: "Otra" }),
        ).rejects.toMatchObject({ code: "ESTABLISHMENT_CODE_TAKEN", status: 409 });
      }
      expect(await auditOf(companyA)).toHaveLength(before);
    });

    it("dos altas simultáneas del mismo código dejan un solo establecimiento", async () => {
      const results = await Promise.allSettled(
        ["Norte", "Sur"].map((address) =>
          service().createEstablishment(ctx("adminA", companyA), { code: "002", address }),
        ),
      );
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(
        (results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason,
      ).toMatchObject({
        code: "ESTABLISHMENT_CODE_TAKEN",
      });
      expect(
        await db.database.prisma.establishment.count({
          where: { companyId: companyA, code: "002" },
        }),
      ).toBe(1);
    });

    it("el mismo código en otra empresa es otro establecimiento", async () => {
      const other = await service().createEstablishment(ctx("adminB", companyB), {
        code: "001",
        address: "Cuenca",
      });
      expect(other.code).toBe("001");
    });

    it("corrige la dirección con su evento y sin evento si no cambia", async () => {
      const [first] = await service().list(ctx("adminA", companyA));
      const updated = await service().updateEstablishment(ctx("adminA", companyA), first!.id, {
        address: "Av. 6 de Diciembre, Quito",
      });
      expect(updated).toMatchObject({ code: "001", address: "Av. 6 de Diciembre, Quito" });
      const [event] = await auditOf(companyA);
      expect(event).toMatchObject({
        action: "establishment.updated",
        changes: {
          establishmentCode: "001",
          "address.from": "Av. Amazonas N24-03, Quito",
          "address.to": "Av. 6 de Diciembre, Quito",
        },
      });
      const count = (await auditOf(companyA)).length;
      await service().updateEstablishment(ctx("adminA", companyA), first!.id, {
        address: "Av. 6 de Diciembre, Quito",
      });
      expect(await auditOf(companyA)).toHaveLength(count);
    });

    it("un establecimiento de otra empresa responde como inexistente y emite un evento", async () => {
      const [establishmentB] = await service().list(ctx("adminB", companyB));
      const before = events.length;
      await expect(
        service().updateEstablishment(ctx("adminA", companyA), establishmentB!.id, {
          address: "Robada",
        }),
      ).rejects.toMatchObject({ code: "ESTABLISHMENT_NOT_FOUND", status: 404 });
      await expect(
        service().changeEstablishmentStatus(ctx("adminA", companyA), establishmentB!.id, {
          status: "INACTIVE",
        }),
      ).rejects.toMatchObject({ status: 404 });
      expect(events.slice(before).map((event) => event.type)).toEqual([
        "authorization_denied",
        "authorization_denied",
      ]);
      const [unchanged] = await service().list(ctx("adminB", companyB));
      expect(unchanged).toMatchObject({ address: "Cuenca", status: "ACTIVE" });
    });

    it("cada empresa lista solo sus establecimientos, ordenados por código", async () => {
      const codesA = (await service().list(ctx("adminA", companyA))).map((e) => e.code);
      const codesB = (await service().list(ctx("adminB", companyB))).map((e) => e.code);
      expect(codesA).toEqual(["001", "002", "009"]);
      expect(codesB).toEqual(["001"]);
    });
  });

  describe("puntos de emisión", () => {
    it("admite el mismo código en dos establecimientos y lo audita", async () => {
      const [first, second] = await service().list(ctx("adminA", companyA));
      const a = await service().createEmissionPoint(ctx("adminA", companyA), first!.id, {
        code: "001",
      });
      const b = await service().createEmissionPoint(ctx("adminA", companyA), second!.id, {
        code: "001",
      });
      expect(a.point.code).toBe("001");
      expect(b.point.code).toBe("001");
      const [event] = await auditOf(companyA);
      expect(event).toMatchObject({
        action: "emission_point.created",
        changes: { establishmentCode: "002", emissionPointCode: "001" },
      });
    });

    it("rechaza un código existente en el mismo establecimiento", async () => {
      const [first] = await service().list(ctx("adminA", companyA));
      await expect(
        service().createEmissionPoint(ctx("adminA", companyA), first!.id, { code: "001" }),
      ).rejects.toMatchObject({ code: "EMISSION_POINT_CODE_TAKEN", status: 409 });
    });

    it("dos altas simultáneas del mismo punto dejan una sola fila", async () => {
      const [first] = await service().list(ctx("adminA", companyA));
      const results = await Promise.allSettled(
        [1, 2].map(() =>
          service().createEmissionPoint(ctx("adminA", companyA), first!.id, { code: "002" }),
        ),
      );
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(
        await db.database.prisma.emissionPoint.count({
          where: { establishmentId: first!.id, code: "002" },
        }),
      ).toBe(1);
    });

    it("un punto creado en un establecimiento inactivo no está disponible", async () => {
      const establishments = await service().list(ctx("adminA", companyA));
      const inactive = establishments.find((e) => e.code === "009")!;
      const { point, establishment } = await service().createEmissionPoint(
        ctx("adminA", companyA),
        inactive.id,
        { code: "001" },
      );
      expect(point.status).toBe("ACTIVE");
      expect(isEmissionPointAvailable(point, establishment)).toBe(false);
    });

    it("desactiva y reactiva un punto con sus eventos y sin evento repetido", async () => {
      const [first] = await service().list(ctx("adminA", companyA));
      const point = first!.emissionPoints.find((p) => p.code === "001")!;
      const off = await service().changeEmissionPointStatus(
        ctx("adminA", companyA),
        first!.id,
        point.id,
        { status: "INACTIVE" },
      );
      expect(off.point.status).toBe("INACTIVE");
      expect((await auditOf(companyA))[0]).toMatchObject({
        action: "emission_point.deactivated",
        changes: { emissionPointCode: "001", "status.from": "ACTIVE", "status.to": "INACTIVE" },
      });
      const count = (await auditOf(companyA)).length;
      await service().changeEmissionPointStatus(ctx("adminA", companyA), first!.id, point.id, {
        status: "INACTIVE",
      });
      expect(await auditOf(companyA)).toHaveLength(count);
      const on = await service().changeEmissionPointStatus(
        ctx("adminA", companyA),
        first!.id,
        point.id,
        { status: "ACTIVE" },
      );
      expect(on.point.status).toBe("ACTIVE");
      expect((await auditOf(companyA))[0]!.action).toBe("emission_point.reactivated");
    });

    it("un punto pedido bajo otro establecimiento responde como inexistente", async () => {
      const [first, second] = await service().list(ctx("adminA", companyA));
      const point = first!.emissionPoints[0]!;
      await expect(
        service().changeEmissionPointStatus(ctx("adminA", companyA), second!.id, point.id, {
          status: "INACTIVE",
        }),
      ).rejects.toMatchObject({ code: "EMISSION_POINT_NOT_FOUND", status: 404 });
    });

    it("desactivar un establecimiento deja sus puntos no disponibles y reactivarlo los devuelve", async () => {
      const [first] = await service().list(ctx("adminA", companyA));
      const off = await service().changeEstablishmentStatus(ctx("adminA", companyA), first!.id, {
        status: "INACTIVE",
      });
      expect(off.emissionPoints.every((p) => !isEmissionPointAvailable(p, off))).toBe(true);
      expect(off.emissionPoints.map((p) => p.status)).toEqual(["ACTIVE", "ACTIVE"]);
      expect((await auditOf(companyA))[0]).toMatchObject({
        action: "establishment.deactivated",
        changes: { "status.from": "ACTIVE", "status.to": "INACTIVE" },
      });
      const count = (await auditOf(companyA)).length;
      await service().changeEstablishmentStatus(ctx("adminA", companyA), first!.id, {
        status: "INACTIVE",
      });
      expect(await auditOf(companyA)).toHaveLength(count);
      const on = await service().changeEstablishmentStatus(ctx("adminA", companyA), first!.id, {
        status: "ACTIVE",
      });
      expect(on.emissionPoints.every((p) => isEmissionPointAvailable(p, on))).toBe(true);
      expect((await auditOf(companyA))[0]!.action).toBe("establishment.reactivated");
    });
  });
});
