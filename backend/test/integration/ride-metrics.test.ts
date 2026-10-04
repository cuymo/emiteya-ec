// Métricas del RIDE (add-document-archive, design D14): duración del render separada de la espera,
// fallos por código acotado y autorizados sin RIDE. Nunca bytes, XML, claves completas, datos del
// comprador ni identificadores de empresa.
import { Registry } from "@prometheus-io/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "../../src/generated/prisma/client.ts";
import { registerRideMetrics } from "../../src/modules/fiscal/infrastructure/archive/ride-metrics.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertFiscalCompany, type FiscalCompany } from "./fiscal-harness.ts";
import { insertDocument, sha256 } from "./transmission-harness.ts";

describe("métricas del RIDE", () => {
  let db: MigratedSchema;
  let prisma: PrismaClient;
  let company: FiscalCompany;

  beforeAll(async () => {
    db = await createMigratedSchema("ride_metrics");
    prisma = db.database.prisma;
    company = await insertFiscalCompany(prisma, "Empresa Métricas", 1);
  });

  afterAll(async () => {
    await db.drop();
  });

  it("publican render, espera, fallos acotados y autorizados sin RIDE, sin datos sensibles", async () => {
    const registry = new Registry();
    const observer = registerRideMetrics(registry, { prisma });
    const pending = await insertDocument(prisma, company, "AUTHORIZED");
    const withRide = await insertDocument(prisma, company, "AUTHORIZED");
    await insertDocument(prisma, company, "SIGNED");
    const pdf = Buffer.from("%PDF-1.3\n%%EOF\n");
    await prisma.documentArtifact.create({
      data: {
        companyId: company.companyId,
        documentId: withRide.id,
        kind: "RIDE_PDF",
        mediaType: "application/pdf",
        content: new Uint8Array(pdf),
        sizeBytes: pdf.length,
        sha256: sha256(pdf),
        metadata: {},
      },
    });
    observer.rendered(0.18);
    observer.waited(2.5);
    observer.failed("RIDE_GLYPH_MISSING");
    observer.failed("BUSY");
    observer.failed("UN_CODIGO_NO_PREVISTO");
    const text = await registry.metrics();
    expect(text).toMatch(/^documents_authorized_without_ride 1$/m);
    expect(text).toMatch(/^ride_render_duration_seconds_count 1$/m);
    expect(text).toMatch(/^ride_render_duration_seconds_bucket\{le="0.2"\} 1$/m);
    expect(text).toMatch(/^ride_job_wait_seconds_count 1$/m);
    expect(text).toMatch(/^ride_job_wait_seconds_bucket\{le="2"\} 0$/m);
    expect(text).toMatch(/^ride_render_failures_total\{code="RIDE_GLYPH_MISSING"\} 1$/m);
    expect(text).toMatch(/^ride_render_failures_total\{code="BUSY"\} 1$/m);
    expect(text).toMatch(/^ride_render_failures_total\{code="OTHER"\} 1$/m);
    for (const secret of [pending.accessKey, company.companyId, "CONSUMIDOR FINAL", "%PDF"]) {
      expect(text).not.toContain(secret);
    }
  });
});
