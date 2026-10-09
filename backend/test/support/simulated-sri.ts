// SRI simulado y proxy de salida de las pruebas end-to-end (add-sri-transmission, tarea 14.1;
// add-document-archive, tarea 11.2; add-credit-notes, tarea 14.2): recepción, autorización y
// validez con respuestas SINTÉTICAS con la estructura oficial, y un proxy que solo admite el host
// del SRI simulado.
import {
  createServer as createHttpServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { connect, type AddressInfo } from "node:net";
import { authorizationResponse, receptionResponse, validityResponse } from "./sri-responses.ts";

/** Host del SRI simulado: no resuelve por DNS, así que solo se alcanza a través del proxy. */
export const SRI_HOST = "sri-simulado.test";
export const FOREIGN_KEY = "1".repeat(49);

export type SriCall = { operation: "RECEPTION" | "AUTHORIZATION" | "VALIDITY"; key: string };
/**
 * `RETURNED` devuelve el propio comprobante (`DEVUELTA` con su clave y un error de estructura), que
 * el clasificador real concluye como devuelto.
 */
export type ReceptionBehavior = "RECEIVED" | "HOLD" | "FOREIGN_KEY" | "RETURNED";

const sequentialOf = (key: string) => Number(key.slice(30, 39));
/** El ambiente que declara la clave de acceso (posición 24): `2` es Producción. */
const environmentOf = (key: string) => (key[23] === "2" ? "PRODUCCION" : "PRUEBAS");
/** Tipo y secuencial de la clave (`04:2`): la factura y la nota numeran por separado. */
export const documentOf = (key: string) => `${key.slice(8, 10)}:${sequentialOf(key)}`;

/**
 * SRI simulado: recepción, autorización y validez con respuestas SINTÉTICAS. Recuerda los bytes
 * que recibió cada clave y solo autoriza lo que recibió, con ese mismo XML en el comprobante.
 */
export function simulatedSri() {
  const calls: SriCall[] = [];
  const received = new Map<string, Buffer>();
  const behaviors = new Map<number, ReceptionBehavior>();
  /** Secuenciales que el SRI autoriza sin devolver el comprobante (add-document-archive). */
  const withoutXml = new Set<number>();
  /** Comprobantes (`documentOf`) que el SRI no autoriza (add-credit-notes). */
  const notAuthorized = new Set<string>();
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
      if (behavior === "RETURNED")
        return respond(
          res,
          receptionResponse("DEVUELTA", [
            {
              accessKey: key,
              messages: [
                {
                  identifier: "35",
                  message: "ARCHIVO NO CUMPLE ESTRUCTURA XML (sintético)",
                  type: "ERROR",
                },
              ],
            },
          ]),
        );
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
      if (signed && notAuthorized.has(documentOf(key)))
        return respond(
          res,
          authorizationResponse(key, [
            {
              estado: "NO AUTORIZADO",
              fechaAutorizacion: new Date().toISOString(),
              ambiente: environmentOf(key),
              messages: [
                {
                  identifier: "65",
                  message: "FECHA EMISION EXTEMPORANEA (sintético)",
                  type: "ERROR",
                },
              ],
            },
          ]),
        );
      return respond(
        res,
        signed
          ? authorizationResponse(key, [
              {
                estado: "AUTORIZADO",
                numeroAutorizacion: key,
                fechaAutorizacion: new Date().toISOString(),
                ambiente: environmentOf(key),
                ...(withoutXml.has(sequentialOf(key))
                  ? {}
                  : { comprobante: `<![CDATA[${signed.toString("utf8")}]]>` }),
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
    withoutXml,
    notAuthorized,
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
export function outboundProxy(sriPort: number) {
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

export const listen = (server: Server) =>
  new Promise<number>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)),
  );
