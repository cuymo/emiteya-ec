// El transporte SOAP a través de un proxy `CONNECT`, como en la sesión de certificación
// (improve-sri-transport-failure-diagnostics, design D4). El transporte corre en un proceso hijo con el
// proxy del entorno; el proxy y el «SRI» son servidores locales, con un nombre `.test` que nunca se
// resuelve: ninguna prueba habla con el SRI. El proxy local reproduce la semántica del proxy de salida
// (`200` al conectar con el destino, `502` si no puede, sin respuesta dentro del túnel), que se
// prueba aparte en `scripts/sri-egress/proxy.test.ts`. La transición fiscal de cada clase se prueba en
// `test/integration/transmit-handler.test.ts`: un corte va a `SEND_UNKNOWN` con su reconciliación y
// `NOT_SENT` no cambia el estado.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer as createHttpServer, type IncomingMessage } from "node:http";
import { connect, createServer, type AddressInfo, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Duplex } from "node:stream";
import { TLSSocket } from "node:tls";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const HOST = "sri-simulado.test";
const ENDPOINT = `https://${HOST}/comprobantes-electronicos-ws/RecepcionComprobantesOffline`;
const ENVELOPE_BYTES = 13_812;
const CHILD = new URL("../support/proxy-transport-child.ts", import.meta.url).pathname;
const BACKEND = new URL("../..", import.meta.url).pathname;

type Behavior = "normal" | "fin-after-request" | "rst-after-request" | "silent-then-fin";
type Result = {
  kind: string;
  errorCode: string | null;
  httpStatus: number | null;
  headers: boolean;
  ms: number;
  diagnostic: {
    phase: string;
    causes: { name: string; code: string | null }[];
    socket: { bytesWritten: number; bytesRead: number } | null;
  } | null;
};

let dir: string;
let key: Buffer;
let cert: Buffer;
const servers: Server[] = [];

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "facturador-proxy-tls-"));
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
      `/CN=${HOST}`,
      "-addext",
      `subjectAltName=DNS:${HOST}`,
    ],
    { encoding: "utf8" },
  );
  expect(generated.status, generated.stderr).toBe(0);
  key = readFileSync(join(dir, "key.pem"));
  cert = readFileSync(join(dir, "cert.pem"));
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

// Cada servidor se cierra cortando sus conexiones abiertas: un túnel a medio cerrar no debe colgar la
// limpieza.
const connections = new WeakMap<Server, Set<Socket>>();
afterEach(async () => {
  for (const server of servers.splice(0)) {
    for (const socket of connections.get(server) ?? []) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function listen(server: Server) {
  servers.push(server);
  const open = new Set<Socket>();
  connections.set(server, open);
  server.on("connection", (socket: Socket) => {
    open.add(socket);
    socket.on("close", () => open.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  return (server.address() as AddressInfo).port;
}

/** «SRI» TLS local: cada conexión sigue el comportamiento que le toca en la lista. */
function fakeSri(behaviors: Behavior[]) {
  let index = 0;
  return createServer((raw) => {
    raw.on("error", () => undefined);
    const behavior = behaviors[Math.min(index++, behaviors.length - 1)];
    const socket = new TLSSocket(raw, { isServer: true, key, cert });
    socket.on("error", () => undefined);
    let received = Buffer.alloc(0);
    let expected: number | null = null;
    socket.on("data", (chunk: Buffer) => {
      received = Buffer.concat([received, chunk]);
      const end = received.indexOf("\r\n\r\n");
      if (end < 0 || expected === Infinity) return;
      expected ??=
        end + 4 + Number(/content-length: *(\d+)/i.exec(received.subarray(0, end).toString())?.[1]);
      if (received.length < expected) return;
      expected = Infinity;
      if (behavior === "normal") {
        const body = "<soap:Envelope><RECIBIDA/></soap:Envelope>";
        socket.end(
          `HTTP/1.1 200 OK\r\ncontent-type: text/xml\r\ncontent-length: ${body.length}\r\nconnection: close\r\n\r\n${body}`,
        );
      } else if (behavior === "fin-after-request") socket.end();
      else if (behavior === "rst-after-request") raw.resetAndDestroy();
      else setTimeout(() => socket.end(), 300);
    });
  });
}

/** Proxy `CONNECT` local con la semántica del proxy de salida. */
function connectProxy(upstreamPort: number) {
  const proxy = createHttpServer();
  proxy.on("connect", (_req: IncomingMessage, client: Duplex) => {
    client.on("error", () => undefined);
    let established = false;
    const upstream = connect(upstreamPort, "127.0.0.1");
    upstream.on("error", () => {
      if (!established && client.writable)
        client.end("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
      client.destroy();
    });
    upstream.once("connect", () => {
      established = true;
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      upstream.pipe(client);
      client.pipe(upstream);
    });
    client.on("close", () => upstream.destroy());
  });
  return proxy;
}

/** Ejecuta el transporte en un proceso hijo, con el proxy del entorno en `proxyPort`. */
function runTransport(proxyPort: number, requests = 1): Promise<Result[]> {
  const proxy = `http://127.0.0.1:${proxyPort}`;
  const child = spawn(
    process.execPath,
    ["--conditions=development", CHILD, ENDPOINT, String(requests), String(ENVELOPE_BYTES)],
    {
      cwd: BACKEND,
      env: {
        PATH: process.env.PATH,
        NODE_USE_ENV_PROXY: "1",
        HTTPS_PROXY: proxy,
        HTTP_PROXY: proxy,
        NO_PROXY: "",
        NODE_EXTRA_CA_CERTS: join(dir, "cert.pem"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let out = "";
  let err = "";
  child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => (err += chunk.toString()));
  return new Promise((resolve, reject) => {
    child.on("exit", (code) => {
      if (code !== 0) return reject(new Error(`el proceso hijo falló (${code}): ${err}`));
      resolve(
        out
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as Result),
      );
    });
  });
}

async function throughProxy(upstream: Server, requests = 1) {
  const proxyPort = await listen(connectProxy(await listen(upstream)));
  return runTransport(proxyPort, requests);
}

describe("transporte a través de un proxy CONNECT (sin red real)", () => {
  it("la primera y la segunda solicitud de un proceso nuevo reciben su respuesta", async () => {
    const results = await throughProxy(fakeSri(["normal"]), 2);
    expect(results.map((r) => [r.kind, r.httpStatus])).toEqual([
      ["RESPONSE", 200],
      ["RESPONSE", 200],
    ]);
  }, 30_000);

  it.each<[Behavior, string]>([
    ["fin-after-request", "el destino cierra tras leer la solicitud"],
    ["rst-after-request", "el destino resetea tras leer la solicitud"],
  ])(
    "%s (%s): incierto, con la solicitud escrita y nada leído",
    async (behavior) => {
      const [result] = await throughProxy(fakeSri([behavior]));
      expect(result).toMatchObject({
        kind: "CONNECTION_LOST",
        errorCode: "UND_ERR_SOCKET",
        headers: false,
      });
      expect(result!.diagnostic!.phase).toBe("BEFORE_HEADERS");
      expect(result!.diagnostic!.socket!.bytesWritten).toBeGreaterThanOrEqual(ENVELOPE_BYTES);
      expect(result!.diagnostic!.socket!.bytesRead).toBe(0);
    },
    30_000,
  );

  it("si la primera falla y la segunda pasa, cada una conserva su clase", async () => {
    const results = await throughProxy(fakeSri(["fin-after-request", "normal"]), 2);
    expect(results.map((r) => r.kind)).toEqual(["CONNECTION_LOST", "RESPONSE"]);
  }, 30_000);

  it("silencio y cierre del destino tras unos instantes: la firma observada en Pruebas, incierta", async () => {
    const [result] = await throughProxy(fakeSri(["silent-then-fin"]));
    expect(result).toMatchObject({
      kind: "CONNECTION_LOST",
      errorCode: "UND_ERR_SOCKET",
      headers: false,
    });
    expect(result!.ms).toBeGreaterThanOrEqual(250);
  }, 30_000);

  it("un corte durante el TLS o justo tras el CONNECT: sin solicitud escrita, pero incierto por su código (D4)", async () => {
    const tlsCut = createServer((socket: Socket) => {
      socket.on("error", () => undefined);
      socket.once("data", () => socket.destroy());
    });
    const endOnConnect = createServer((socket: Socket) => {
      socket.on("error", () => undefined);
      socket.end();
    });
    for (const upstream of [tlsCut, endOnConnect]) {
      const [result] = await throughProxy(upstream);
      expect(result).toMatchObject({ kind: "CONNECTION_LOST", errorCode: "ECONNRESET" });
    }
  }, 30_000);

  it("un 502 del proxy: el destino no se alcanzó, pero sigue incierto (D4)", async () => {
    const closed = await listen(createServer());
    await new Promise<void>((resolve) => servers.pop()!.close(() => resolve()));
    const proxyPort = await listen(connectProxy(closed));
    const [result] = await runTransport(proxyPort);
    expect(result).toMatchObject({ kind: "CONNECTION_LOST", errorCode: "UND_ERR_ABORTED" });
  }, 30_000);

  it("sin proxy escuchando: NOT_SENT, la única prueba de que nada salió", async () => {
    const closed = await listen(createServer());
    await new Promise<void>((resolve) => servers.pop()!.close(() => resolve()));
    const [result] = await runTransport(closed);
    expect(result).toMatchObject({ kind: "NOT_SENT", errorCode: "ECONNREFUSED" });
    expect(result!.diagnostic!.causes).toContainEqual(
      expect.objectContaining({ code: "ECONNREFUSED" }),
    );
  }, 30_000);
});
