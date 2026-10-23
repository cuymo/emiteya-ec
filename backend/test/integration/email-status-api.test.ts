// Correos no enviados a la vista (add-email-delivery, design D10; spec email-delivery, «Correos no
// enviados a la vista», y document-archive, «Filtros de la bandeja»): la bandeja filtra por el
// último envío fallido y muestra el estado del último envío de cada fila; el conteo del aviso baja
// cuando un reenvío se acepta; un valor inválido se rechaza; y la empresa B no ve los de la A.
import request from "../support/http-client.ts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DocumentListItem } from "@facturador/contracts";
import { createEmailStatusSource } from "../../src/modules/email/infrastructure/email-status-source.ts";
import { archiveCompany, buildArchiveApp, type ArchiveCompany } from "./archive-api-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertDocument, type TestDocument } from "./transmission-harness.ts";

type Body = { data: DocumentListItem[]; error: { code: string } };
const bodyOf = (res: { body: unknown }) => res.body as Body;

describe("correos no enviados a la vista", () => {
  let db: MigratedSchema;
  let api: ReturnType<typeof buildArchiveApp>;
  let a: ArchiveCompany;
  let b: ArchiveCompany;
  let failed: TestDocument;
  let retried: TestDocument;
  let sent: TestDocument;
  let silent: TestDocument;
  let foreignFailed: TestDocument;
  let clock = new Date("2026-10-23T15:00:00Z");

  const delivery = (document: TestDocument, status: string, environment = "PRODUCTION") => {
    clock = new Date(clock.getTime() + 1_000);
    const final = status !== "PENDING" && status !== "RETRYING";
    return db.database.prisma.emailDelivery.create({
      data: {
        companyId: document.companyId,
        documentId: document.id,
        origin: "MANUAL",
        requestedBy: a.adminId,
        idempotencyKey: `${document.id}-${clock.getTime()}`,
        requestFingerprint: "a".repeat(64),
        environment,
        status,
        ...(status === "SENT" ? { sentAt: clock } : {}),
        ...(final ? { finishedAt: clock } : {}),
        ...(status === "FAILED" ? { failureCode: "AUTH_REJECTED" } : {}),
        createdAt: clock,
      },
    });
  };
  const list = (company: ArchiveCompany, query: Record<string, string> = {}) =>
    request(api.app)
      .get("/api/v1/documents")
      .query({ pageSize: "100", ...query })
      .set("Cookie", company.cookies.operator);

  beforeAll(async () => {
    db = await createMigratedSchema("email_status_api");
    api = buildArchiveApp(db);
    a = await archiveCompany(db, api, "Correo Estado A");
    b = await archiveCompany(db, api, "Correo Estado B");
    const authorized = (company: ArchiveCompany) =>
      insertDocument(db.database.prisma, company, "AUTHORIZED", { environment: "PRODUCTION" });
    failed = await authorized(a);
    retried = await authorized(a);
    sent = await authorized(a);
    silent = await authorized(a);
    foreignFailed = await authorized(b);
    await delivery(failed, "FAILED");
    await delivery(retried, "FAILED");
    await delivery(sent, "SENT");
    await delivery(foreignFailed, "FAILED");
  });

  afterAll(async () => {
    await db?.drop();
  });

  it("cada fila muestra el estado de su último envío, o null sin envíos", async () => {
    const items = bodyOf(await list(a)).data;
    const statusOf = (document: TestDocument) =>
      items.find((item) => item.id === document.id)?.email ?? null;
    expect(statusOf(failed)).toEqual({ status: "FAILED" });
    expect(statusOf(sent)).toEqual({ status: "SENT" });
    expect(statusOf(silent)).toBeNull();
  });

  it("el filtro deja solo los comprobantes cuyo último envío falló, de la empresa", async () => {
    const ids = bodyOf(await list(a, { emailStatus: "FAILED" })).data.map((item) => item.id);
    expect(ids.sort()).toEqual([failed.id, retried.id].sort());
    expect(ids).not.toContain(foreignFailed.id);
  });

  it("el conteo del aviso baja cuando un reenvío se acepta", async () => {
    const source = createEmailStatusSource(db.database.prisma, db.name);
    expect(await source.countFailedDocuments(a.companyId, "PRODUCTION")).toBe(2);
    expect(await source.countFailedDocuments(a.companyId, "TEST")).toBe(0);
    await delivery(retried, "SENT");
    expect(await source.countFailedDocuments(a.companyId, "PRODUCTION")).toBe(1);
    const ids = bodyOf(await list(a, { emailStatus: "FAILED" })).data.map((item) => item.id);
    expect(ids).toEqual([failed.id]);
    expect(await source.countFailedDocuments(b.companyId, "PRODUCTION")).toBe(1);
  });

  it("un estado del correo desconocido se rechaza sin consultar", async () => {
    const res = await list(a, { emailStatus: "DELIVERED" });
    expect(res.status).toBe(400);
  });
});
