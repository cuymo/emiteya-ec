// API de consulta y ajuste de secuenciales (design D9 a D12): permisos, aislamiento, reglas del
// ajuste, conflicto con una reserva, auditoría atómica y representación del contador agotado.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuditLog } from "../../src/modules/audit/infrastructure/prisma-audit-log.ts";
import { createMember, type AuthApp } from "./auth-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertCompany } from "./fixtures.ts";
import { adminContext, fiscalServices, reservationInput } from "./fiscal-harness.ts";
import { buildTaxpayerApp, sessionCookie } from "./taxpayer-harness.ts";

type View = {
  establishment: { id: string; code: string; status: string };
  emissionPoint: { id: string; code: string; status: string; available: boolean };
  environment: string;
  documentType: string;
  nextNumber: number | null;
  lastReserved: number | null;
  exhausted: boolean;
};
type Body = { data: unknown; error: { code: string; message: string } };
const bodyOf = (res: { body: unknown }) => res.body as Body;

describe("API de secuenciales", () => {
  let db: MigratedSchema;
  let api: AuthApp;
  let companyA: string;
  let adminAId: string;
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const call = (method: "get" | "put", path: string, who: string) =>
    request(api.app)[method](`/api/v1${path}`).set("Cookie", cookies[who]!);
  const adjustPath = (environment: string, documentType: string, point = "p1", est = "e1") =>
    `/establishments/${ids[est]}/emission-points/${ids[point]}/sequences/${environment}/${documentType}`;
  const keyOf = (
    environment: "TEST" | "PRODUCTION",
    documentType: "01" | "04" | "06",
    point = "p1",
    est = "e1",
  ) => ({
    companyId: companyA,
    environment,
    establishmentId: ids[est]!,
    emissionPointId: ids[point]!,
    documentType,
  });
  const reserve = (k: ReturnType<typeof keyOf>) =>
    fiscalServices(db.database.prisma).reservation.reserve(reservationInput(k));
  const list = async (environment: string, who = "adminA") =>
    bodyOf(await call("get", `/fiscal-sequences?environment=${environment}`, who)).data as View[];

  beforeAll(async () => {
    db = await createMigratedSchema("fiscal_api");
    api = buildTaxpayerApp(db);
    companyA = await insertCompany(db.database.prisma, "Empresa A");
    const companyB = await insertCompany(db.database.prisma, "Empresa B");
    for (const [name, companyId, email, role] of [
      ["adminA", companyA, "admin@a.ec", "ADMIN"],
      ["operatorA", companyA, "operador@a.ec", "OPERATOR"],
      ["adminB", companyB, "admin@b.ec", "ADMIN"],
    ] as const) {
      const userId = await createMember(api.uow, companyId, { name, email, role });
      if (name === "adminA") adminAId = userId;
      cookies[name] = await sessionCookie(api.app, email);
    }
    const prisma = db.database.prisma;
    for (const [est, point, code, companyId] of [
      ["e1", "p1", "001", companyA],
      ["e2", "p2", "002", companyA],
      ["eB", "pB", "001", companyB],
    ] as const) {
      const establishment = await prisma.establishment.create({
        data: { companyId, code, address: `Dirección ${code}` },
      });
      const emissionPoint = await prisma.emissionPoint.create({
        data: { companyId, establishmentId: establishment.id, code: "001" },
      });
      ids[est] = establishment.id;
      ids[point] = emissionPoint.id;
    }
  });

  afterAll(async () => {
    await db.drop();
  });

  describe("consulta (design D12)", () => {
    it("una empresa sin reservas ve cada punto con los seis tipos en su valor inicial", async () => {
      const views = await list("PRODUCTION");
      expect(views).toHaveLength(12);
      expect(views.slice(0, 6).map((view) => view.documentType)).toEqual([
        "01",
        "03",
        "04",
        "05",
        "06",
        "07",
      ]);
      expect(views[0]).toEqual({
        establishment: { id: ids.e1, code: "001", status: "ACTIVE" },
        emissionPoint: { id: ids.p1, code: "001", status: "ACTIVE", available: true },
        environment: "PRODUCTION",
        documentType: "01",
        nextNumber: 1,
        lastReserved: null,
        exhausted: false,
      });
    });

    it("muestra los valores tras reservar, con los ambientes por separado", async () => {
      await reserve(keyOf("TEST", "01"));
      await reserve(keyOf("TEST", "01"));
      expect((await list("TEST"))[0]).toMatchObject({ nextNumber: 3, lastReserved: 2 });
      expect((await list("PRODUCTION"))[0]).toMatchObject({ nextNumber: 1, lastReserved: null });
    });

    it("incluye los puntos no disponibles con su estado", async () => {
      await db.database.prisma.establishment.update({
        where: { id: ids.e2 },
        data: { active: false },
      });
      const views = await list("TEST");
      expect(views.find((view) => view.emissionPoint.id === ids.p2)).toMatchObject({
        establishment: { status: "INACTIVE" },
        emissionPoint: { status: "ACTIVE", available: false },
      });
    });

    it("rechaza un ambiente inválido y al operador, sin datos de otra empresa", async () => {
      expect((await call("get", "/fiscal-sequences?environment=STAGING", "adminA")).status).toBe(
        400,
      );
      const before = api.events.length;
      expect((await call("get", "/fiscal-sequences?environment=TEST", "operatorA")).status).toBe(
        403,
      );
      expect(api.events.slice(before).some((event) => event.type === "authorization_denied")).toBe(
        true,
      );
      const viewsB = await list("TEST", "adminB");
      expect(viewsB.every((view) => view.emissionPoint.id === ids.pB)).toBe(true);
    });
  });

  describe("ajuste (design D9 y D11)", () => {
    it("avanza el siguiente secuencial con su evento de auditoría", async () => {
      const res = await call("put", adjustPath("PRODUCTION", "01"), "adminA").send({
        nextNumber: 1501,
        expectedNextNumber: 1,
      });
      expect(res.status).toBe(200);
      expect(bodyOf(res).data).toMatchObject({ nextNumber: 1501, lastReserved: null });
      expect((await reserve(keyOf("PRODUCTION", "01"))).sequential).toBe(1501);
      const [event] = await createAuditLog(db.database.prisma).listForCompany(companyA);
      expect(event).toMatchObject({
        action: "fiscal_sequence.adjusted",
        actor: { type: "USER", userId: adminAId },
        changes: {
          environment: "PRODUCTION",
          establishmentCode: "001",
          emissionPointCode: "001",
          documentType: "01",
          "nextNumber.from": 1,
          "nextNumber.to": 1501,
          lastReserved: null,
          decrease: false,
        },
      });
    });

    it("rechaza un valor igual o menor que el último reservado y valores fuera de rango", async () => {
      const reserved = await call("put", adjustPath("TEST", "01"), "adminA").send({
        nextNumber: 2,
        expectedNextNumber: 3,
        reason: "Corregir",
      });
      expect(reserved.status).toBe(409);
      expect(bodyOf(reserved).error).toMatchObject({
        code: "SEQUENCE_NUMBER_RESERVED",
        message: "El último secuencial reservado es 2; el siguiente debe ser mayor.",
      });
      for (const nextNumber of [0, 1_000_000_000, 2.5]) {
        const res = await call("put", adjustPath("TEST", "01"), "adminA").send({
          nextNumber,
          expectedNextNumber: 3,
        });
        expect(res.status, String(nextNumber)).toBe(400);
      }
    });

    it("el mismo valor no cambia nada ni genera evento", async () => {
      const audit = createAuditLog(db.database.prisma);
      const before = (await audit.listForCompany(companyA)).length;
      const res = await call("put", adjustPath("TEST", "01"), "adminA").send({
        nextNumber: 3,
        expectedNextNumber: 3,
      });
      expect(res.status).toBe(200);
      expect(await audit.listForCompany(companyA)).toHaveLength(before);
    });

    it("un ajuste preparado sobre un valor que una reserva cambió es un conflicto", async () => {
      await reserve(keyOf("TEST", "01"));
      const res = await call("put", adjustPath("TEST", "01"), "adminA").send({
        nextNumber: 50,
        expectedNextNumber: 3,
      });
      expect(res.status).toBe(409);
      expect(bodyOf(res).error.code).toBe("SEQUENCE_CHANGED");
      expect((await list("TEST"))[0]).toMatchObject({ nextNumber: 4, lastReserved: 3 });
    });

    it("retroceder exige un motivo, que queda en el evento", async () => {
      await call("put", adjustPath("TEST", "01"), "adminA").send({
        nextNumber: 1000,
        expectedNextNumber: 4,
      });
      const withoutReason = await call("put", adjustPath("TEST", "01"), "adminA").send({
        nextNumber: 100,
        expectedNextNumber: 1000,
      });
      expect(withoutReason.status).toBe(400);
      expect(bodyOf(withoutReason).error.message).toBe("Retroceder el secuencial exige un motivo.");
      const withReason = await call("put", adjustPath("TEST", "01"), "adminA").send({
        nextNumber: 100,
        expectedNextNumber: 1000,
        reason: "Se avanzó de más",
      });
      expect(withReason.status).toBe(200);
      expect((await reserve(keyOf("TEST", "01"))).sequential).toBe(100);
      const events = await createAuditLog(db.database.prisma).listForCompany(companyA);
      const event = events.find((item) => item.changes?.["nextNumber.to"] === 100);
      expect(event?.changes).toMatchObject({
        "nextNumber.from": 1000,
        "nextNumber.to": 100,
        lastReserved: 3,
        decrease: true,
        reason: "Se avanzó de más",
      });
    });

    it("se puede ajustar un punto no disponible", async () => {
      const res = await call("put", adjustPath("TEST", "04", "p2", "e2"), "adminA").send({
        nextNumber: 20,
        expectedNextNumber: 1,
      });
      expect(res.status).toBe(200);
      expect(bodyOf(res).data).toMatchObject({
        nextNumber: 20,
        emissionPoint: { available: false },
      });
    });

    it("un contador agotado se muestra como agotado y no admite ajustes", async () => {
      await call("put", adjustPath("TEST", "06"), "adminA").send({
        nextNumber: 999_999_999,
        expectedNextNumber: 1,
      });
      await reserve(keyOf("TEST", "06"));
      const view = (await list("TEST")).find((item) => item.documentType === "06");
      expect(view).toMatchObject({ exhausted: true, nextNumber: null, lastReserved: 999_999_999 });
      const res = await call("put", adjustPath("TEST", "06"), "adminA").send({
        nextNumber: 999_999_999,
        expectedNextNumber: 999_999_999,
      });
      expect(res.status).toBe(409);
      expect(bodyOf(res).error.code).toBe("SEQUENCE_EXHAUSTED");
    });

    it("el operador recibe 403 y otra empresa o un punto bajo otro establecimiento, 404", async () => {
      const operator = await call("put", adjustPath("TEST", "01"), "operatorA").send({
        nextNumber: 500,
        expectedNextNumber: 101,
      });
      expect(operator.status).toBe(403);
      const before = api.events.length;
      const foreign = await call("put", adjustPath("TEST", "01", "pB", "eB"), "adminA").send({
        nextNumber: 500,
        expectedNextNumber: 1,
      });
      expect(foreign.status).toBe(404);
      expect(bodyOf(foreign).error.code).toBe("EMISSION_POINT_NOT_FOUND");
      const mismatch = await call("put", adjustPath("TEST", "01", "p1", "e2"), "adminA").send({
        nextNumber: 500,
        expectedNextNumber: 101,
      });
      expect(mismatch.status).toBe(404);
      expect(
        api.events.slice(before).filter((event) => event.type === "authorization_denied"),
      ).toHaveLength(2);
      const counterB = await db.database.prisma.fiscalSequence.findMany({
        where: { emissionPointId: ids.pB },
      });
      expect(counterB).toEqual([]);
    });

    it("rechaza companyId en el cuerpo", async () => {
      const res = await call("put", adjustPath("TEST", "01"), "adminA").send({
        nextNumber: 500,
        expectedNextNumber: 101,
        companyId: "otra",
      });
      expect(res.status).toBe(400);
    });

    it("un fallo al auditar revierte el ajuste", async () => {
      const failing = fiscalServices(db.database.prisma, {
        wrap: (uow) => ({
          run: (work) =>
            uow.run((scope) =>
              work({
                ...scope,
                audit: { append: () => Promise.reject(new Error("fallo inyectado")) },
              }),
            ),
        }),
      });
      const company = { companyId: companyA, adminId: adminAId, points: [] };
      await expect(
        failing.administration.adjust(
          adminContext(company),
          {
            establishmentId: ids.e1,
            emissionPointId: ids.p1,
            environment: "TEST",
            documentType: "01",
          },
          { nextNumber: 900, expectedNextNumber: 101 },
        ),
      ).rejects.toThrow("fallo inyectado");
      expect((await list("TEST"))[0]).toMatchObject({ nextNumber: 101 });
    });
  });
});
