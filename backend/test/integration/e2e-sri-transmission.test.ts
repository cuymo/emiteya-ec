// Prueba end-to-end de add-sri-transmission (tarea 14.1) contra el backend real: main.ts como
// proceso, con la custodia habilitada, sobre un esquema vacío y con los endpoints del SRI
// sobrescritos hacia un SRI SIMULADO en HTTP (respuestas sintéticas con la estructura oficial).
// Recorre la preparación, la emisión, la transmisión, la autorización y las consultas; un primer
// arranque con la transmisión apagada, que no llama a nadie; un rearranque por caída a mitad del
// envío, que no reenvía; y una reconciliación manual con sus eventos de auditoría exactos. Toda
// salida pasa por un proxy que solo admite el host del SRI simulado y rechaza cualquier otro.
import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import {
  createServer as createHttpServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { connect, type AddressInfo } from "node:net";
import { promisify } from "node:util";
import type { DraftView, InvoiceSummaryView, InvoiceView } from "@facturador/contracts";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { FIXTURE_PASSWORD, FIXTURE_RUC, readFixture } from "../support/p12-fixtures.ts";
import {
  authorizationResponse,
  receptionResponse,
  validityResponse,
} from "../support/sri-responses.ts";
import {
  installSyntheticSizePolicy,
  syntheticSizePolicy,
} from "../support/synthetic-size-policy.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { E2E_ORIGIN, startE2eBackend, type E2eBackend } from "./e2e-backend.ts";

const ADMIN = { email: "admin@e2e-sri.ec", password: "contrasena-admin-e2e-1" };
const OPERATOR = { email: "operador@e2e-sri.ec", password: "contrasena-operador-e2e-1" };
const dir = inject("p12FixturesDir");
const execFileAsync = promisify(execFile);

/** Host del SRI simulado: no resuelve por DNS, así que solo se alcanza a través del proxy. */
const SRI_HOST = "sri-simulado.test";
const FOREIGN_KEY = "1".repeat(49);

type SriCall = { operation: "RECEPTION" | "AUTHORIZATION" | "VALIDITY"; key: string };
type ReceptionBehavior = "RECEIVED" | "HOLD" | "FOREIGN_KEY";

const sequentialOf = (key: string) => Number(key.slice(30, 39));

/**
 * SRI simulado: recepción, autorización y validez con respuestas SINTÉTICAS. Recuerda los bytes
 * que recibió cada clave y solo autoriza lo que recibió, con ese mismo XML en el comprobante.
 */
function simulatedSri() {
  const calls: SriCall[] = [];
  const received = new Map<string, Buffer>();
  const behaviors = new Map<number, ReceptionBehavior>();
  const held: ServerResponse[] = [];
  let onHold: ((key: string) => void) | null = null;
  // Caído: corta cada conexión sin responder.
  let down = false;

  const respond = (res: ServerResponse, body: string) => {
    res.writeHead(200, { "content-type": "text/xml; charset=utf-8" });
    res.end(body);
  };

  const handle = (req: IncomingMessage, res: ServerResponse, body: string) => {
    if (req.url?.endsWith("/RecepcionComprobantesOffline")) {
      const signed = Buffer.from(/<xml>([^<]+)<\/xml>/.exec(body)?.[1] ?? "", "base64");
      const key = /<claveAcceso>(\d{49})<\/claveAcceso>/.exec(signed.toString("utf8"))?.[1] ?? "";
      calls.push({ operation: "RECEPTION", key });
      received.set(key, signed);
      const behavior = behaviors.get(sequentialOf(key)) ?? "RECEIVED";
      if (behavior === "HOLD") {
        held.push(res);
        onHold?.(key);
        return;
      }
      if (behavior === "FOREIGN_KEY")
        return respond(
          res,
          receptionResponse("DEVUELTA", [
            {
              accessKey: FOREIGN_KEY,
              messages: [{ identifier: "35", message: "CLAVE AJENA (sintético)", type: "ERROR" }],
            },
          ]),
        );
      return respond(res, receptionResponse("RECIBIDA"));
    }
    if (req.url?.endsWith("/AutorizacionComprobantesOffline")) {
      const key = /<claveAccesoComprobante>(\d{49})</.exec(body)?.[1] ?? "";
      calls.push({ operation: "AUTHORIZATION", key });
      const signed = received.get(key);
      return respond(
        res,
        signed
          ? authorizationResponse(key, [
              {
                estado: "AUTORIZADO",
                numeroAutorizacion: key,
                fechaAutorizacion: new Date().toISOString(),
                ambiente: "PRUEBAS",
                comprobante: `<![CDATA[${signed.toString("utf8")}]]>`,
                messages: [
                  {
                    identifier: "60",
                    message: "ESTE PROCESO FUE REALIZADO EN EL AMBIENTE DE PRUEBAS",
                    type: "ADVERTENCIA",
                  },
                ],
              },
            ])
          : authorizationResponse(key, [], "0"),
      );
    }
    if (req.url?.endsWith("/ConsultaComprobante")) {
      const key = /<claveAcceso>(\d{49})</.exec(body)?.[1] ?? "";
      calls.push({ operation: "VALIDITY", key });
      return respond(
        res,
        validityResponse({
          estadoConsulta: "RECHAZADA",
          accessKey: key,
          messages: [{ identifier: "99", message: "ERROR AL CONSULTAR DATOS", type: "ERROR" }],
        }),
      );
    }
    res.writeHead(404).end();
  };

  const server = createHttpServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
    req.on("end", () => (down ? req.socket.destroy() : handle(req, res, body)));
  });
  return {
    server,
    calls,
    received,
    behaviors,
    /** Resuelve con la clave cuando una recepción queda retenida sin respuesta. */
    nextHold: () => new Promise<string>((resolve) => (onHold = resolve)),
    releaseHeld: () => held.splice(0).forEach((res) => res.destroy()),
    setDown: (value: boolean) => (down = value),
  };
}

/**
 * Proxy de salida del backend: registra cada destino y solo admite el host del SRI simulado, al
 * que reenvía; cualquier otro destino recibe 403 y no llega a ninguna parte.
 */
function outboundProxy(sriPort: number) {
  const destinations: string[] = [];
  const server = createHttpServer((req, res) => {
    const target = new URL(req.url ?? "/", "http://invalido");
    destinations.push(target.host);
    if (target.host !== SRI_HOST) return res.writeHead(403).end();
    const forward = httpRequest(
      {
        host: "127.0.0.1",
        port: sriPort,
        method: req.method,
        path: target.pathname,
        headers: req.headers,
      },
      (upstream) => {
        res.writeHead(upstream.statusCode ?? 502, upstream.headers);
        upstream.pipe(res);
      },
    );
    forward.on("error", () => res.destroy());
    req.pipe(forward);
  });
  server.on("connect", (req: IncomingMessage, socket) => {
    socket.on("error", () => undefined);
    const target = req.url ?? "";
    destinations.push(target);
    if (target !== `${SRI_HOST}:80`) {
      socket.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
      return;
    }
    const upstream = connect(sriPort, "127.0.0.1", () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on("error", () => socket.destroy());
  });
  return { server, destinations };
}

const listen = (server: Server) =>
  new Promise<number>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)),
  );

describe("flujo completo de la transmisión al SRI", () => {
  let db: MigratedSchema;
  let backend: E2eBackend;
  let sri: ReturnType<typeof simulatedSri>;
  let proxy: ReturnType<typeof outboundProxy>;
  let proxyUrl: string;
  const masterKey = randomBytes(32).toString("base64");
  const proxyEnv = () => ({
    NODE_USE_ENV_PROXY: "1",
    HTTP_PROXY: proxyUrl,
    HTTPS_PROXY: proxyUrl,
  });
  const baseEnv = () => ({
    CERTIFICATE_CUSTODY: "enabled",
    CERTIFICATE_MASTER_KEY: masterKey,
    SRI_JOB_POLL_INTERVAL_MS: "200",
    ...proxyEnv(),
  });
  // Habilitada: endpoints de Pruebas hacia el SRI simulado y plazos cortos. La concesión mínima
  // (30 s) cubre el presupuesto del transporte con estos tiempos.
  const enabledEnv = () => ({
    ...baseEnv(),
    SRI_TRANSMISSION_ENABLED: "1",
    SRI_JOB_WORKERS: "2",
    SRI_JOB_LEASE_SECONDS: "30",
    SRI_REQUEST_TIMEOUT_MS: "5000",
    SRI_BODY_TIMEOUT_MS: "1000",
    SRI_AUTHORIZATION_FIRST_DELAY_SECONDS: "0",
    SRI_POLL_BACKOFF_BASE_SECONDS: "1",
    SRI_POLL_BACKOFF_CAP_SECONDS: "2",
    SRI_ENDPOINT_TEST_RECEPTION: `http://${SRI_HOST}/comprobantes-electronicos-ws/RecepcionComprobantesOffline`,
    SRI_ENDPOINT_TEST_AUTHORIZATION: `http://${SRI_HOST}/comprobantes-electronicos-ws/AutorizacionComprobantesOffline`,
    SRI_ENDPOINT_TEST_VALIDITY: `http://${SRI_HOST}/comprobantes-electronicos-ws/ConsultaComprobante`,
  });
  const start = (env: Record<string, string>) =>
    startE2eBackend({ label: "end_to_end_sri", admin: ADMIN, db, env });

  beforeAll(async () => {
    sri = simulatedSri();
    const sriPort = await listen(sri.server);
    proxy = outboundProxy(sriPort);
    proxyUrl = `http://127.0.0.1:${await listen(proxy.server)}`;
    db = await createMigratedSchema("end_to_end_sri");
  }, 120_000);

  afterAll(async () => {
    await backend?.stop();
    await db?.drop();
    sri?.releaseHeld();
    sri?.server.close();
    proxy?.server.close();
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

  async function emit(cookie: string, draftBody: unknown) {
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
    const json = (await res.json()) as { data: InvoiceView; error?: { code: string } };
    expect(res.status, JSON.stringify(json.error)).toBe(201);
    expect(json.data.state).toBe("SIGNED");
    return json.data;
  }

  async function waitForState(id: string, state: string, timeoutMs: number) {
    const deadline = Date.now() + timeoutMs;
    let current = "";
    while (Date.now() < deadline) {
      current = (await db.database.prisma.electronicDocument.findUniqueOrThrow({ where: { id } }))
        .state;
      if (current === state) return;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`La factura ${id} quedó en ${current}, no en ${state}:\n${backend.output()}`);
  }

  const transitionsOf = async (documentId: string) =>
    (
      await db.database.prisma.documentStateTransition.findMany({
        where: { documentId },
        orderBy: { occurredAt: "asc" },
      })
    ).map((t) => `${t.fromState ?? "∅"}→${t.toState} (${t.cause})`);

  const callsFor = (key: string) =>
    sri.calls.filter((call) => call.key === key).map((call) => call.operation);

  const metric = async (name: string) =>
    (await (await fetch(`${backend.base}/metrics`)).text())
      .split("\n")
      .find((line) => line.startsWith(`${name} `) || line.startsWith(`${name}{`));

  it("el proxy registra y rechaza una salida ajena, y solo admite el SRI simulado", async () => {
    // Control del mecanismo, con el mismo entorno que el backend: una llamada al SRI real pasa
    // por el proxy y se rechaza; una al host simulado llega al SRI simulado.
    const script = [
      "await fetch('https://celcer.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline').catch(() => {});",
      `const res = await fetch('http://${SRI_HOST}/comprobantes-electronicos-ws/ConsultaComprobante', { method: 'POST', body: '<claveAcceso>${"0".repeat(49)}</claveAcceso>' });`,
      "process.stdout.write(String(res.status));",
    ].join("\n");
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ["--input-type=module", "-e", script],
      { env: { PATH: process.env.PATH, ...proxyEnv() }, timeout: 20_000 },
    );
    expect(stderr).toBe("");
    expect(stdout).toBe("200");
    expect(proxy.destinations[0]).toBe("celcer.sri.gob.ec:443");
    expect(proxy.destinations.slice(1).every((d) => d.startsWith(SRI_HOST))).toBe(true);
    expect(sri.calls).toEqual([{ operation: "VALIDITY", key: "0".repeat(49) }]);
    proxy.destinations.length = 0;
    sri.calls.length = 0;
  });

  it("transmite, autoriza, sobrevive a una caída a mitad del envío y reconcilia a mano", async () => {
    // 1. Primer arranque con la transmisión apagada (por defecto): preparación por la API.
    backend = await start(baseEnv());
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
    const draftBody = {
      emissionPointId: point.data.id,
      buyerPartyId: customer.data.id,
      lines: [{ productId: product.data.id, quantity: "3", discount: "1.25" }],
      payments: [{ paymentMethod: "01" }],
    };

    // 2. Apagada: la emisión deja su job de transmisión, que nadie toma, y nada sale del proceso.
    const operator = await signIn(OPERATOR.email, OPERATOR.password);
    const first = await emit(operator, draftBody);
    const ready = (await (await fetch(`${backend.base}/health/ready`)).json()) as object;
    expect(ready).toEqual({
      status: "ready",
      sriTransmission: "disabled",
      rideAssets: "available",
    });
    expect(await metric("sri_transmission_enabled")).toBe("sri_transmission_enabled 0");
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const pending = await db.database.prisma.job.findMany({ where: { documentId: first.id } });
    expect(pending.map((job) => [job.type, job.status, job.attemptCount, job.leaseOwner])).toEqual([
      ["sri.transmit", "PENDING", 0, null],
    ]);
    expect(await db.database.prisma.sriAttempt.count()).toBe(0);
    expect([sri.calls, proxy.destinations]).toEqual([[], []]);

    // 3. Política de tamaño SINTÉTICA (Q-47 sigue abierta) y rearranque con la transmisión
    //    habilitada: la factura pendiente se envía con sus bytes exactos y queda autorizada.
    await backend.stop();
    await installSyntheticSizePolicy(db.database.prisma, [
      syntheticSizePolicy({ maxSignedDocumentBytes: 1_000_000 }),
    ]);
    backend = await start(enabledEnv());
    expect(await (await fetch(`${backend.base}/health/ready`)).json()).toEqual({
      status: "ready",
      sriTransmission: "enabled",
    });
    expect(await metric("sri_transmission_enabled")).toBe("sri_transmission_enabled 1");
    await waitForState(first.id, "AUTHORIZED", 30_000);
    const signed = await db.database.prisma.documentArtifact.findFirstOrThrow({
      where: { documentId: first.id, kind: "SIGNED_XML" },
    });
    expect(sri.received.get(first.accessKey)?.equals(Buffer.from(signed.content))).toBe(true);
    expect(callsFor(first.accessKey)).toEqual(["RECEPTION", "AUTHORIZATION"]);
    const authorizedXml = await db.database.prisma.documentArtifact.findFirstOrThrow({
      where: { documentId: first.id, kind: "AUTHORIZED_XML" },
    });
    expect(Buffer.from(authorizedXml.content).equals(Buffer.from(signed.content))).toBe(true);
    expect(await transitionsOf(first.id)).toEqual([
      "∅→RESERVED (EMISSION)",
      "RESERVED→SIGNED (SIGNING)",
      "SIGNED→RECEIVED (TRANSMISSION)",
      "RECEIVED→AUTHORIZED (AUTHORIZATION)",
    ]);

    // 4. Caída a mitad del envío: el SRI recibe los bytes y el proceso muere antes de la
    //    respuesta, sin registrar el intento. Al volver, la llamada interrumpida no se repite: la
    //    factura pasa a SEND_UNKNOWN y la reconciliación la encuentra autorizada.
    sri.behaviors.set(2, "HOLD");
    const held = sri.nextHold();
    const operatorEnabled = await signIn(OPERATOR.email, OPERATOR.password);
    const second = await emit(operatorEnabled, draftBody);
    expect(await held).toBe(second.accessKey);
    await backend.crash();
    sri.releaseHeld();
    const leased = await db.database.prisma.job.findFirstOrThrow({
      where: { documentId: second.id, type: "sri.transmit" },
    });
    expect([leased.status, leased.attemptCount]).toEqual(["LEASED", 1]);
    expect(await db.database.prisma.sriAttempt.count({ where: { documentId: second.id } })).toBe(0);
    backend = await start(enabledEnv());
    // La concesión de 30 s de la llamada interrumpida tiene que vencer antes de retomarla.
    await waitForState(second.id, "AUTHORIZED", 90_000);
    expect(callsFor(second.accessKey)).toEqual(["RECEPTION", "AUTHORIZATION"]);
    expect(await transitionsOf(second.id)).toEqual([
      "∅→RESERVED (EMISSION)",
      "RESERVED→SIGNED (SIGNING)",
      "SIGNED→SEND_UNKNOWN (TRANSMISSION)",
      "SEND_UNKNOWN→AUTHORIZED (RECONCILIATION)",
    ]);

    // 5. Revisión manual y reconciliación pedida por el administrador: el operador no puede.
    sri.behaviors.set(3, "FOREIGN_KEY");
    const third = await emit(operatorEnabled, draftBody);
    await waitForState(third.id, "MANUAL_REVIEW", 30_000);
    expect(callsFor(third.accessKey)).toEqual(["RECEPTION"]);
    const reason = { reason: "El SRI devolvió una clave ajena; se verifica la factura." };
    expect(
      (await api("POST", `/invoices/${third.id}/reconciliations`, operatorEnabled, reason)).status,
    ).toBe(403);
    const adminEnabled = await signIn(ADMIN.email, ADMIN.password);
    const requested = await api<InvoiceView>(
      "POST",
      `/invoices/${third.id}/reconciliations`,
      adminEnabled,
      reason,
    );
    expect(requested.status, JSON.stringify(requested.error)).toBe(202);
    await waitForState(third.id, "AUTHORIZED", 30_000);
    expect(callsFor(third.accessKey)).toEqual(["RECEPTION", "AUTHORIZATION"]);
    // La clave ajena es una recepción inconsistente: pasa por SEND_UNKNOWN a revisión manual (D11),
    // y solo la reconciliación del administrador la saca de ahí (design D4).
    expect(await transitionsOf(third.id)).toEqual([
      "∅→RESERVED (EMISSION)",
      "RESERVED→SIGNED (SIGNING)",
      "SIGNED→SEND_UNKNOWN (TRANSMISSION)",
      "SEND_UNKNOWN→MANUAL_REVIEW (TRANSMISSION)",
      "MANUAL_REVIEW→AUTHORIZED (RECONCILIATION)",
    ]);
    const adminUserId = (
      await db.database.prisma.user.findFirstOrThrow({ where: { email: ADMIN.email } })
    ).id;
    const lastTransition = await db.database.prisma.documentStateTransition.findFirstOrThrow({
      where: { documentId: third.id, toState: "AUTHORIZED" },
    });
    expect([lastTransition.actorType, lastTransition.actorUserId]).toEqual(["USER", adminUserId]);

    // 6. Consultas: la lista, el detalle con la autorización y el historial sin datos técnicos.
    const list = await api<InvoiceSummaryView[]>("GET", "/invoices", operatorEnabled);
    expect(list.data.map((invoice) => [invoice.documentNumber, invoice.state])).toEqual([
      ["001-001-000000003", "AUTHORIZED"],
      ["001-001-000000002", "AUTHORIZED"],
      ["001-001-000000001", "AUTHORIZED"],
    ]);
    const detail = await api<InvoiceView>("GET", `/invoices/${first.id}`, operatorEnabled);
    expect(detail.data.transmission).toMatchObject({
      authorization: { number: first.accessKey, environment: "TEST" },
      stopped: null,
      reconcilable: false,
      inProgress: false,
    });
    expect(detail.data.transmission.lastResult?.messages).toEqual([
      expect.objectContaining({ identifier: "60", type: "ADVERTENCIA" }),
    ]);
    const history = await api<{ events: unknown[] }>(
      "GET",
      `/invoices/${third.id}/transmission`,
      operatorEnabled,
    );
    expect(history.status).toBe(200);
    expect(JSON.stringify(history.data)).not.toMatch(/<\?xml|soap|Envelope|https?:/i);

    // 7. Auditoría exacta: la transmisión automática no audita; la reconciliación pedida sí, con
    //    el administrador, el motivo y el resultado, sin XML.
    const events = await db.database.prisma.auditEvent.findMany({
      orderBy: { occurredAt: "asc" },
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
      "invoice.reserved",
      "invoice.signed",
      "invoice.reconciliation_requested",
      "invoice.reconciliation_completed",
    ]);
    const [reconRequested, reconCompleted] = events.slice(-2);
    expect([reconRequested?.actorUserId, reconRequested?.changes]).toEqual([
      adminUserId,
      {
        invoiceId: third.id,
        documentNumber: "001-001-000000003",
        state: "MANUAL_REVIEW",
        reason: reason.reason,
      },
    ]);
    expect([reconCompleted?.actorUserId, reconCompleted?.changes]).toEqual([
      adminUserId,
      {
        invoiceId: third.id,
        documentNumber: "001-001-000000003",
        result: "AUTHORIZED",
        state: "AUTHORIZED",
      },
    ]);
    expect(JSON.stringify(events.map((event) => event.changes))).not.toMatch(/<\?xml|<factura/);

    // 8. Toda la salida del backend, en los tres arranques, fue al SRI simulado.
    expect(proxy.destinations.length).toBeGreaterThan(0);
    expect(proxy.destinations.filter((d) => !d.startsWith(SRI_HOST))).toEqual([]);
    expect(sri.calls.every((call) => call.operation !== "VALIDITY")).toBe(true);

    // 9. Con la transmisión habilitada y el SRI caído, la emisión hasta firmado y las consultas
    //    siguen funcionando; el resultado del envío queda incierto, nunca devuelto ni rechazado.
    sri.setDown(true);
    const whileDown = await emit(operatorEnabled, draftBody);
    await waitForState(whileDown.id, "SEND_UNKNOWN", 30_000);
    const [failed] = await db.database.prisma.sriAttempt.findMany({
      where: { documentId: whileDown.id },
    });
    expect(failed!.transportOutcome).toBe("CONNECTION_LOST");
    const listDown = await api<InvoiceSummaryView[]>("GET", "/invoices", operatorEnabled);
    expect(listDown.status).toBe(200);
    expect(listDown.data.map((invoice) => invoice.documentNumber)[0]).toBe("001-001-000000004");
    const detailDown = await api<InvoiceView>("GET", `/invoices/${whileDown.id}`, operatorEnabled);
    expect(detailDown.status).toBe(200);
    expect(detailDown.data.state).toBe("SEND_UNKNOWN");
    expect(proxy.destinations.filter((d) => !d.startsWith(SRI_HOST))).toEqual([]);
  }, 240_000);
});
