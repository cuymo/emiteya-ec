// Prueba end-to-end de add-invoice-emission (tarea 12.1) contra el backend real: main.ts como
// proceso, con la custodia habilitada, sobre un esquema vacío. Recorre por HTTP la preparación, el
// borrador, la emisión hasta SIGNED, la repetición con la misma clave, un rearranque y las consultas,
// y comprueba los eventos de auditoría exactos. Ninguna llamada sale al SRI: el proceso usa un proxy
// de salida que registra cada conexión, y la prueba exige que no reciba ninguna.
import { execFile } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer, type AddressInfo, type Server } from "node:net";
import { promisify } from "node:util";
import type { DraftView, InvoiceSummaryView, InvoiceView } from "@facturador/contracts";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { FIXTURE_PASSWORD, FIXTURE_RUC, readFixture } from "../support/p12-fixtures.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { E2E_ORIGIN, startE2eBackend, type E2eBackend } from "./e2e-backend.ts";

const ADMIN = { email: "admin@e2e-facturas.ec", password: "contrasena-admin-e2e-1" };
const OPERATOR = { email: "operador@e2e-facturas.ec", password: "contrasena-operador-e2e-1" };
const dir = inject("p12FixturesDir");
const execFileAsync = promisify(execFile);

/** Proxy de salida que registra cada petición y la rechaza: ninguna llega a su destino. */
function outboundTrap(): Promise<{ url: string; connections: string[]; server: Server }> {
  const connections: string[] = [];
  const server = createServer((socket) => {
    socket.on("error", () => undefined);
    socket.once("data", (chunk: Buffer) => {
      connections.push(chunk.toString("latin1").split("\r\n")[0] ?? "");
      socket.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        connections,
        server,
      }),
    ),
  );
}

describe("flujo completo de la emisión de una factura", () => {
  let db: MigratedSchema;
  let backend: E2eBackend;
  let trap: Awaited<ReturnType<typeof outboundTrap>>;
  // Clave de un solo uso, la misma en los dos arranques: la custodia habilitada como en producción.
  const masterKey = randomBytes(32).toString("base64");
  const proxyEnv = () => ({
    NODE_USE_ENV_PROXY: "1",
    HTTP_PROXY: trap.url,
    HTTPS_PROXY: trap.url,
  });
  const start = () =>
    startE2eBackend({
      label: "end_to_end_invoices",
      admin: ADMIN,
      db,
      env: { CERTIFICATE_CUSTODY: "enabled", CERTIFICATE_MASTER_KEY: masterKey, ...proxyEnv() },
    });

  beforeAll(async () => {
    trap = await outboundTrap();
    db = await createMigratedSchema("end_to_end_invoices");
    backend = await start();
  }, 120_000);

  afterAll(async () => {
    await backend?.stop();
    await db?.drop();
    trap?.server.close();
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

  async function emit(cookie: string, key: string, draft: { id: string; version: number }) {
    const res = await fetch(`${backend.base}/api/v1/invoices`, {
      method: "POST",
      headers: {
        cookie,
        origin: E2E_ORIGIN,
        "content-type": "application/json",
        "Idempotency-Key": key,
      },
      body: JSON.stringify({ draftId: draft.id, expectedVersion: draft.version }),
    });
    const json = (await res.json()) as {
      data: InvoiceView;
      error?: { code: string; message: string };
    };
    return { status: res.status, data: json.data, error: json.error };
  }

  it("el proxy de salida registra una llamada hecha con el entorno del backend", async () => {
    // Control del mecanismo: un proceso con el mismo entorno que intenta llegar al SRI pasa por el
    // proxy. Así, cero conexiones al final significa que el backend no llamó a nadie. Asíncrono: el
    // proxy corre en este mismo proceso.
    const { stderr } = await execFileAsync(
      process.execPath,
      [
        "-e",
        "fetch('https://celcer.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline').catch(() => {})",
      ],
      { env: { PATH: process.env.PATH, ...proxyEnv() }, timeout: 20_000 },
    );
    expect(stderr).toBe("");
    expect(trap.connections).toEqual(["CONNECT celcer.sri.gob.ec:443 HTTP/1.1"]);
    trap.connections.length = 0;
  });

  it("prepara, emite hasta SIGNED, repite con la misma clave, rearranca y consulta, sin llamar al SRI", async () => {
    // 1. Preparación por la API: configuración, punto, firma sintética, operador, tercero y producto.
    const admin = await signIn(ADMIN.email, ADMIN.password);
    expect(
      (
        await api("PUT", "/taxpayer", admin, {
          ruc: FIXTURE_RUC,
          legalName: "COMERCIAL ANDINA S.A.",
          headOfficeAddress: "Av. Amazonas N24-03, Quito",
          accountingRequired: true,
          expectedVersion: null,
        })
      ).status,
    ).toBe(200);
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
    expect(point.status).toBe(201);
    expect(
      (
        await api("PUT", "/signing-certificate", admin, {
          file: readFixture(dir, "sd-utf8.modern.p12").toString("base64"),
          password: FIXTURE_PASSWORD,
          expectedCurrentId: null,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await api("POST", "/users", admin, {
          name: "Olga Operadora",
          email: OPERATOR.email,
          password: OPERATOR.password,
          role: "OPERATOR",
        })
      ).status,
    ).toBe(201);
    const customer = await api<{ id: string }>("POST", "/parties", admin, {
      identificationType: "04",
      identification: "0992877878001",
      legalName: "FERRETERIA EL PERNO CIA. LTDA.",
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
    expect([customer.status, product.status]).toEqual([201, 201]);

    // 2. El operador prepara un borrador: la vista previa del servidor no tiene problemas.
    const operator = await signIn(OPERATOR.email, OPERATOR.password);
    const draftBody = {
      emissionPointId: point.data.id,
      buyerPartyId: customer.data.id,
      lines: [{ productId: product.data.id, quantity: "3", discount: "1.25" }],
      payments: [{ paymentMethod: "01" }],
    };
    const draft = await api<DraftView>("POST", "/invoices/drafts", operator, draftBody);
    expect(draft.status).toBe(201);
    expect(draft.data.preview).toMatchObject({
      issues: [],
      totals: { withoutTaxes: "25.00", discount: "1.25", total: "28.75" },
    });

    // 3. Emite hasta SIGNED con el número, la clave de acceso y el artefacto exacto.
    const key = randomUUID();
    const emitted = await emit(operator, key, draft.data);
    expect(emitted.status, JSON.stringify(emitted.error)).toBe(201);
    expect(emitted.data).toMatchObject({
      state: "SIGNED",
      documentNumber: "001-001-000000001",
      environment: "TEST",
      diagnostic: null,
      totals: { total: "28.75" },
      buyer: { identification: "0992877878001", consumerFinal: false },
    });
    expect(emitted.data.accessKey).toMatch(/^\d{49}$/);
    const artifact = await db.database.prisma.documentArtifact.findFirstOrThrow({
      where: { documentId: emitted.data.id },
    });
    const bytes = Buffer.from(artifact.content);
    expect(emitted.data.artifact).toEqual({
      sha256: createHash("sha256").update(bytes).digest("hex"),
      sizeBytes: bytes.length,
    });
    expect(bytes.toString("utf8")).toContain(
      `<claveAcceso>${emitted.data.accessKey}</claveAcceso>`,
    );

    // 4. La misma clave con la misma solicitud devuelve el mismo comprobante, sin otro número; con
    //    otra solicitud, 409.
    const repeated = await emit(operator, key, draft.data);
    expect(repeated.status).toBe(200);
    expect(repeated.data).toMatchObject({ id: emitted.data.id, accessKey: emitted.data.accessKey });
    const second = await api<DraftView>("POST", "/invoices/drafts", operator, draftBody);
    expect((await emit(operator, key, second.data)).error?.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(await db.database.prisma.electronicDocument.count()).toBe(1);

    // 5. Rearranque: la clave sigue siendo durable y la firma custodiada sigue disponible.
    await backend.stop();
    backend = await start();
    const operatorAgain = await signIn(OPERATOR.email, OPERATOR.password);
    const afterRestart = await emit(operatorAgain, key, draft.data);
    expect(afterRestart.status).toBe(200);
    expect(afterRestart.data.id).toBe(emitted.data.id);
    const next = await emit(operatorAgain, randomUUID(), second.data);
    expect(next.status, JSON.stringify(next.error)).toBe(201);
    expect(next.data).toMatchObject({ state: "SIGNED", documentNumber: "001-001-000000002" });
    // El borrador emitido ya no se emite otra vez con otra clave.
    expect((await emit(operatorAgain, randomUUID(), draft.data)).status).toBe(409);

    // 6. Consultas: la lista y el detalle desde el snapshot.
    const list = await api<InvoiceSummaryView[]>("GET", "/invoices", operatorAgain);
    expect(list.status).toBe(200);
    expect(list.data.map((invoice) => [invoice.documentNumber, invoice.state])).toEqual([
      ["001-001-000000002", "SIGNED"],
      ["001-001-000000001", "SIGNED"],
    ]);
    const detail = await api<InvoiceView>("GET", `/invoices/${emitted.data.id}`, operatorAgain);
    expect(detail.data).toEqual(emitted.data);

    // 7. Auditoría exacta: la reserva y la firma de cada factura, sin borradores ni XML.
    const events = await db.database.prisma.auditEvent.findMany({
      orderBy: { occurredAt: "asc" },
    });
    const operatorId = (
      await db.database.prisma.user.findFirstOrThrow({ where: { email: OPERATOR.email } })
    ).id;
    const invoiceEvents = events.filter((event) => event.action.startsWith("invoice"));
    expect(invoiceEvents.map((event) => [event.action, event.actorUserId])).toEqual([
      ["invoice.reserved", operatorId],
      ["invoice.signed", operatorId],
      ["invoice.reserved", operatorId],
      ["invoice.signed", operatorId],
    ]);
    expect(invoiceEvents[0]!.changes).toEqual({
      invoiceId: emitted.data.id,
      documentNumber: "001-001-000000001",
      accessKey: emitted.data.accessKey,
      environment: "TEST",
      total: "28.75",
    });
    expect(invoiceEvents[1]!.changes).toEqual({
      invoiceId: emitted.data.id,
      documentNumber: "001-001-000000001",
      artifactSha256: artifact.sha256,
    });
    expect(events.map((event) => event.action)).toEqual([
      "company.provisioned",
      "taxpayer.configured",
      "establishment.created",
      "emission_point.created",
      "signing_certificate.loaded",
      "user.created",
      "party.created",
      "product.created",
      "invoice.reserved",
      "invoice.signed",
      "invoice.reserved",
      "invoice.signed",
    ]);
    expect(JSON.stringify(events.map((event) => event.changes))).not.toMatch(/<\?xml|<factura/);

    // 8. Ningún estado posterior a SIGNED y ninguna conexión de salida en los dos arranques.
    const transitions = await db.database.prisma.documentStateTransition.findMany({
      orderBy: { occurredAt: "asc" },
    });
    expect(new Set(transitions.map((transition) => transition.toState))).toEqual(
      new Set(["RESERVED", "SIGNED"]),
    );
    expect(trap.connections).toEqual([]);
  }, 180_000);
});
