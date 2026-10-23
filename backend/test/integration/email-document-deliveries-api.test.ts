// Envíos de un comprobante por la API (add-email-delivery, design D10 y D11; spec email-delivery,
// «Historial de envíos de un comprobante», «Reenvío manual» y «Permisos del correo»; audit-trail,
// «Auditoría del correo»): el historial ordenado con sus intentos y sin datos técnicos, las
// direcciones propuestas, el reenvío idempotente (la misma solicitud dos veces, la misma clave con
// otro cuerpo, dos a la vez), sus rechazos, Pruebas, los permisos y el aislamiento por empresa.
import { randomUUID } from "node:crypto";
import request from "../support/http-client.ts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EmailDeliveryView, EmailRecipientsView } from "@facturador/contracts";
import { EMAIL_SEND_JOB_TYPE } from "../../src/modules/email/application/automatic.ts";
import { createPrismaJobStore, type JobStore } from "../../src/platform/jobs/prisma-job-store.ts";
import { startSmtpServer, type SmtpTestServer } from "../support/smtp-test-server.ts";
import { createMember } from "./auth-harness.ts";
import { tamperSnapshot } from "./credit-notes-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { buildEmailApp } from "./email-harness.ts";
import { insertFiscalCompany, type FiscalCompany } from "./fiscal-harness.ts";
import { insertGuideParty } from "./shipping-guide-harness.ts";
import { sessionCookie } from "./taxpayer-harness.ts";
import { insertDocument, sha256, type TestDocument } from "./transmission-harness.ts";

type Body<T> = { data: T; error: { code: string; message: string } };
const bodyOf = <T>(res: { body: unknown }) => res.body as Body<T>;
const PDF = Buffer.from("%PDF-1.3\n%RIDE de prueba\n%%EOF\n");

describe("envíos de un comprobante", () => {
  let db: MigratedSchema;
  let api: ReturnType<typeof buildEmailApp>;
  let disabled: ReturnType<typeof buildEmailApp>;
  let store: JobStore;
  let server: SmtpTestServer;
  let a: FiscalCompany;
  let b: FiscalCompany;
  let invoice: TestDocument;
  let pending: TestDocument;
  let testing: TestDocument;
  let foreign: TestDocument;
  const cookies: Record<string, string> = {};

  const call = (who: string, method: "get" | "post", path: string) =>
    request(api.app)[method](`/api/v1${path}`).set("Cookie", cookies[who]!);
  const resend = (who: string, document: TestDocument, recipients: unknown, key = randomUUID()) =>
    call(who, "post", `/documents/${document.id}/email-deliveries`)
      .set("Idempotency-Key", key)
      .send({ recipients });
  const audits = () =>
    db.database.prisma.auditEvent.findMany({
      where: { companyId: a.companyId, action: "email.resent" },
      orderBy: { occurredAt: "asc" },
    });
  const drain = async () => {
    const handler = api.email().handlers[EMAIL_SEND_JOB_TYPE]!;
    for (let round = 0; round < 5; round++) {
      const jobs = await store.claim({
        owner: "prueba",
        types: [EMAIL_SEND_JOB_TYPE],
        limit: 10,
        leaseMs: 60_000,
        now: new Date(),
      });
      if (jobs.length === 0) return;
      for (const job of jobs) {
        await handler.run(job, { signal: new AbortController().signal, now: () => new Date() });
      }
    }
  };
  const authorizedWithFiles = async (
    company: FiscalCompany,
    environment: "TEST" | "PRODUCTION",
    partyId: string | null,
  ) => {
    const document = await insertDocument(db.database.prisma, company, "AUTHORIZED", {
      environment,
    });
    for (const [kind, mediaType, content] of [
      [
        "AUTHORIZED_XML",
        "application/xml",
        Buffer.from(`<comprobante>${document.accessKey}</comprobante>`),
      ],
      ["RIDE_PDF", "application/pdf", PDF],
    ] as const) {
      await db.database.prisma.documentArtifact.create({
        data: {
          companyId: company.companyId,
          documentId: document.id,
          kind,
          mediaType,
          content: new Uint8Array(content),
          sizeBytes: content.length,
          sha256: sha256(content),
          metadata: {},
        },
      });
    }
    await tamperSnapshot(db.database.prisma, db.name, document.id, (snapshot) => ({
      ...snapshot,
      issuer: { legalName: "Ferretería Andina", tradeName: null },
      buyer: { partyId, consumerFinal: false },
    }));
    return document;
  };
  const configure = (company: FiscalCompany) =>
    db.database.prisma.emailSettings.create({
      data: {
        companyId: company.companyId,
        host: "127.0.0.1",
        port: server.port,
        security: "NONE",
        fromName: "Ferretería Andina",
        fromAddress: "facturas@andina.ec",
        autoSend: true,
        testRecipient: "revision@andina.ec",
        updatedBy: company.adminId,
      },
    });

  beforeAll(async () => {
    server = await startSmtpServer({ disabledCommands: ["STARTTLS"] });
    db = await createMigratedSchema("email_document_deliveries");
    api = buildEmailApp(db, { policy: { deliveryEnabled: true, plaintextAllowed: true } });
    disabled = buildEmailApp(db, { policy: { deliveryEnabled: false, plaintextAllowed: true } });
    store = createPrismaJobStore(db.database.prisma, db.name);
    a = await insertFiscalCompany(db.database.prisma, "Correo A", 1);
    b = await insertFiscalCompany(db.database.prisma, "Correo B", 1);
    for (const [name, company, email, role] of [
      ["adminA", a, "admin@a.ec", "ADMIN"],
      ["operatorA", a, "operador@a.ec", "OPERATOR"],
      ["adminB", b, "admin@b.ec", "ADMIN"],
    ] as const) {
      await createMember(api.uow, company.companyId, { name, email, role });
      cookies[name] = await sessionCookie(api.app, email);
    }
    await configure(a);
    await configure(b);
    const buyer = await insertGuideParty(db.database.prisma, a, "1790012345001");
    await db.database.prisma.partyEmail.createMany({
      data: ["compras@cliente.ec", "contabilidad@cliente.ec"].map((address, index) => ({
        partyId: buyer,
        companyId: a.companyId,
        position: index + 1,
        address,
      })),
    });
    invoice = await authorizedWithFiles(a, "PRODUCTION", buyer);
    testing = await authorizedWithFiles(a, "TEST", buyer);
    pending = await insertDocument(db.database.prisma, a, "SIGNED", { environment: "PRODUCTION" });
    foreign = await authorizedWithFiles(b, "PRODUCTION", null);
  });

  afterAll(async () => {
    await db?.drop();
    await server?.close();
  });

  it("propone los correos vigentes del receptor, también al operador", async () => {
    const res = await call("operatorA", "get", `/documents/${invoice.id}/email-recipients`);
    expect(res.status).toBe(200);
    expect(bodyOf<EmailRecipientsView>(res).data).toEqual({
      recipients: ["compras@cliente.ec", "contabilidad@cliente.ec"],
      environment: "PRODUCTION",
      testRedirect: false,
      testRecipient: "revision@andina.ec",
    });
    const test = await call("adminA", "get", `/documents/${testing.id}/email-recipients`);
    expect(bodyOf<EmailRecipientsView>(test).data).toMatchObject({
      environment: "TEST",
      testRedirect: true,
    });
  });

  it("el operador reenvía a una dirección: sale el correo y queda auditado", async () => {
    const res = await resend("operatorA", invoice, ["pagos@cliente.ec"]);
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(bodyOf<EmailDeliveryView>(res).data).toMatchObject({
      origin: "MANUAL",
      requestedBy: { name: "operatorA" },
      status: "PENDING",
      recipients: [{ address: "pagos@cliente.ec", outcome: null, reason: null }],
    });
    await drain();
    expect(server.messages.filter((m) => m.to.includes("pagos@cliente.ec"))).toHaveLength(1);
    expect((await audits()).at(-1)!.changes).toEqual({
      documentId: invoice.id,
      recipients: ["pagos@cliente.ec"],
      environment: "PRODUCTION",
      testRedirect: false,
    });
  });

  it("la misma solicitud dos veces deja un solo envío, un solo correo y un solo evento", async () => {
    const key = randomUUID();
    const before = (await audits()).length;
    const first = await resend("adminA", invoice, ["doble@cliente.ec"], key);
    const second = await resend("adminA", invoice, ["doble@cliente.ec"], key);
    expect([first.status, second.status]).toEqual([202, 202]);
    expect(bodyOf<EmailDeliveryView>(second).data.id).toBe(
      bodyOf<EmailDeliveryView>(first).data.id,
    );
    await drain();
    expect(server.messages.filter((m) => m.to.includes("doble@cliente.ec"))).toHaveLength(1);
    expect((await audits()).length).toBe(before + 1);
  });

  it("la misma clave con otro cuerpo se rechaza", async () => {
    const key = randomUUID();
    expect((await resend("adminA", invoice, ["uno@cliente.ec"], key)).status).toBe(202);
    const reused = await resend("adminA", invoice, ["otro@cliente.ec"], key);
    expect(reused.status).toBe(409);
    expect(bodyOf(reused).error.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("dos solicitudes iguales a la vez dejan un solo envío", async () => {
    const key = randomUUID();
    const results = await Promise.all([
      resend("adminA", invoice, ["simultaneo@cliente.ec"], key),
      resend("adminA", invoice, ["simultaneo@cliente.ec"], key),
    ]);
    expect(results.map((r) => r.status)).toEqual([202, 202]);
    expect(
      await db.database.prisma.emailDelivery.count({
        where: { companyId: a.companyId, idempotencyKey: key },
      }),
    ).toBe(1);
  });

  it("en Pruebas el reenvío va solo al correo de prueba", async () => {
    const res = await resend("adminA", testing, ["cliente@real.ec"]);
    expect(res.status).toBe(202);
    expect(bodyOf<EmailDeliveryView>(res).data).toMatchObject({
      testRedirect: true,
      recipients: [{ address: "revision@andina.ec", outcome: null, reason: null }],
    });
    await drain();
    expect(server.messages.filter((m) => m.to.includes("cliente@real.ec"))).toEqual([]);
  });

  it("rechaza direcciones inválidas, la falta de clave y un comprobante no autorizado", async () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `c${i}@cliente.ec`);
    for (const recipients of [[], eleven, ["no-es-correo"], ["a@b.ec", "A@B.EC"]]) {
      expect((await resend("adminA", invoice, recipients)).status, JSON.stringify(recipients)).toBe(
        400,
      );
    }
    const noKey = await call("adminA", "post", `/documents/${invoice.id}/email-deliveries`).send({
      recipients: ["a@b.ec"],
    });
    expect(noKey.status).toBe(400);
    expect(bodyOf(noKey).error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    const notAuthorized = await resend("adminA", pending, ["a@b.ec"]);
    expect(notAuthorized.status).toBe(409);
    expect(bodyOf(notAuthorized).error.code).toBe("DOCUMENT_NOT_AUTHORIZED");
  });

  it("con el envío apagado por el despliegue, el reenvío se rechaza sin conectar", async () => {
    const before = server.messages.length;
    const res = await request(disabled.app)
      .post(`/api/v1/documents/${invoice.id}/email-deliveries`)
      .set("Cookie", cookies.adminA!)
      .set("Idempotency-Key", randomUUID())
      .send({ recipients: ["apagado@cliente.ec"] });
    expect(res.status).toBe(409);
    expect(bodyOf(res).error.code).toBe("EMAIL_DELIVERY_DISABLED");
    expect(server.messages.length).toBe(before);
  });

  it("el historial va del más reciente al más antiguo, con sus intentos y sin datos técnicos", async () => {
    const res = await call("operatorA", "get", `/documents/${invoice.id}/email-deliveries`);
    expect(res.status).toBe(200);
    const history = bodyOf<EmailDeliveryView[]>(res).data;
    expect(history.length).toBeGreaterThanOrEqual(3);
    const times = history.map((entry) => entry.createdAt);
    expect([...times].sort().reverse()).toEqual(times);
    const sent = history.find((entry) => entry.recipients[0]?.address === "pagos@cliente.ec")!;
    expect(sent).toMatchObject({
      status: "SENT",
      requestedBy: { name: "operatorA" },
      attempts: [{ number: 1, outcome: "SENT", smtpCode: 250 }],
    });
    const json = JSON.stringify(res.body);
    for (const leak of ["127.0.0.1", "detail", "messageId", "Ferretería Andina <", "password"]) {
      expect(json).not.toContain(leak);
    }
  });

  it("un comprobante de otra empresa no existe para ninguna operación", async () => {
    for (const res of [
      await call("adminA", "get", `/documents/${foreign.id}/email-deliveries`),
      await call("adminA", "get", `/documents/${foreign.id}/email-recipients`),
      await resend("adminA", foreign, ["a@b.ec"]),
    ]) {
      expect(res.status).toBe(404);
      expect(bodyOf(res).error.code).toBe("DOCUMENT_NOT_FOUND");
    }
  });

  it("sin sesión no responde con datos", async () => {
    for (const res of [
      await request(api.app).get(`/api/v1/documents/${invoice.id}/email-deliveries`),
      await request(api.app).get(`/api/v1/documents/${invoice.id}/email-recipients`),
      await request(api.app)
        .post(`/api/v1/documents/${invoice.id}/email-deliveries`)
        .set("Idempotency-Key", randomUUID())
        .send({ recipients: ["a@b.ec"] }),
    ]) {
      expect(res.status).toBe(401);
    }
  });
});
