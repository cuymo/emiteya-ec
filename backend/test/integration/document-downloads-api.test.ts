// Descargas verificadas, solicitud de impresión e historial de entregas sobre HTTP
// (add-document-archive, tareas 8.1 y 8.2, design D8 y D9): los bytes exactos guardados con sus
// cabeceras y su nombre determinista; nada sale si la integridad falla; la impresión es una acción
// explícita; cada entrega queda en un historial de solo agregado, sin auditoría y sin bytes.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DeliveryView, DocumentDeliveriesView } from "@facturador/contracts";
import type { PrismaClient } from "../../src/generated/prisma/client.ts";
import { archiveCompany, buildArchiveApp, type ArchiveCompany } from "./archive-api-harness.ts";
import { corruptArtifact } from "./archive-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertDocument, sha256, signedXmlOf, type TestDocument } from "./transmission-harness.ts";

const PDF = Buffer.from("%PDF-1.3\n%RIDE de prueba\n%%EOF\n");
const binary = (res: request.Response) => res.body as Buffer;
function binaryParser(res: request.Response, done: (error: Error | null, body: Buffer) => void) {
  const stream = res as unknown as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  stream.on("data", (chunk: Buffer) => chunks.push(chunk));
  stream.on("end", () => done(null, Buffer.concat(chunks)));
}

describe("descargas, impresión y entregas sobre HTTP", () => {
  let db: MigratedSchema;
  let prisma: PrismaClient;
  let api: ReturnType<typeof buildArchiveApp>;
  let a: ArchiveCompany;
  let b: ArchiveCompany;

  const get = (company: ArchiveCompany, path: string, requestId?: string) => {
    const req = request(api.app)
      .get(`/api/v1/documents/${path}`)
      .set("Cookie", company.cookies.operator)
      .buffer(true)
      .parse(binaryParser);
    return requestId ? req.set("X-Request-Id", requestId) : req;
  };
  const print = (company: ArchiveCompany, documentId: string) =>
    request(api.app)
      .post(`/api/v1/documents/${documentId}/print-requests`)
      .set("Cookie", company.cookies.operator);
  const deliveriesOf = (documentId: string) =>
    prisma.documentDeliveryEvent.findMany({
      where: { documentId },
      orderBy: { occurredAt: "asc" },
    });
  const jsonOf = (res: request.Response) =>
    JSON.parse(binary(res).toString("utf8")) as { error: { code: string } };
  const artifact = (document: TestDocument, kind: string, content: Buffer) =>
    prisma.documentArtifact.create({
      data: {
        companyId: document.companyId,
        documentId: document.id,
        kind,
        mediaType: kind === "RIDE_PDF" ? "application/pdf" : "application/xml",
        content: new Uint8Array(content),
        sizeBytes: content.length,
        sha256: sha256(content),
        metadata: {},
      },
    });
  /** Autorizado con su XML autorizado y su RIDE. */
  async function authorizedWithRide(company: ArchiveCompany = a) {
    const document = await insertDocument(prisma, company, "AUTHORIZED");
    await artifact(document, "AUTHORIZED_XML", signedXmlOf(document.accessKey));
    await artifact(document, "RIDE_PDF", PDF);
    return document;
  }

  beforeAll(async () => {
    db = await createMigratedSchema("document_downloads");
    prisma = db.database.prisma;
    api = buildArchiveApp(db);
    a = await archiveCompany(db, api, "Empresa A");
    b = await archiveCompany(db, api, "Empresa B");
  });

  afterAll(async () => {
    await db.drop();
  });

  describe("descargas verificadas", () => {
    it("sirve el RIDE guardado con sus cabeceras y registra la descarga", async () => {
      const document = await authorizedWithRide();
      const res = await get(a, `${document.id}/ride`, "req-descarga-ride-1");
      expect(res.status).toBe(200);
      expect(binary(res).equals(PDF)).toBe(true);
      expect(sha256(binary(res))).toBe(sha256(PDF));
      expect(res.headers).toMatchObject({
        "content-type": "application/pdf",
        "content-length": String(PDF.length),
        "content-disposition": `attachment; filename="factura-${document.documentNumber}.pdf"`,
        "x-content-type-options": "nosniff",
        "cache-control": "private, no-store",
        etag: `"${sha256(PDF)}"`,
      });
      expect(await deliveriesOf(document.id)).toMatchObject([
        {
          companyId: a.companyId,
          event: "DOWNLOAD",
          artifactKind: "RIDE_PDF",
          artifactSha256: sha256(PDF),
          actorUserId: a.operatorId,
          requestId: "req-descarga-ride-1",
        },
      ]);
    });

    it("sirve el XML autorizado y el XML firmado, cada uno con su nombre", async () => {
      const document = await authorizedWithRide();
      const authorized = await get(a, `${document.id}/authorized-xml`);
      expect(authorized.status).toBe(200);
      expect(authorized.headers["content-type"]).toBe("application/xml");
      expect(authorized.headers["content-disposition"]).toBe(
        `attachment; filename="factura-${document.documentNumber}-autorizado.xml"`,
      );
      const signed = await get(a, `${document.id}/signed-xml`);
      expect(signed.status).toBe(200);
      expect(binary(signed).equals(signedXmlOf(document.accessKey))).toBe(true);
      expect(signed.headers["content-disposition"]).toBe(
        `attachment; filename="factura-${document.documentNumber}-firmado.xml"`,
      );
      expect((await deliveriesOf(document.id)).map((d) => [d.event, d.artifactKind])).toEqual([
        ["DOWNLOAD", "AUTHORIZED_XML"],
        ["DOWNLOAD", "SIGNED_XML"],
      ]);
    });

    it("un documento no disponible responde así, también al pedir imprimir, sin entrega", async () => {
      const pending = await insertDocument(prisma, a, "AUTHORIZED");
      const reserved = await insertDocument(prisma, a, "RESERVED");
      for (const [document, path] of [
        [pending, "ride"],
        [pending, "authorized-xml"],
        [reserved, "signed-xml"],
      ] as const) {
        const res = await get(a, `${document.id}/${path}`);
        expect(res.status, path).toBe(404);
        expect(jsonOf(res).error.code).toBe("DOCUMENT_NOT_AVAILABLE");
      }
      const printing = await print(a, pending.id);
      expect(printing.status).toBe(404);
      expect((printing.body as { error: { code: string } }).error.code).toBe(
        "DOCUMENT_NOT_AVAILABLE",
      );
      expect(await deliveriesOf(pending.id)).toEqual([]);
    });

    it("un artefacto alterado no sirve ningún byte, no acepta imprimir y no registra entrega", async () => {
      const document = await authorizedWithRide();
      await corruptArtifact(prisma, db.name, document.id, "RIDE_PDF");
      const res = await get(a, `${document.id}/ride`);
      expect(res.status).toBe(500);
      expect(jsonOf(res).error.code).toBe("ARTIFACT_INTEGRITY_FAILED");
      expect(binary(res).toString("latin1")).not.toContain("%PDF");
      expect((await print(a, document.id)).status).toBe(500);
      expect(await deliveriesOf(document.id)).toEqual([]);
      expect(api.errors.map((entry) => entry.message)).toContain(
        "un documento guardado no pasó la verificación de integridad y no se sirvió",
      );
      expect(await api.archiveMetrics.metrics()).toMatch(
        /^artifact_integrity_failures_total\{kind="RIDE_PDF"\} 2$/m,
      );
    });
  });

  describe("impresión como acción explícita", () => {
    it("registra la solicitud sin bytes; las lecturas del RIDE nunca registran una impresión", async () => {
      const document = await authorizedWithRide();
      const res = await print(a, document.id);
      expect(res.status).toBe(201);
      const data = (res.body as { data: { id: string; occurredAt: string } }).data;
      expect(Object.keys(data).sort()).toEqual(["id", "occurredAt"]);
      // La interfaz pide después el mismo RIDE: queda además su descarga.
      for (let i = 0; i < 3; i++) expect((await get(a, `${document.id}/ride`)).status).toBe(200);
      expect((await deliveriesOf(document.id)).map((d) => d.event)).toEqual([
        "PRINT_REQUESTED",
        "DOWNLOAD",
        "DOWNLOAD",
        "DOWNLOAD",
      ]);
      expect(await api.archiveMetrics.metrics()).toMatch(
        /^document_deliveries_total\{event="PRINT_REQUESTED"\} \d+$/m,
      );
    });
  });

  it("un HEAD no sirve el documento ni registra una entrega", async () => {
    const document = await authorizedWithRide();
    for (const path of ["ride", "authorized-xml", "signed-xml"]) {
      const res = await request(api.app)
        .head(`/api/v1/documents/${document.id}/${path}`)
        .set("Cookie", a.cookies.operator);
      expect(res.status).toBe(405);
      expect(res.headers.allow).toBe("GET");
    }
    expect(await deliveriesOf(document.id)).toEqual([]);
  });

  describe("sesión, empresa y auditoría", () => {
    it("sin sesión, o con un comprobante de otra empresa, no hay datos ni entrega", async () => {
      const foreign = await authorizedWithRide(b);
      expect((await request(api.app).get(`/api/v1/documents/${foreign.id}/ride`)).status).toBe(401);
      expect(
        (await request(api.app).post(`/api/v1/documents/${foreign.id}/print-requests`)).status,
      ).toBe(401);
      for (const path of ["ride", "authorized-xml", "signed-xml"]) {
        const res = await get(a, `${foreign.id}/${path}`);
        expect(res.status, path).toBe(404);
        expect(jsonOf(res).error.code).toBe("DOCUMENT_NOT_FOUND");
      }
      expect((await print(a, foreign.id)).status).toBe(404);
      const history = await request(api.app)
        .get(`/api/v1/documents/${foreign.id}/deliveries`)
        .set("Cookie", a.cookies.admin);
      expect(history.status).toBe(404);
      expect(await deliveriesOf(foreign.id)).toEqual([]);
    });

    it("ninguna entrega registra un evento de auditoría", async () => {
      const before = await prisma.auditEvent.count();
      const document = await authorizedWithRide();
      await get(a, `${document.id}/ride`);
      await print(a, document.id);
      expect(await prisma.auditEvent.count()).toBe(before);
    });
  });

  describe("historial de entregas", () => {
    it("muestra las entregas de la más reciente a la más antigua, sin bytes ni hashes", async () => {
      const document = await authorizedWithRide();
      await get(a, `${document.id}/signed-xml`);
      await print(a, document.id);
      await get(a, `${document.id}/ride`);
      const res = await request(api.app)
        .get(`/api/v1/documents/${document.id}/deliveries`)
        .set("Cookie", a.cookies.admin);
      expect(res.status).toBe(200);
      const view = (res.body as { data: DocumentDeliveriesView }).data;
      expect(view.total).toBe(3);
      expect(view.items.map((item: DeliveryView) => [item.event, item.artifactKind])).toEqual([
        ["DOWNLOAD", "RIDE_PDF"],
        ["PRINT_REQUESTED", "RIDE_PDF"],
        ["DOWNLOAD", "SIGNED_XML"],
      ]);
      for (const item of view.items) {
        expect(Object.keys(item).sort()).toEqual([
          "actorName",
          "artifactKind",
          "event",
          "id",
          "occurredAt",
        ]);
        expect(item.actorName).toBe("Operador Empresa A");
      }
      const raw = JSON.stringify(view);
      expect(raw).not.toContain(sha256(PDF));
      expect(raw).not.toMatch(/EMAIL|RECEIVED|PRINTED|DELIVERED/);
    });
  });
});
