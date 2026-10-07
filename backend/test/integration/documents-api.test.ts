// Bandeja de comprobantes sobre HTTP (add-document-archive, tarea 7.1, design D2 y D10): todos los
// estados desde la reserva y nunca borradores, los filtros combinables, el orden, los documentos
// disponibles de cada comprobante, el resumen, la sesión y el aislamiento por empresa. Los
// comprobantes se escriben directamente en las tablas.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DocumentListItem, DocumentSummaryView } from "@facturador/contracts";
import type { PrismaClient } from "../../src/generated/prisma/client.ts";
import { rideJob, RIDE_BACKOFF } from "../../src/modules/fiscal/application/archive/ride-jobs.ts";
import { createPrismaJobStore, type JobStore } from "../../src/platform/jobs/prisma-job-store.ts";
import { archiveCompany, buildArchiveApp, type ArchiveCompany } from "./archive-api-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertGuideParty, insertShippingGuide } from "./shipping-guide-harness.ts";
import { insertDocument, leasedJob, sha256, type TestDocument } from "./transmission-harness.ts";

type Body = {
  data: DocumentListItem[] & DocumentSummaryView;
  meta: { page: number; pageSize: number; total: number };
  error: { code: string; message: string };
};
const bodyOf = (res: { body: unknown }) => res.body as Body;
const PDF = Buffer.from("%PDF-1.3\n%%EOF\n");

describe("bandeja de comprobantes sobre HTTP", () => {
  let db: MigratedSchema;
  let prisma: PrismaClient;
  let store: JobStore;
  let api: ReturnType<typeof buildArchiveApp>;
  let a: ArchiveCompany;
  let b: ArchiveCompany;
  const docs: Record<string, TestDocument> = {};

  const list = (company: ArchiveCompany, query: Record<string, string> = {}) =>
    request(api.app).get("/api/v1/documents").query(query).set("Cookie", company.cookies.operator);
  const ids = (res: { body: unknown }) => bodyOf(res).data.map((item) => item.id);
  const artifact = (document: TestDocument, kind: string, content: Buffer, metadata = {}) =>
    prisma.documentArtifact.create({
      data: {
        companyId: document.companyId,
        documentId: document.id,
        kind,
        mediaType: kind === "RIDE_PDF" ? "application/pdf" : "application/xml",
        content: new Uint8Array(content),
        sizeBytes: content.length,
        sha256: sha256(content),
        metadata,
      },
    });

  beforeAll(async () => {
    db = await createMigratedSchema("documents_api");
    prisma = db.database.prisma;
    store = createPrismaJobStore(prisma, db.name);
    api = buildArchiveApp(db);
    a = await archiveCompany(db, api, "Empresa A");
    b = await archiveCompany(db, api, "Empresa B");
    const states = [
      "RESERVED",
      "SIGNED",
      "SEND_UNKNOWN",
      "RECEIVED",
      "RETURNED",
      "NOT_AUTHORIZED",
      "MANUAL_REVIEW",
    ];
    for (const state of states) docs[state] = await insertDocument(prisma, a, state);
    // Autorizados: con RIDE y XML autorizado, con el RIDE en preparación y con la generación
    // detenida.
    docs.ride = await insertDocument(prisma, a, "AUTHORIZED");
    await artifact(docs.ride, "AUTHORIZED_XML", Buffer.from("<autorizado/>"));
    await artifact(docs.ride, "RIDE_PDF", PDF, { source: { provenance: "AUTHORIZED_XML" } });
    docs.pending = await insertDocument(prisma, a, "AUTHORIZED");
    docs.stopped = await insertDocument(prisma, a, "AUTHORIZED");
    const job = await leasedJob(
      store,
      prisma,
      rideJob(docs.stopped, { maxAttempts: 5, backoff: RIDE_BACKOFF }, new Date()),
    );
    await store.stop(
      prisma,
      job,
      { code: "RIDE_GLYPH_MISSING", errorClass: "DETERMINISTIC" },
      new Date("2026-10-04T16:00:00Z"),
    );
    // Un borrador nunca aparece.
    await prisma.invoiceDraft.create({
      data: { companyId: a.companyId, createdBy: a.adminId, updatedBy: a.adminId },
    });
    // Filtros: otras fechas, otro receptor y otro punto.
    docs.sept30 = await insertDocument(prisma, a, "AUTHORIZED", { issueDate: "2026-09-30" });
    docs.oct01 = await insertDocument(prisma, a, "AUTHORIZED", { issueDate: "2026-10-01" });
    docs.oct15 = await insertDocument(prisma, a, "SIGNED", { issueDate: "2026-10-15" });
    docs.oct16 = await insertDocument(prisma, a, "SIGNED", { issueDate: "2026-10-16" });
    docs.buyer = await insertDocument(prisma, a, "SIGNED", {
      buyer: { identification: "0992877878001", name: "FERRETERIA EL PERNO CIA. LTDA." },
    });
    docs.point2 = await insertDocument(prisma, a, "AUTHORIZED", { point: 1 });
    docs.point2signed = await insertDocument(prisma, a, "SIGNED", { point: 1 });
    // Guías de remisión sin total ni comprador (add-shipping-guides, design D10): una con un solo
    // destinatario y otra con tres.
    const recipientOf = async (identification: string, name: string) => ({
      identification,
      name,
      partyId: await insertGuideParty(prisma, a, identification, { legalName: name }),
    });
    docs.guideSingle = await insertShippingGuide(prisma, a, "SIGNED", {
      recipients: [await recipientOf("0102030405", "María Pérez")],
    });
    docs.guideMany = await insertShippingGuide(prisma, a, "SIGNED", {
      recipients: [
        await recipientOf("1790012345001", "Comercial Andina S.A."),
        await recipientOf("0991234567001", "Distribuidora del Litoral"),
        await recipientOf("1712345678", "Juan Torres"),
      ],
    });
    // La empresa B tiene sus propios comprobantes.
    docs.other = await insertDocument(prisma, b, "AUTHORIZED", {
      buyer: { identification: "0992877878001", name: "FERRETERIA EL PERNO CIA. LTDA." },
    });
  });

  afterAll(async () => {
    await db.drop();
  });

  it("lista los comprobantes de la empresa en todos los estados, sin borradores", async () => {
    const res = await list(a, { pageSize: "100" });
    expect(res.status).toBe(200);
    const states = new Set(bodyOf(res).data.map((item) => item.state));
    expect([...states].sort()).toEqual(
      [
        "AUTHORIZED",
        "MANUAL_REVIEW",
        "NOT_AUTHORIZED",
        "RECEIVED",
        "RESERVED",
        "RETURNED",
        "SEND_UNKNOWN",
        "SIGNED",
      ].sort(),
    );
    const electronic = await prisma.electronicDocument.count({ where: { companyId: a.companyId } });
    expect(bodyOf(res).meta.total).toBe(electronic);
    expect(bodyOf(res).data.find((item) => item.id === docs.ride!.id)).toEqual({
      id: docs.ride!.id,
      documentType: "01",
      number: expect.stringMatching(/^001-001-\d{9}$/) as string,
      issueDate: "2026-10-04",
      buyer: { name: "CONSUMIDOR FINAL", identification: "9999999999999" },
      total: "11.5",
      recipients: null,
      state: "AUTHORIZED",
      transmissionStopped: false,
      documents: { ride: "AVAILABLE", authorizedXml: true, signedXml: true },
    });
  });

  it("ordena por fecha de emisión, de la más reciente a la más antigua, y pagina", async () => {
    const all = bodyOf(await list(a, { pageSize: "100" })).data;
    const dates = all.map((item) => item.issueDate);
    expect(dates).toEqual([...dates].sort().reverse());
    // En un mismo día, del emitido más tarde al más temprano.
    const created = new Map(
      (
        await prisma.electronicDocument.findMany({
          where: { id: { in: all.map((item) => item.id) } },
          select: { id: true, createdAt: true },
        })
      ).map((row) => [row.id, row.createdAt.getTime()]),
    );
    const busiest = Object.entries(Object.groupBy(all, (item) => item.issueDate)).sort(
      ([, x], [, y]) => y!.length - x!.length,
    )[0]![1]!;
    const sameDay = all.filter((item) => busiest.includes(item));
    expect(sameDay.length).toBeGreaterThan(5);
    const times = sameDay.map((item) => created.get(item.id)!);
    expect(times).toEqual([...times].sort((x, y) => y - x));
    const first = bodyOf(await list(a, { pageSize: "3", page: "1" })).data;
    const second = bodyOf(await list(a, { pageSize: "3", page: "2" })).data;
    expect([...first, ...second].map((item) => item.id)).toEqual(all.slice(0, 6).map((i) => i.id));
  });

  it("una empresa sin comprobantes tiene la bandeja vacía", async () => {
    const empty = await archiveCompany(db, api, "Empresa vacía");
    const res = await list(empty);
    expect(bodyOf(res)).toEqual({ data: [], meta: { page: 1, pageSize: 25, total: 0 } });
  });

  it("filtra por rango de fechas inclusivo", async () => {
    const res = await list(a, { from: "2026-10-01", to: "2026-10-15", pageSize: "100" });
    const found = ids(res);
    expect(found).toContain(docs.oct01!.id);
    expect(found).toContain(docs.oct15!.id);
    expect(found).not.toContain(docs.sept30!.id);
    expect(found).not.toContain(docs.oct16!.id);
  });

  it("combina establecimiento, punto y estado", async () => {
    const res = await list(a, {
      establishmentId: a.points[1]!.establishmentId,
      emissionPointId: a.points[1]!.emissionPointId,
      state: "AUTHORIZED",
    });
    expect(ids(res)).toEqual([docs.point2!.id]);
  });

  it("filtra por la identificación del receptor y por el número", async () => {
    expect(ids(await list(a, { identification: "0992877878001" }))).toEqual([docs.buyer!.id]);
    expect(ids(await list(a, { search: docs.oct16!.documentNumber }))).toEqual([docs.oct16!.id]);
    expect(ids(await list(a, { search: "perno" }))).toEqual([docs.buyer!.id]);
  });

  it("muestra la guía sin total con su único destinatario o el número de destinatarios", async () => {
    const res = await list(a, { documentType: "06" });
    expect(res.status).toBe(200);
    const byId = new Map(bodyOf(res).data.map((item) => [item.id, item]));
    expect(byId.get(docs.guideSingle!.id)).toMatchObject({
      buyer: null,
      total: null,
      recipients: { count: 1, name: "María Pérez" },
    });
    expect(byId.get(docs.guideMany!.id)).toMatchObject({
      buyer: null,
      total: null,
      recipients: { count: 3, name: null },
    });
    // Los demás tipos siguen con su comprador y su total, sin destinatarios.
    const invoices = bodyOf(await list(a, { documentType: "01", pageSize: "100" })).data;
    expect(invoices.length).toBeGreaterThan(0);
    for (const item of invoices) {
      expect(item.buyer).not.toBeNull();
      expect(item.total).not.toBeNull();
      expect(item.recipients).toBeNull();
    }
    const summary = await request(api.app)
      .get(`/api/v1/documents/${docs.guideMany!.id}`)
      .set("Cookie", a.cookies.operator);
    expect(summary.status).toBe(200);
    expect(bodyOf(summary).data).toMatchObject({
      total: null,
      recipients: { count: 3, name: null },
    });
    // Una guía firmada sin autorizar ofrece solo su XML firmado: ni RIDE ni XML autorizado.
    const signed = await request(api.app)
      .get(`/api/v1/documents/${docs.guideSingle!.id}`)
      .set("Cookie", a.cookies.operator);
    expect(bodyOf(signed).data).toMatchObject({
      state: "SIGNED",
      documents: { ride: "NOT_APPLICABLE", authorizedXml: false, signedXml: true },
    });
    for (const path of ["ride", "authorized-xml"]) {
      const unavailable = await request(api.app)
        .get(`/api/v1/documents/${docs.guideSingle!.id}/${path}`)
        .set("Cookie", a.cookies.operator);
      expect([path, unavailable.status], path).toEqual([path, 404]);
    }
  });

  it("la identificación y la búsqueda encuentran una guía por cualquiera de sus destinatarios", async () => {
    // El segundo y el tercer destinatario, no solo el primero.
    expect(ids(await list(a, { identification: "0991234567001" }))).toEqual([docs.guideMany!.id]);
    expect(ids(await list(a, { identification: "1712345678" }))).toEqual([docs.guideMany!.id]);
    expect(ids(await list(a, { identification: "0102030405" }))).toEqual([docs.guideSingle!.id]);
    expect(ids(await list(a, { search: "juan torres" }))).toEqual([docs.guideMany!.id]);
    expect(ids(await list(b, { identification: "1712345678" }))).toEqual([]);
  });

  it("rechaza un filtro inválido sin consultar", async () => {
    const invalid: Record<string, string>[] = [
      { from: "2026-02-30" },
      { from: "2026-10-15", to: "2026-10-01" },
      { state: "DRAFT" },
    ];
    for (const query of invalid) {
      const res = await list(a, query);
      expect(res.status, JSON.stringify(query)).toBe(400);
      expect(bodyOf(res).error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("indica los documentos disponibles según el estado y la generación del RIDE", async () => {
    const documents = async (id: string) =>
      bodyOf(await list(a, { pageSize: "100" })).data.find((item) => item.id === id)!.documents;
    expect(await documents(docs.pending!.id)).toEqual({
      ride: "PENDING",
      authorizedXml: false,
      signedXml: true,
    });
    expect(await documents(docs.stopped!.id)).toEqual({
      ride: "STOPPED",
      authorizedXml: false,
      signedXml: true,
    });
    for (const state of [
      "SIGNED",
      "SEND_UNKNOWN",
      "RECEIVED",
      "RETURNED",
      "NOT_AUTHORIZED",
      "MANUAL_REVIEW",
    ]) {
      expect(await documents(docs[state]!.id), state).toEqual({
        ride: "NOT_APPLICABLE",
        authorizedXml: false,
        signedXml: true,
      });
    }
    expect(await documents(docs.RESERVED!.id)).toEqual({
      ride: "NOT_APPLICABLE",
      authorizedXml: false,
      signedXml: false,
    });
  });

  it("el resumen trae los artefactos, la procedencia del RIDE y la generación detenida con su motivo", async () => {
    const ride = await request(api.app)
      .get(`/api/v1/documents/${docs.ride!.id}`)
      .set("Cookie", a.cookies.admin);
    expect(ride.status).toBe(200);
    expect(bodyOf(ride).data.artifacts.map((item) => [item.kind, item.provenance])).toEqual([
      ["SIGNED_XML", null],
      ["AUTHORIZED_XML", null],
      ["RIDE_PDF", "AUTHORIZED_XML"],
    ]);
    expect(bodyOf(ride).data.rideGeneration).toEqual({
      status: "AVAILABLE",
      reason: null,
      stoppedAt: null,
      retryable: false,
    });
    const stopped = await request(api.app)
      .get(`/api/v1/documents/${docs.stopped!.id}`)
      .set("Cookie", a.cookies.operator);
    expect(bodyOf(stopped).data.rideGeneration).toEqual({
      status: "STOPPED",
      reason: "RIDE_GLYPH_MISSING",
      stoppedAt: "2026-10-04T16:00:00.000Z",
      retryable: true,
    });
  });

  it("sin sesión responde no autenticado", async () => {
    expect((await request(api.app).get("/api/v1/documents")).status).toBe(401);
    expect((await request(api.app).get(`/api/v1/documents/${docs.ride!.id}`)).status).toBe(401);
  });

  it("aísla las empresas: ningún filtro ni identificador muestra comprobantes de otra", async () => {
    const filters: Record<string, string>[] = [
      {},
      { identification: "0992877878001" },
      { search: "perno" },
      { state: "AUTHORIZED" },
    ];
    for (const query of filters) {
      expect(ids(await list(a, { ...query, pageSize: "100" }))).not.toContain(docs.other!.id);
    }
    expect(ids(await list(b, { pageSize: "100" }))).toEqual([docs.other!.id]);
    const foreign = await request(api.app)
      .get(`/api/v1/documents/${docs.other!.id}`)
      .set("Cookie", a.cookies.admin);
    expect(foreign.status).toBe(404);
    expect(bodyOf(foreign).error.code).toBe("DOCUMENT_NOT_FOUND");
    // Un companyId en la consulta se ignora.
    expect(ids(await list(a, { companyId: b.companyId, pageSize: "100" }))).not.toContain(
      docs.other!.id,
    );
  });
});
