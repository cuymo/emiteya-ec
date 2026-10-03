// Prueba end-to-end de add-fiscal-numbering (tarea 6.1) contra el backend real: arranca main.ts como
// proceso sobre un esquema vacío y recorre por HTTP el ajuste y la consulta. Las reservas usan la
// operación interna, como hará la emisión (no tiene ruta HTTP, design D4), con el ambiente vigente
// de la empresa que publica la API.
import { randomUUID } from "node:crypto";
import type { FiscalSequenceView } from "@facturador/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSequentialReservation } from "../../src/modules/fiscal/application/reservation.ts";
import { createFiscalUnitOfWork } from "../../src/modules/fiscal/infrastructure/unit-of-work.ts";
import { startE2eBackend, type E2eBackend } from "./e2e-backend.ts";

const ADMIN = { email: "admin@e2e-secuenciales.ec", password: "contrasena-admin-e2e-1" };

describe("flujo completo de la numeración fiscal", () => {
  let backend: E2eBackend;

  beforeAll(async () => {
    backend = await startE2eBackend({ label: "end_to_end_numbering", admin: ADMIN });
  }, 120_000);

  afterAll(async () => {
    await backend?.stop();
  });

  async function signIn(email: string, password: string) {
    const { status, cookie } = await backend.signIn(email, password);
    expect(status).toBe(200);
    return cookie;
  }

  async function api<T>(method: string, path: string, cookie: string, body?: unknown) {
    const res = await backend.fetchApi(method, path, cookie, body);
    const json = (await res.json()) as { data: T; error?: { code: string } };
    return { status: res.status, data: json.data, error: json.error };
  }

  it("separa Pruebas y Producción, conserva cada secuencia y audita solo los ajustes", async () => {
    const admin = await signIn(ADMIN.email, ADMIN.password);
    const registered = await api<{ version: number }>("PUT", "/taxpayer", admin, {
      ruc: "1790012345001",
      legalName: "Comercial Andina S.A.",
      headOfficeAddress: "Av. Amazonas N24-03, Quito",
      accountingRequired: true,
      expectedVersion: null,
    });
    expect(registered.status).toBe(200);
    const establishment = await api<{ id: string }>("POST", "/establishments", admin, {
      code: "001",
      address: "Av. Amazonas N24-03, Quito",
    });
    const point = await api<{ id: string }>(
      "POST",
      `/establishments/${establishment.data.id}/emission-points`,
      admin,
      { code: "001" },
    );
    expect(point.status).toBe(201);
    const counterPath = (environment: string) =>
      `/establishments/${establishment.data.id}/emission-points/${point.data.id}/sequences/${environment}/01`;

    // La emisión reserva con el ambiente vigente que publica la empresa.
    const companyId = (await backend.db.database.prisma.organization.findFirstOrThrow()).id;
    const reservation = createSequentialReservation(
      createFiscalUnitOfWork(backend.db.database.prisma),
    );
    async function reserveInvoice() {
      const { data } = await api<{ environment: "TEST" | "PRODUCTION" }>(
        "GET",
        "/company/status",
        admin,
      );
      return reservation.reserve({
        companyId,
        environment: data.environment,
        establishmentId: establishment.data.id,
        emissionPointId: point.data.id,
        documentType: "01",
        reservedBy: null,
        correlationId: randomUUID(),
      });
    }

    // 1. El administrador fija en 1501 el siguiente secuencial de factura en Producción.
    const adjusted = await api<FiscalSequenceView>("PUT", counterPath("PRODUCTION"), admin, {
      nextNumber: 1501,
      expectedNextNumber: 1,
    });
    expect(adjusted).toMatchObject({
      status: 200,
      data: { environment: "PRODUCTION", nextNumber: 1501, lastReserved: null, exhausted: false },
    });

    // 2. En Pruebas se reservan las facturas 1 y 2.
    expect((await reserveInvoice()).documentNumber).toBe("001-001-000000001");
    expect((await reserveInvoice()).documentNumber).toBe("001-001-000000002");

    // 3. La empresa pasa a Producción y la siguiente reserva recibe 1501.
    const production = await api<{ version: number }>("PUT", "/taxpayer/environment", admin, {
      environment: "PRODUCTION",
      expectedVersion: registered.data.version,
    });
    expect(production.status).toBe(200);
    expect((await reserveInvoice()).documentNumber).toBe("001-001-000001501");

    // 4. De vuelta en Pruebas, la siguiente recibe 3.
    const back = await api("PUT", "/taxpayer/environment", admin, {
      environment: "TEST",
      expectedVersion: production.data.version,
    });
    expect(back.status).toBe(200);
    expect((await reserveInvoice()).documentNumber).toBe("001-001-000000003");

    const listed = async (environment: string) =>
      (
        await api<FiscalSequenceView[]>(
          "GET",
          `/fiscal-sequences?environment=${environment}`,
          admin,
        )
      ).data.find((view) => view.documentType === "01");
    expect(await listed("TEST")).toMatchObject({ nextNumber: 4, lastReserved: 3 });
    expect(await listed("PRODUCTION")).toMatchObject({ nextNumber: 1502, lastReserved: 1501 });

    // 5. El ajuste a un número reservado se rechaza sin cambiar el contador.
    const rejected = await api("PUT", counterPath("TEST"), admin, {
      nextNumber: 2,
      expectedNextNumber: 4,
      reason: "Reutilizar un número",
    });
    expect(rejected).toMatchObject({ status: 409, error: { code: "SEQUENCE_NUMBER_RESERVED" } });
    expect(await listed("TEST")).toMatchObject({ nextNumber: 4, lastReserved: 3 });

    // 6. El rastro de auditoría contiene el ajuste; ni las reservas ni el rechazo se auditan.
    const events = await backend.db.database.prisma.auditEvent.findMany({
      orderBy: { occurredAt: "asc" },
    });
    expect(events.map((event) => event.action)).toEqual([
      "company.provisioned",
      "taxpayer.configured",
      "establishment.created",
      "emission_point.created",
      "fiscal_sequence.adjusted",
      "taxpayer.environment_changed",
      "taxpayer.environment_changed",
    ]);
    const adjustment = events.find((event) => event.action === "fiscal_sequence.adjusted");
    expect(adjustment).toMatchObject({ actorType: "USER" });
    expect(adjustment?.changes).toMatchObject({
      environment: "PRODUCTION",
      establishmentCode: "001",
      emissionPointCode: "001",
      documentType: "01",
      "nextNumber.from": 1,
      "nextNumber.to": 1501,
      decrease: false,
    });
  });
});
