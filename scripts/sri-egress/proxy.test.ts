// Proxy de salida contra destinos simulados (docs/quality/sri-egress-allowlist.md;
// improve-sri-transport-failure-diagnostics, design D2 y D3). El `dial` lleva cada túnel admitido a
// un servidor local: nada resuelve ni conecta con un host real.
import { connect, createServer, type AddressInfo, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createEgressProxy, type EgressLogEntry } from "./proxy.ts";

const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0))
    await new Promise<void>((resolve) => server.close(() => resolve()));
});

const listen = async (server: Server) => {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  return (server.address() as AddressInfo).port;
};

/** Proxy cuyo `dial` lleva todo túnel admitido a `127.0.0.1:<upstreamPort>`. */
async function proxyTo(upstreamPort: number) {
  const entries: EgressLogEntry[] = [];
  const dialed: string[] = [];
  const proxy = createEgressProxy({
    dial: (host, port) => {
      dialed.push(`${host}:${port}`);
      return connect(upstreamPort, "127.0.0.1");
    },
    log: (entry) => entries.push(entry),
  });
  return { port: await listen(proxy), entries, dialed };
}

/**
 * Abre un túnel `CONNECT`, envía `payload` tras el `200` (y cierra su lado si `endAfter`), y
 * devuelve la línea de estado y todo lo recibido después de las cabeceras del proxy.
 */
function tunnel(
  proxyPort: number,
  options: { target?: string; payload?: string; endAfter?: boolean } = {},
) {
  const target = options.target ?? "celcer.sri.gob.ec:443";
  return new Promise<{ status: string; afterHeaders: string; raw: string }>((resolve) => {
    const socket: Socket = connect(proxyPort, "127.0.0.1");
    let raw = "";
    let sent = false;
    socket.on("error", () => undefined);
    socket.on("data", (chunk: Buffer) => {
      raw += chunk.toString("latin1");
      if (!sent && raw.startsWith("HTTP/1.1 200") && raw.includes("\r\n\r\n")) {
        sent = true;
        if (options.payload) socket.write(options.payload);
        if (options.endAfter) socket.end();
      }
    });
    socket.on("close", () => {
      const split = raw.indexOf("\r\n\r\n");
      resolve({
        status: raw.split("\r\n")[0] ?? "",
        afterHeaders: split < 0 ? "" : raw.slice(split + 4),
        raw,
      });
    });
    socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`);
  });
}

const until = async (condition: () => boolean, ms = 3_000) => {
  const deadline = Date.now() + ms;
  while (!condition() && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 20));
};
const closedEvent = (entries: EgressLogEntry[]) =>
  entries.find((e) => "event" in e && e.event === "TUNNEL_CLOSED") as
    Record<string, unknown> | undefined;

describe("túnel del proxy de salida", () => {
  it("un fallo del destino con el túnel ya establecido no escribe un 502 dentro del túnel", async () => {
    const upstreamPort = await listen(
      createServer((socket) => {
        socket.on("error", () => undefined);
        socket.once("data", () => {
          socket.write("respuesta", () => setTimeout(() => socket.resetAndDestroy(), 50));
        });
      }),
    );
    const { port, entries } = await proxyTo(upstreamPort);
    const result = await tunnel(port, { payload: "hola" });
    expect(result.status).toBe("HTTP/1.1 200 Connection Established");
    expect(result.afterHeaders).toBe("respuesta");
    expect(result.raw).not.toContain("502");
    await until(() => closedEvent(entries) !== undefined);
    expect(closedEvent(entries)).toMatchObject({
      closedFirstBy: "upstream",
      upstreamEnd: "ERROR",
      upstreamError: "ECONNRESET",
      bytesToUpstream: 4,
      bytesToClient: 9,
    });
  });

  it("un cierre limpio del destino queda registrado con los bytes, sin contenido", async () => {
    const upstreamPort = await listen(
      createServer((socket) => {
        socket.once("data", () => socket.end("respuesta-SECRETA"));
      }),
    );
    const { port, entries, dialed } = await proxyTo(upstreamPort);
    const result = await tunnel(port, { payload: "solicitud-SECRETA" });
    expect(result.afterHeaders).toBe("respuesta-SECRETA");
    await until(() => closedEvent(entries) !== undefined);
    expect(dialed).toEqual(["celcer.sri.gob.ec:443"]);
    const decision = entries[0] as Record<string, unknown>;
    expect(decision).toMatchObject({
      method: "CONNECT",
      allowed: true,
      reason: "ALLOWED_SRI_TEST",
    });
    const id = decision.tunnel;
    expect(typeof id).toBe("number");
    expect(entries.find((e) => "event" in e && e.event === "UPSTREAM_CONNECTED")).toMatchObject({
      tunnel: id,
      family: "IPv4",
      connectMs: expect.any(Number) as number,
    });
    expect(closedEvent(entries)).toMatchObject({
      tunnel: id,
      closedFirstBy: "upstream",
      upstreamEnd: "FIN",
      upstreamError: null,
      bytesToUpstream: "solicitud-SECRETA".length,
      bytesToClient: "respuesta-SECRETA".length,
      durationMs: expect.any(Number) as number,
      clientIdleBeforeCloseMs: expect.any(Number) as number,
    });
    expect(JSON.stringify(entries)).not.toContain("SECRETA");
  });

  it("si el cliente cierra primero, el registro lo dice", async () => {
    const upstreamPort = await listen(
      createServer((socket) => {
        socket.on("error", () => undefined);
        socket.on("data", () => undefined);
      }),
    );
    const { port, entries } = await proxyTo(upstreamPort);
    await tunnel(port, { payload: "hola", endAfter: true });
    await until(() => closedEvent(entries) !== undefined);
    // El destino responde al FIN del cliente con el suyo: lo que importa es quién cerró primero.
    expect(closedEvent(entries)).toMatchObject({ closedFirstBy: "client", upstreamError: null });
  });

  it("si el destino rechaza la conexión, responde 502 antes del túnel y registra el código", async () => {
    const closed = await listen(createServer());
    servers.pop()!.close();
    const { port, entries } = await proxyTo(closed);
    const result = await tunnel(port);
    expect(result.status).toBe("HTTP/1.1 502 Bad Gateway");
    expect(result.raw).toContain("X-Egress-Decision: UPSTREAM_FAILED");
    expect(
      entries.find((e) => "event" in e && e.event === "UPSTREAM_CONNECT_FAILED"),
    ).toMatchObject({ code: "ECONNREFUSED", connectMs: expect.any(Number) as number });
    expect(entries.some((e) => "event" in e && e.event === "UPSTREAM_CONNECTED")).toBe(false);
    expect(closedEvent(entries)).toBeUndefined();
  });

  it("Producción recibe 403 sin marcar ni abrir un túnel", async () => {
    const upstreamPort = await listen(createServer());
    const { port, entries, dialed } = await proxyTo(upstreamPort);
    const result = await tunnel(port, { target: "cel.sri.gob.ec:443" });
    expect(result.status).toBe("HTTP/1.1 403 Forbidden");
    expect(result.raw).toContain("X-Egress-Decision: PRODUCTION_ACCESS_BLOCKED");
    expect(dialed).toEqual([]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).not.toHaveProperty("tunnel");
  });
});
