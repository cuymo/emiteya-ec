// Prueba end-to-end de add-document-archive (tarea 11.2) contra el backend real: main.ts como
// proceso, con la custodia habilitada, la transmisión hacia un SRI SIMULADO (respuestas
// sintéticas) y una política de tamaño SINTÉTICA. Recorre la emisión, la autorización con y sin el
// comprobante devuelto, el job del RIDE nacido con la autorización (sin esperar al barrido), el RIDE
// guardado con su procedencia, la bandeja, la descarga con la lectura real del Code128, la solicitud
// de impresión y su historial, y un rearranque en el que el barrido completa un autorizado sin RIDE.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  DocumentDeliveriesView,
  DocumentListItem,
  DraftView,
  InvoiceView,
} from "@facturador/contracts";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { FIXTURE_PASSWORD, FIXTURE_RUC, readFixture } from "../support/p12-fixtures.ts";
import { decodeCode128, pageTexts } from "../support/pdf-inspection.ts";
import { SRI_HOST, listen, outboundProxy, simulatedSri } from "../support/simulated-sri.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { E2E_ORIGIN, startE2eBackend, type E2eBackend } from "./e2e-backend.ts";

const ADMIN = { email: "admin@e2e-archivo.ec", password: "contrasena-admin-e2e-1" };
const OPERATOR = { email: "operador@e2e-archivo.ec", password: "contrasena-operador-e2e-1" };
const dir = inject("p12FixturesDir");
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

describe("flujo completo del archivo documental", () => {
  let db: MigratedSchema;
  let backend: E2eBackend;
  let sri: ReturnType<typeof simulatedSri>;
  let proxy: ReturnType<typeof outboundProxy>;
  let proxyUrl: string;
  let draftBody: Record<string, unknown>;
  let operator: string;
  const brokenFonts = mkdtempSync(join(tmpdir(), "facturador-sin-fuentes-"));
  const masterKey = randomBytes(32).toString("base64");
  const env = (extra: Record<string, string> = {}) => ({
    CERTIFICATE_CUSTODY: "enabled",
    CERTIFICATE_MASTER_KEY: masterKey,
    NODE_USE_ENV_PROXY: "1",
    HTTP_PROXY: proxyUrl,
    HTTPS_PROXY: proxyUrl,
    SRI_TRANSMISSION_ENABLED: "1",
    SRI_JOB_POLL_INTERVAL_MS: "200",
    SRI_JOB_LEASE_SECONDS: "30",
    SRI_REQUEST_TIMEOUT_MS: "5000",
    SRI_BODY_TIMEOUT_MS: "1000",
    SRI_AUTHORIZATION_FIRST_DELAY_SECONDS: "0",
    SRI_POLL_BACKOFF_BASE_SECONDS: "1",
    SRI_POLL_BACKOFF_CAP_SECONDS: "2",
    SRI_ENDPOINT_TEST_RECEPTION: `http://${SRI_HOST}/comprobantes-electronicos-ws/RecepcionComprobantesOffline`,
    SRI_ENDPOINT_TEST_AUTHORIZATION: `http://${SRI_HOST}/comprobantes-electronicos-ws/AutorizacionComprobantesOffline`,
    SRI_ENDPOINT_TEST_VALIDITY: `http://${SRI_HOST}/comprobantes-electronicos-ws/ConsultaComprobante`,
    // Sin barrido periódico durante la prueba: un job del RIDE solo puede nacer con la
    // autorización o con el barrido del arranque.
    RIDE_SWEEP_INTERVAL_SECONDS: "86400",
    ...extra,
  });
  const start = (extra: Record<string, string> = {}, waitFor: "ready" | "live" = "ready") =>
    startE2eBackend({ label: "end_to_end_archive", admin: ADMIN, db, env: env(extra), waitFor });

  beforeAll(async () => {
    sri = simulatedSri();
    const sriPort = await listen(sri.server);
    proxy = outboundProxy(sriPort);
    proxyUrl = `http://127.0.0.1:${await listen(proxy.server)}`;
    db = await createMigratedSchema("end_to_end_archive");
  }, 120_000);

  afterAll(async () => {
    await backend?.stop();
    await db?.drop();
    sri?.server.close();
    proxy?.server.close();
    rmSync(brokenFonts, { recursive: true, force: true });
  });

  async function signIn(email: string, password: string) {
    const { status, cookie } = await backend.signIn(email, password);
    expect(status).toBe(200);
    return cookie;
  }

  async function api<T>(method: string, path: string, cookie: string, body?: unknown) {
    const res = await backend.fetchApi(method, path, cookie, body);
    const json = (await res.json()) as { data: T; error?: { code: string; message: string } };
    return { status: res.status, data: json.data, error: json.error };
  }

  async function emit(cookie: string) {
    const draft = await api<DraftView>("POST", "/invoices/drafts", cookie, draftBody);
    expect(draft.status).toBe(201);
    const res = await fetch(`${backend.base}/api/v1/invoices`, {
      method: "POST",
      headers: {
        cookie,
        origin: E2E_ORIGIN,
        "content-type": "application/json",
        "Idempotency-Key": randomUUID(),
      },
      body: JSON.stringify({ draftId: draft.data.id, expectedVersion: draft.data.version }),
    });
    const json = (await res.json()) as { data: InvoiceView };
    expect(res.status).toBe(201);
    return json.data;
  }

  async function until(condition: () => Promise<boolean>, what: string, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await condition()) return;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`no se cumplió: ${what}\n${backend.output()}`);
  }
  const stateOf = async (id: string) =>
    (await db.database.prisma.electronicDocument.findUniqueOrThrow({ where: { id } })).state;
  const rideOf = (documentId: string) =>
    db.database.prisma.documentArtifact.findFirst({ where: { documentId, kind: "RIDE_PDF" } });
  const rideJobsOf = (documentId: string) =>
    db.database.prisma.job.findMany({ where: { documentId, type: "document.render_ride" } });
  const download = (path: string, cookie: string) =>
    fetch(`${backend.base}/api/v1/documents/${path}`, { headers: { cookie, origin: E2E_ORIGIN } });

  it("autoriza, genera el RIDE con su job y lo entrega por la bandeja", async () => {
    backend = await start();
    const admin = await signIn(ADMIN.email, ADMIN.password);
    await api("PUT", "/taxpayer", admin, {
      ruc: FIXTURE_RUC,
      legalName: "COMERCIAL ANDINA S.A.",
      headOfficeAddress: "Av. Amazonas N24-03, Quito",
      accountingRequired: true,
      expectedVersion: null,
    });
    const establishment = await api<{ id: string }>("POST", "/establishments", admin, {
      code: "001",
      address: "Av. 6 de Diciembre, Quito",
    });
    const point = await api<{ id: string }>(
      "POST",
      `/establishments/${establishment.data.id}/emission-points`,
      admin,
      { code: "001" },
    );
    await api("PUT", "/signing-certificate", admin, {
      file: readFixture(dir, "sd-utf8.modern.p12").toString("base64"),
      password: FIXTURE_PASSWORD,
      expectedCurrentId: null,
    });
    await api("POST", "/users", admin, {
      name: "Olga Operadora",
      email: OPERATOR.email,
      password: OPERATOR.password,
      role: "OPERATOR",
    });
    const customer = await api<{ id: string }>("POST", "/parties", admin, {
      identificationType: "04",
      identification: "0992877878001",
      legalName: "FERRETERÍA EL PERNO CÍA. LTDA.",
      address: "Guayaquil",
      roles: ["CUSTOMER"],
    });
    const product = await api<{ id: string }>("POST", "/products", admin, {
      kind: "GOOD",
      mainCode: "CEM-50",
      name: "Cemento 50 kg",
      unitPrice: "8.75",
      taxes: { iva: "4" },
    });
    draftBody = {
      emissionPointId: point.data.id,
      buyerPartyId: customer.data.id,
      lines: [{ productId: product.data.id, quantity: "3", discount: "1.25" }],
      payments: [{ paymentMethod: "01" }],
    };
    operator = await signIn(OPERATOR.email, OPERATOR.password);

    // A: el SRI devuelve el comprobante. B: lo autoriza sin devolverlo (respaldo del XML firmado).
    const a = await emit(operator);
    sri.withoutXml.add(2);
    const b = await emit(operator);
    for (const invoice of [a, b]) {
      await until(
        async () => (await stateOf(invoice.id)) === "AUTHORIZED",
        `${invoice.id} autorizada`,
      );
      await until(async () => (await rideOf(invoice.id)) !== null, `RIDE de ${invoice.id}`);
      // Un solo job, nacido con la autorización: el barrido del arranque ocurrió antes de emitir.
      expect((await rideJobsOf(invoice.id)).map((job) => [job.status, job.origin])).toEqual([
        ["DONE", "AUTOMATIC"],
      ]);
    }
    expect((await rideOf(a.id))!.metadata).toMatchObject({
      source: { kind: "AUTHORIZED_XML", provenance: "AUTHORIZED_XML" },
      rendererVersion: "1",
    });
    expect((await rideOf(b.id))!.metadata).toMatchObject({
      source: { kind: "SIGNED_XML", provenance: "SIGNED_XML_FALLBACK" },
    });

    // La bandeja con los documentos disponibles de cada uno.
    const list = await api<DocumentListItem[]>("GET", "/documents", operator);
    expect(list.status).toBe(200);
    const byId = new Map(list.data.map((item) => [item.id, item]));
    expect(byId.get(a.id)!.documents).toEqual({
      ride: "AVAILABLE",
      authorizedXml: true,
      signedXml: true,
    });
    expect(byId.get(b.id)!.documents).toEqual({
      ride: "AVAILABLE",
      authorizedXml: false,
      signedXml: true,
    });

    // La descarga sirve los bytes guardados: el texto y el Code128 llevan la clave de acceso.
    const ride = await download(`${a.id}/ride`, operator);
    expect(ride.status).toBe(200);
    expect(ride.headers.get("content-disposition")).toBe(
      `attachment; filename="factura-${a.documentNumber}.pdf"`,
    );
    const pdf = new Uint8Array(await ride.arrayBuffer());
    expect(sha256(pdf)).toBe((await rideOf(a.id))!.sha256);
    const [firstPage] = await pageTexts(pdf);
    expect(firstPage).toContain(`NÚMERO DE AUTORIZACIÓN ${a.accessKey}`);
    expect(firstPage).toContain("FERRETERÍA EL PERNO CÍA. LTDA.");
    expect(await decodeCode128(pdf)).toEqual([a.accessKey]);
    expect((await download(`${b.id}/authorized-xml`, operator)).status).toBe(404);
    expect((await download(`${b.id}/signed-xml`, operator)).status).toBe(200);

    // La impresión es una acción explícita, y el historial muestra lo que la aplicación hizo.
    const printing = await api<{ id: string }>(
      "POST",
      `/documents/${a.id}/print-requests`,
      operator,
    );
    expect(printing.status).toBe(201);
    const history = await api<DocumentDeliveriesView>(
      "GET",
      `/documents/${a.id}/deliveries`,
      admin,
    );
    expect(
      history.data.items.map((item) => [item.event, item.artifactKind, item.actorName]),
    ).toEqual([
      ["PRINT_REQUESTED", "RIDE_PDF", "Olga Operadora"],
      ["DOWNLOAD", "RIDE_PDF", "Olga Operadora"],
    ]);
    expect(proxy.destinations.filter((d) => !d.startsWith(SRI_HOST))).toEqual([]);
  }, 180_000);

  it("al rearrancar, el barrido completa un autorizado sin RIDE ni job", async () => {
    // Sin fuentes verificadas, el runner del RIDE no toma nada: la autorización deja su job
    // pendiente.
    await backend.stop();
    backend = await start({ RIDE_FONTS_DIRECTORY: brokenFonts }, "live");
    operator = await signIn(OPERATOR.email, OPERATOR.password);
    const c = await emit(operator);
    await until(async () => (await stateOf(c.id)) === "AUTHORIZED", "C autorizada");
    expect((await rideJobsOf(c.id)).map((job) => job.status)).toEqual(["PENDING"]);
    expect(await rideOf(c.id)).toBeNull();
    // Un autorizado anterior al archivo documental: sin RIDE y sin job.
    await backend.stop();
    await db.database.prisma.job.deleteMany({
      where: { documentId: c.id, type: "document.render_ride" },
    });

    backend = await start();
    await until(async () => (await rideOf(c.id)) !== null, "RIDE de C por el barrido");
    expect((await rideJobsOf(c.id)).map((job) => [job.status, job.origin])).toEqual([
      ["DONE", "AUTOMATIC"],
    ]);
    expect(await stateOf(c.id)).toBe("AUTHORIZED");
  }, 180_000);
});
