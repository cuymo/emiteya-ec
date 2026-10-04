// Contrato del transporte SOAP propio (add-sri-transmission, tarea 5.2, design D10), contra
// servidores locales: ninguna prueba habla con el SRI. La frontera es explícita: solo lo que prueba
// que la solicitud no salió es `NOT_SENT`; todo lo demás es incierto o es una respuesta.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import {
  createServer as createNetServer,
  type AddressInfo,
  type Server,
  type Socket,
} from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  resolveSriEndpoints,
  type SriEndpoints,
} from "../../src/modules/sri-engine/infrastructure/endpoints.ts";
import {
  classifyRequestFailure,
  createSoapTransport,
} from "../../src/modules/sri-engine/infrastructure/soap-transport.ts";

const ENVELOPE = Buffer.from('<?xml version="1.0" encoding="UTF-8"?>\n<soapenv:Envelope/>');
const servers: (Server | HttpServer)[] = [];

async function listen<T extends Server | HttpServer>(server: T): Promise<string> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  return `127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** Transporte con un endpoint de prueba para el servicio de recepción de Pruebas. */
function transportTo(
  url: string,
  overrides: Partial<Parameters<typeof createSoapTransport>[0]> = {},
) {
  const endpoints: SriEndpoints = resolveSriEndpoints({ SRI_ENDPOINT_TEST_RECEPTION: url });
  return createSoapTransport({
    endpoints,
    requestTimeoutMs: 400,
    bodyTimeoutMs: 400,
    maxResponseBytes: 64 * 1024,
    ...overrides,
  });
}
const exchange = (url: string, envelope = ENVELOPE, overrides = {}) =>
  transportTo(url, overrides).exchange({
    environment: "TEST",
    service: "RECEPTION",
    envelope,
  });

/** Servidor HTTP que responde con lo que indique `respond` y registra cada solicitud. */
async function httpServer(
  respond: (
    req: import("node:http").IncomingMessage,
    res: import("node:http").ServerResponse,
    body: Buffer,
  ) => void,
) {
  const received: { method: string; headers: Record<string, unknown>; body: Buffer }[] = [];
  const server = createHttpServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      received.push({ method: req.method!, headers: req.headers, body });
      respond(req, res, body);
    });
  });
  return { url: `http://${await listen(server)}/ws`, received };
}

afterAll(async () => {
  for (const server of servers) {
    (server as HttpServer).closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
});

describe("NOT_SENT: solo lo que prueba que la solicitud no salió", () => {
  it("un puerto cerrado", async () => {
    const port = await listen(createNetServer());
    const closed = servers.pop()!;
    await new Promise((resolve) => closed.close(resolve));
    const result = await exchange(`http://${port}/ws`);
    expect(result.outcome).toMatchObject({
      kind: "NOT_SENT",
      errorCode: "ECONNREFUSED",
      headersAt: null,
    });
  });

  it("un nombre .invalid que no resuelve", async () => {
    const result = await exchange("http://sri-simulado.invalid/ws", ENVELOPE, {
      requestTimeoutMs: 15_000,
    });
    expect(result.outcome.kind).toBe("NOT_SENT");
    expect(["ENOTFOUND", "EAI_AGAIN"]).toContain(
      (result.outcome as { errorCode: string }).errorCode,
    );
  });

  describe("TLS con un certificado no confiable", () => {
    let dir: string;
    let url: string;
    let requests = 0;

    beforeAll(async () => {
      dir = mkdtempSync(join(tmpdir(), "facturador-tls-"));
      const generated = spawnSync(
        "openssl",
        [
          "req",
          "-x509",
          "-newkey",
          "rsa:2048",
          "-nodes",
          "-keyout",
          join(dir, "key.pem"),
          "-out",
          join(dir, "cert.pem"),
          "-days",
          "1",
          "-subj",
          "/CN=localhost",
        ],
        { encoding: "utf8" },
      );
      expect(generated.status, generated.stderr).toBe(0);
      const server = createHttpsServer(
        { key: readFileSync(join(dir, "key.pem")), cert: readFileSync(join(dir, "cert.pem")) },
        (_req, res) => {
          requests++;
          res.end("<no-deberia-llegar/>");
        },
      );
      url = `https://${await listen(server)}/ws`;
    });

    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it("falla la verificación antes de escribir la solicitud", async () => {
      const result = await exchange(url);
      expect(result.outcome.kind).toBe("NOT_SENT");
      expect((result.outcome as { errorCode: string }).errorCode).toMatch(/SELF_SIGNED|CERT/);
      expect(requests).toBe(0);
    });
  });

  it("el plazo de conexión interno y causas anidadas se reconocen; una causa desconocida, no", () => {
    const connectTimeout = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("Connect Timeout Error"), { code: "UND_ERR_CONNECT_TIMEOUT" }),
    });
    expect(classifyRequestFailure(connectTimeout)).toEqual({
      kind: "NOT_SENT",
      errorCode: "UND_ERR_CONNECT_TIMEOUT",
    });
    const nested = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("x"), {
        cause: Object.assign(new Error("y"), { code: "EAI_AGAIN" }),
      }),
    });
    expect(classifyRequestFailure(nested).kind).toBe("NOT_SENT");
    const unknown = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("z"), { code: "ESOMETHINGNEW" }),
    });
    expect(classifyRequestFailure(unknown)).toEqual({
      kind: "CONNECTION_LOST",
      errorCode: "ESOMETHINGNEW",
    });
    expect(classifyRequestFailure(new TypeError("fetch failed"))).toEqual({
      kind: "CONNECTION_LOST",
      errorCode: "UNKNOWN",
    });
    const reset = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" }),
    });
    expect(classifyRequestFailure(reset).kind).toBe("CONNECTION_LOST");
  });

  it("solo la verificación del certificado TLS es NOT_SENT; otro fallo de TLS o del handshake es incierto (D10)", () => {
    const failing = (code: string) =>
      classifyRequestFailure(
        Object.assign(new TypeError("fetch failed"), {
          cause: Object.assign(new Error("tls"), { code }),
        }),
      ).kind;
    for (const code of [
      "CERT_HAS_EXPIRED",
      "DEPTH_ZERO_SELF_SIGNED_CERT",
      "SELF_SIGNED_CERT_IN_CHAIN",
      "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
      "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      "ERR_TLS_CERT_ALTNAME_INVALID",
      "HOSTNAME_MISMATCH",
    ]) {
      expect(failing(code), code).toBe("NOT_SENT");
    }
    // Sin comodín ERR_TLS_*: pueden ocurrir con la conexión ya abierta.
    for (const code of [
      "ERR_TLS_RENEGOTIATION_DISABLED",
      "ERR_TLS_HANDSHAKE_TIMEOUT",
      "ERR_SSL_WRONG_VERSION_NUMBER",
      "EPROTO",
      "ECONNRESET",
    ]) {
      expect(failing(code), code).toBe("CONNECTION_LOST");
    }
  });
});

describe("inciertos: la solicitud pudo salir", () => {
  it("un servidor que acepta y no responde agota el plazo de cabeceras", async () => {
    const sockets: Socket[] = [];
    const port = await listen(createNetServer((socket) => void sockets.push(socket)));
    const result = await exchange(`http://${port}/ws`);
    expect(result.outcome).toMatchObject({ kind: "REQUEST_TIMEOUT", headersAt: null });
    sockets.forEach((socket) => socket.destroy());
  });

  it("un corte del socket después de leer la solicitud", async () => {
    const port = await listen(
      createNetServer((socket) => {
        let seen = Buffer.alloc(0);
        socket.on("data", (chunk: Buffer) => {
          seen = Buffer.concat([seen, chunk]);
          if (seen.includes(ENVELOPE)) socket.destroy();
        });
      }),
    );
    const result = await exchange(`http://${port}/ws`);
    expect(result.outcome.kind).toBe("CONNECTION_LOST");
  });

  it("un abort durante la subida de un sobre grande", async () => {
    const sockets: Socket[] = [];
    const port = await listen(
      createNetServer((socket) => {
        socket.pause();
        sockets.push(socket);
      }),
    );
    const result = await exchange(`http://${port}/ws`, Buffer.alloc(16 * 1024 * 1024, 0x41));
    expect(result.outcome).toMatchObject({ kind: "REQUEST_TIMEOUT", headersAt: null });
    sockets.forEach((socket) => socket.destroy());
  });

  it("cabeceras sin cuerpo agotan el plazo de lectura", async () => {
    const { url } = await httpServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/xml", "content-length": "1000" });
      res.write("<parcial>");
    });
    const result = await exchange(url);
    expect(result.outcome.kind).toBe("BODY_TIMEOUT");
    expect(result.outcome.headersAt).toBeInstanceOf(Date);
  });
});

describe("respuestas: el transporte no reinterpreta el cuerpo", () => {
  it("una respuesta válida conserva sus bytes exactos, el estado, las cabeceras seguras y los tiempos", async () => {
    const body = Buffer.from(
      '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>ñ</soap:Body></soap:Envelope>',
    );
    const { url, received } = await httpServer((_req, res) => {
      res.writeHead(200, {
        "content-type": "text/xml;charset=UTF-8",
        "content-length": String(body.length),
        "set-cookie": "sesion=secreta",
        "x-servidor": "interno",
      });
      res.end(body);
    });
    const result = await exchange(url);
    expect(result).toMatchObject({ service: "RECEPTION", environment: "TEST", endpoint: url });
    expect(result.envelope.equals(ENVELOPE)).toBe(true);
    const outcome = result.outcome;
    if (outcome.kind !== "RESPONSE") throw new Error(outcome.kind);
    expect(outcome.httpStatus).toBe(200);
    expect(outcome.body.equals(body)).toBe(true);
    expect(outcome.truncated).toBe(false);
    expect(Object.keys(outcome.headers).sort()).toEqual(["content-length", "content-type", "date"]);
    expect(
      outcome.startedAt <= outcome.headersAt! && outcome.headersAt! <= outcome.completedAt,
    ).toBe(true);
    expect(received).toHaveLength(1);
    expect(received[0]!.method).toBe("POST");
    expect(received[0]!.headers["content-type"]).toBe("text/xml; charset=utf-8");
    expect(received[0]!.headers.soapaction).toBe('""');
    expect(received[0]!.body.equals(ENVELOPE)).toBe(true);
  });

  it("HTML con 200, Fault con 500 y cuerpo vacío llegan tal cual", async () => {
    const cases: [number, string][] = [
      [200, "<html><body>Servicio no disponible</body></html>"],
      [
        500,
        '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><soap:Fault><faultstring>x</faultstring></soap:Fault></soap:Body></soap:Envelope>',
      ],
      [200, ""],
    ];
    for (const [status, text] of cases) {
      const { url } = await httpServer((_req, res) => {
        res.writeHead(status, { "content-type": "text/html" });
        res.end(text);
      });
      const result = await exchange(url);
      expect(result.outcome).toMatchObject({
        kind: "RESPONSE",
        httpStatus: status,
        truncated: false,
      });
      expect((result.outcome as { body: Buffer }).body.toString()).toBe(text);
    }
  });

  it("una respuesta gigante se corta en el límite y queda marcada", async () => {
    const { url } = await httpServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/xml" });
      res.end(Buffer.alloc(200 * 1024, 0x42));
    });
    const result = await exchange(url, ENVELOPE, { maxResponseBytes: 64 * 1024 });
    expect(result.outcome).toMatchObject({ kind: "RESPONSE", truncated: true });
    expect((result.outcome as { body: Buffer }).body).toHaveLength(64 * 1024);
  });

  it("una redirección no se sigue: repetiría el envío en otra dirección", async () => {
    const { url, received } = await httpServer((_req, res) => {
      res.writeHead(307, { location: "http://127.0.0.1:1/otro" });
      res.end();
    });
    const result = await exchange(url);
    expect(result.outcome).toMatchObject({ kind: "RESPONSE", httpStatus: 307 });
    expect(received).toHaveLength(1);
  });
});
