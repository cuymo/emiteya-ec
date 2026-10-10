// Proxy de salida de la sesión de certificación (docs/quality/sri-egress-allowlist.md).
// - Escucha en un socket Unix, fuera del espacio de nombres de red del proceso de la certificación.
// - Solo admite CONNECT a celcer.sri.gob.ec:443. Nunca reenvía peticiones HTTP en claro.
// - Decide antes de resolver DNS o de abrir la conexión: un destino rechazado no genera tráfico.
// - Registra cada decisión y el ciclo de vida de cada túnel admitido, sin contenido. El tráfico
//   admitido es TLS de extremo a extremo y no se inspecciona.
// - Con el túnel ya establecido nunca escribe una respuesta HTTP dentro de él: un fallo del destino
//   solo cierra la conexión del cliente (improve-sri-transport-failure-diagnostics, design D3).
import { createServer, type IncomingMessage, type Server } from "node:http";
import { connect, type Socket } from "node:net";
import type { Duplex } from "node:stream";
import { decideEgress, type EgressDecision } from "./policy.ts";

export type Dial = (host: string, port: number) => Socket;

export type EgressDecisionEntry = Readonly<{
  at: string;
  method: string;
  host: string | null;
  port: number | null;
  allowed: boolean;
  reason: EgressDecision["reason"];
  /** Número del túnel en este proceso, solo para un CONNECT admitido. */
  tunnel?: number;
}>;

/** Ciclo de vida de un túnel admitido, sin contenido (design D2). */
export type EgressTunnelEntry = Readonly<
  { at: string; tunnel: number } & (
    | { event: "UPSTREAM_CONNECTED"; connectMs: number; family: string | null }
    | { event: "UPSTREAM_CONNECT_FAILED"; code: string | null; connectMs: number }
    | {
        event: "TUNNEL_CLOSED";
        closedFirstBy: "upstream" | "client";
        upstreamEnd: "FIN" | "ERROR" | null;
        upstreamError: string | null;
        clientError: string | null;
        bytesToUpstream: number;
        bytesToClient: number;
        durationMs: number;
        clientIdleBeforeCloseMs: number | null;
      }
  )
>;

export type EgressLogEntry = EgressDecisionEntry | EgressTunnelEntry;

const defaultDial: Dial = (host, port) => connect({ host, port });

const reject = (socket: Duplex, status: string, reason: string) => {
  socket.end(
    `HTTP/1.1 ${status}\r\nX-Egress-Decision: ${reason}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`,
  );
};

const codeOf = (error: unknown): string | null => {
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
};

export function createEgressProxy(
  options: Readonly<{ dial?: Dial; log?: (entry: EgressLogEntry) => void }> = {},
): Server {
  const dial = options.dial ?? defaultDial;
  const log = (entry: EgressLogEntry) => options.log?.(entry);
  const decision = (method: string, result: EgressDecision, tunnel?: number) =>
    log({
      at: new Date().toISOString(),
      method,
      host: result.host,
      port: result.port,
      allowed: result.allowed,
      reason: result.reason,
      ...(tunnel === undefined ? {} : { tunnel }),
    });
  let tunnels = 0;

  // Una petición HTTP de proxy nunca se reenvía: se registra y se rechaza.
  const server = createServer((req, res) => {
    const result = decideEgress(req.method ?? "", req.url ?? "");
    decision(req.method ?? "", result);
    res.writeHead(result.reason === "PRODUCTION_ACCESS_BLOCKED" ? 403 : 405, {
      "X-Egress-Decision": result.reason,
      Connection: "close",
    });
    res.end();
  });

  server.on("connect", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on("error", () => undefined);
    const result = decideEgress("CONNECT", req.url ?? "");
    if (!result.allowed) {
      decision("CONNECT", result);
      reject(socket, "403 Forbidden", result.reason);
      return;
    }
    const tunnel = ++tunnels;
    decision("CONNECT", result, tunnel);
    const startedAt = Date.now();
    let established = false;
    let lastClientByteAt: number | null = null;
    let first: { side: "upstream" | "client"; at: number } | null = null;
    let upstreamEnd: "FIN" | "ERROR" | null = null;
    let upstreamError: string | null = null;
    let clientError: string | null = null;
    let logged = false;
    const note = (side: "upstream" | "client") => {
      first ??= { side, at: Date.now() };
    };

    const upstream = dial(result.host!, result.port!);
    const closed = () => {
      if (logged || !established) return;
      logged = true;
      log({
        at: new Date().toISOString(),
        tunnel,
        event: "TUNNEL_CLOSED",
        closedFirstBy: first?.side ?? "upstream",
        upstreamEnd,
        upstreamError,
        clientError,
        bytesToUpstream: upstream.bytesWritten,
        bytesToClient: upstream.bytesRead,
        durationMs: Date.now() - startedAt,
        clientIdleBeforeCloseMs:
          lastClientByteAt === null || first === null ? null : first.at - lastClientByteAt,
      });
    };
    upstream.on("error", (error) => {
      upstreamError = codeOf(error);
      upstreamEnd ??= "ERROR";
      note("upstream");
      if (!established) {
        log({
          at: new Date().toISOString(),
          tunnel,
          event: "UPSTREAM_CONNECT_FAILED",
          code: upstreamError,
          connectMs: Date.now() - startedAt,
        });
        if (socket.writable) reject(socket, "502 Bad Gateway", "UPSTREAM_FAILED");
      }
      // Con el túnel abierto, nunca una respuesta HTTP dentro de él: solo se cierra el cliente.
      socket.destroy();
    });
    upstream.on("end", () => {
      upstreamEnd ??= "FIN";
      note("upstream");
    });
    upstream.on("close", () => {
      note("upstream");
      closed();
    });
    upstream.once("connect", () => {
      established = true;
      log({
        at: new Date().toISOString(),
        tunnel,
        event: "UPSTREAM_CONNECTED",
        connectMs: Date.now() - startedAt,
        family: upstream.remoteFamily ?? null,
      });
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length > 0) upstream.write(head);
      socket.on("data", () => (lastClientByteAt = Date.now()));
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    socket.on("error", (error) => {
      clientError = codeOf(error);
    });
    socket.on("end", () => note("client"));
    socket.on("close", () => {
      note("client");
      upstream.destroy();
      closed();
    });
  });
  return server;
}
