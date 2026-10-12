// Cliente HTTP de Node sin supertest, para las pruebas que controlan el encuadre del cuerpo:
// `Content-Length` declarado, `chunked`, cabeceras de salto a salto o una petición cortada.
import { request as httpRequest, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Express } from "express";

export type RawResponse = Readonly<{ status: number; headers: IncomingHttpHeaders; body: string }>;

export type RawRequest = Readonly<{
  method?: string;
  path: string;
  headers?: Record<string, string | string[]>;
  /** Un solo bloque con su `Content-Length`, o varios en modo `chunked`. */
  body?: string | Buffer | readonly (string | Buffer)[];
  /** Envía solo las cabeceras y espera la respuesta sin mandar el cuerpo declarado. */
  headersOnly?: boolean;
}>;

export type RawServer = Readonly<{
  send: (request: RawRequest) => Promise<RawResponse>;
  /** Envía las cabeceras y una parte del cuerpo declarado, y corta la conexión. */
  cut: (request: RawRequest & { sent: string }) => Promise<void>;
  close: () => Promise<void>;
}>;

export async function listenRaw(app: Express): Promise<RawServer> {
  const server: Server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const { port } = server.address() as AddressInfo;
  const open = (request: RawRequest) =>
    httpRequest({
      host: "127.0.0.1",
      port,
      method: request.method ?? "POST",
      path: request.path,
      headers: request.headers ?? {},
      agent: false,
    });

  return {
    send: (request) =>
      new Promise<RawResponse>((resolve, reject) => {
        const outgoing = open(request);
        outgoing.on("response", (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              body: Buffer.concat(chunks).toString("utf8"),
            });
            if (request.headersOnly) outgoing.destroy();
          });
        });
        outgoing.on("error", reject);
        if (request.headersOnly) {
          outgoing.flushHeaders();
          return;
        }
        const body = request.body;
        if (Array.isArray(body)) {
          for (const chunk of body) outgoing.write(chunk);
          outgoing.end();
        } else {
          outgoing.end(body);
        }
      }),
    cut: (request) =>
      new Promise<void>((resolve) => {
        const outgoing = open(request);
        outgoing.on("error", () => {});
        outgoing.on("close", () => resolve());
        outgoing.write(request.sent, () => setTimeout(() => outgoing.destroy(), 50));
      }),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
