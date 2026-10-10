// Proxy de salida de la sesión de certificación (docs/quality/sri-egress-allowlist.md).
// - Escucha en un socket Unix, fuera del espacio de nombres de red del proceso de la certificación.
// - Solo admite CONNECT a celcer.sri.gob.ec:443. Nunca reenvía peticiones HTTP en claro.
// - Decide antes de resolver DNS o de abrir la conexión: un destino rechazado no genera tráfico.
// - Registra cada decisión sin contenido. El tráfico admitido es TLS de extremo a extremo y no se
//   inspecciona.
import { createServer, type IncomingMessage, type Server } from "node:http";
import { connect, type Socket } from "node:net";
import type { Duplex } from "node:stream";
import { decideEgress, type EgressDecision } from "./policy.ts";

export type Dial = (host: string, port: number) => Socket;
export type EgressLogEntry = Readonly<{
  at: string;
  method: string;
  host: string | null;
  port: number | null;
  allowed: boolean;
  reason: EgressDecision["reason"];
}>;

const defaultDial: Dial = (host, port) => connect({ host, port });

const reject = (socket: Duplex, status: string, reason: string) => {
  socket.end(
    `HTTP/1.1 ${status}\r\nX-Egress-Decision: ${reason}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`,
  );
};

export function createEgressProxy(
  options: Readonly<{ dial?: Dial; log?: (entry: EgressLogEntry) => void }> = {},
): Server {
  const dial = options.dial ?? defaultDial;
  const log = (method: string, result: EgressDecision) =>
    options.log?.({
      at: new Date().toISOString(),
      method,
      host: result.host,
      port: result.port,
      allowed: result.allowed,
      reason: result.reason,
    });

  // Una petición HTTP de proxy nunca se reenvía: se registra y se rechaza.
  const server = createServer((req, res) => {
    const result = decideEgress(req.method ?? "", req.url ?? "");
    log(req.method ?? "", result);
    res.writeHead(result.reason === "PRODUCTION_ACCESS_BLOCKED" ? 403 : 405, {
      "X-Egress-Decision": result.reason,
      Connection: "close",
    });
    res.end();
  });

  server.on("connect", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on("error", () => undefined);
    const result = decideEgress("CONNECT", req.url ?? "");
    log("CONNECT", result);
    if (!result.allowed) {
      reject(socket, "403 Forbidden", result.reason);
      return;
    }
    const upstream = dial(result.host!, result.port!);
    upstream.on("error", () => {
      if (socket.writable) reject(socket, "502 Bad Gateway", "UPSTREAM_FAILED");
      socket.destroy();
    });
    upstream.once("connect", () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length > 0) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    socket.on("close", () => upstream.destroy());
  });
  return server;
}
