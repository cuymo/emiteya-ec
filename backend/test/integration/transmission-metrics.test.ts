// Métricas de la transmisión en /metrics (add-sri-transmission, tarea 12.1, design D21): jobs por
// tipo y estado y su antigüedad, comprobantes por estado, intentos, duración, códigos 70, 43 y 45,
// latencia de autorización y circuit breaker; sin XML, SOAP, claves ni datos de las empresas.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerTransmissionMetrics } from "../../src/modules/fiscal/infrastructure/transmission-metrics.ts";
import type { PrismaClient } from "../../src/generated/prisma/client.ts";
import { createPrismaJobStore } from "../../src/platform/jobs/prisma-job-store.ts";
import { buildTestApp } from "../helpers.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertFiscalCompany, type FiscalCompany } from "./fiscal-harness.ts";
import { insertDocument, type TestDocument } from "./transmission-harness.ts";

describe("métricas de la transmisión", () => {
  let db: MigratedSchema;
  let prisma: PrismaClient;
  let companies: FiscalCompany[];
  let documents: TestDocument[];

  beforeAll(async () => {
    db = await createMigratedSchema("transmission_metrics");
    prisma = db.database.prisma;
    companies = [
      await insertFiscalCompany(prisma, "Empresa A", 1),
      await insertFiscalCompany(prisma, "Empresa B", 1),
    ];
    documents = [
      await insertDocument(prisma, companies[0]!, "SIGNED"),
      await insertDocument(prisma, companies[0]!, "MANUAL_REVIEW"),
      await insertDocument(prisma, companies[1]!, "SIGNED"),
      await insertDocument(prisma, companies[1]!, "SEND_UNKNOWN"),
    ];
    const store = createPrismaJobStore(prisma, db.name);
    for (const document of [documents[0]!, documents[2]!]) {
      await store.enqueueIn(prisma, {
        companyId: document.companyId,
        type: "sri.transmit",
        dedupeKey: `sri.transmit:${document.id}`,
        documentId: document.id,
        runAt: new Date(Date.now() - 60_000),
        maxAttempts: 10,
      });
    }
  });

  afterAll(async () => {
    await db.drop();
  });

  it("aparecen en /metrics con sus valores y sin datos sensibles", async () => {
    const { app, metrics } = buildTestApp();
    const observer = registerTransmissionMetrics(metrics.registry, {
      prisma,
      breakerState: (environment, service) =>
        environment === "TEST" && service === "RECEPTION" ? "OPEN" : "CLOSED",
      now: () => new Date(Date.now() + 120_000),
    });
    observer.attempt("RECEPTION", "KEY_IN_PROCESS", 0.4, [
      {
        identifier: "70",
        message: "CLAVE DE ACCESO EN PROCESAMIENTO",
        additionalInformation: null,
        type: "ERROR",
      },
      {
        identifier: "35",
        message: "DOCUMENTO INVÁLIDO",
        additionalInformation: null,
        type: "ERROR",
      },
    ]);
    observer.attempt("AUTHORIZATION", "AUTHORIZED", 0.2, []);
    observer.authorized(42);

    const res = await request(app).get("/metrics");
    expect(res.status).toBe(200);
    const text = res.text;
    expect(text).toMatch(/^fiscal_jobs\{type="sri\.transmit",status="PENDING"\} 2$/m);
    expect(text).toMatch(/^fiscal_jobs_oldest_pending_age_seconds\{type="sri\.transmit"\} \d+/m);
    expect(text).toMatch(/^fiscal_documents\{state="SIGNED"\} 2$/m);
    expect(text).toMatch(/^fiscal_documents\{state="MANUAL_REVIEW"\} 1$/m);
    expect(text).toMatch(/^fiscal_documents\{state="SEND_UNKNOWN"\} 1$/m);
    expect(text).toMatch(/^sri_circuit_open\{service="RECEPTION",environment="TEST"\} 1$/m);
    expect(text).toMatch(
      /^sri_circuit_open\{service="AUTHORIZATION",environment="PRODUCTION"\} 0$/m,
    );
    expect(text).toMatch(
      /^sri_attempts_total\{operation="RECEPTION",outcome="KEY_IN_PROCESS"\} 1$/m,
    );
    expect(text).toMatch(/^sri_request_duration_seconds_count\{operation="AUTHORIZATION"\} 1$/m);
    expect(text).toMatch(/^sri_error_code_total\{code="70"\} 1$/m);
    expect(text).toMatch(/^sri_error_code_total\{code="other"\} 1$/m);
    expect(text).toMatch(/^invoice_authorization_latency_seconds_count 1$/m);

    for (const company of companies) expect(text).not.toContain(company.companyId);
    for (const document of documents) {
      expect(text).not.toContain(document.accessKey);
      expect(text).not.toContain(document.id);
    }
    expect(text).not.toMatch(/soap|<factura|Envelope|DOCUMENTO INVÁLIDO|company_id/i);
  });
});
