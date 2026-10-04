// RESPUESTAS SINTÉTICAS DEL SRI para las pruebas (add-sri-transmission, design D23): construidas
// con la estructura de los WSDL oficiales (`docs/product/sri-wsdl/`) y de los ejemplos de la ficha
// v2.34 (§7.2.3 y §8.2.3). No son respuestas reales: las reales llegan con S-3 online. Cada sobre
// lleva un comentario que lo marca como sintético.
import type { TransportOutcome } from "../../src/modules/sri-engine/application/transport.ts";

const SYNTHETIC = "<!-- RESPUESTA SINTÉTICA de pruebas con la estructura oficial -->";
const at = new Date("2026-10-04T15:00:00Z");

export type SyntheticMessage = Readonly<{
  identifier: string;
  message: string;
  additionalInformation?: string;
  type?: string;
}>;

const messagesXml = (messages: readonly SyntheticMessage[]) =>
  messages.length === 0
    ? "<mensajes/>"
    : `<mensajes>${messages
        .map(
          (m) =>
            `<mensaje><identificador>${m.identifier}</identificador><mensaje>${m.message}</mensaje>` +
            (m.additionalInformation !== undefined
              ? `<informacionAdicional>${m.additionalInformation}</informacionAdicional>`
              : "") +
            `<tipo>${m.type ?? "ERROR"}</tipo></mensaje>`,
        )
        .join("")}</mensajes>`;

const soap = (inner: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>${SYNTHETIC}<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${inner}</soap:Body></soap:Envelope>`;

/** `validarComprobanteResponse` (ficha v2.34, §7.2.3). */
export function receptionResponse(
  estado: string | null,
  comprobantes: readonly { accessKey?: string; messages: readonly SyntheticMessage[] }[] = [],
): string {
  const items = comprobantes
    .map(
      (c) =>
        `<comprobante>${c.accessKey ? `<claveAcceso>${c.accessKey}</claveAcceso>` : ""}${messagesXml(c.messages)}</comprobante>`,
    )
    .join("");
  return soap(
    `<ns2:validarComprobanteResponse xmlns:ns2="http://ec.gob.sri.ws.recepcion"><RespuestaRecepcionComprobante>` +
      (estado === null ? "" : `<estado>${estado}</estado>`) +
      (items ? `<comprobantes>${items}</comprobantes>` : "<comprobantes/>") +
      "</RespuestaRecepcionComprobante></ns2:validarComprobanteResponse>",
  );
}

export type SyntheticAuthorization = Readonly<{
  estado: string;
  numeroAutorizacion?: string;
  fechaAutorizacion?: string;
  ambiente?: string;
  /** Contenido ya serializado del elemento `comprobante` (CDATA o texto escapado). */
  comprobante?: string;
  messages?: readonly SyntheticMessage[];
}>;

/** `autorizacionComprobanteResponse` (ficha v2.34, §7.2.3). */
export function authorizationResponse(
  queriedKey: string | null,
  authorizations: readonly SyntheticAuthorization[],
  numeroComprobantes = String(authorizations.length),
): string {
  const items = authorizations
    .map(
      (a) =>
        `<autorizacion><estado>${a.estado}</estado>` +
        (a.numeroAutorizacion !== undefined
          ? `<numeroAutorizacion>${a.numeroAutorizacion}</numeroAutorizacion>`
          : "") +
        (a.fechaAutorizacion !== undefined
          ? `<fechaAutorizacion>${a.fechaAutorizacion}</fechaAutorizacion>`
          : "") +
        (a.ambiente !== undefined ? `<ambiente>${a.ambiente}</ambiente>` : "") +
        (a.comprobante !== undefined ? `<comprobante>${a.comprobante}</comprobante>` : "") +
        messagesXml(a.messages ?? []) +
        "</autorizacion>",
    )
    .join("");
  return soap(
    `<ns2:autorizacionComprobanteResponse xmlns:ns2="http://ec.gob.sri.ws.autorizacion"><RespuestaAutorizacionComprobante>` +
      (queriedKey === null ? "" : `<claveAccesoConsultada>${queriedKey}</claveAccesoConsultada>`) +
      `<numeroComprobantes>${numeroComprobantes}</numeroComprobantes>` +
      (items ? `<autorizaciones>${items}</autorizaciones>` : "<autorizaciones/>") +
      "</RespuestaAutorizacionComprobante></ns2:autorizacionComprobanteResponse>",
  );
}

/** `consultarEstadoAutorizacionComprobanteResponse` (ficha v2.34, §8.2.3). */
export function validityResponse(fields: {
  accessKey?: string;
  estadoConsulta?: string;
  estadoAutorizacion?: string;
  messages?: readonly SyntheticMessage[];
}): string {
  return soap(
    `<ns2:consultarEstadoAutorizacionComprobanteResponse xmlns:ns2="http://ec.gob.sri.ws.consultas"><EstadoAutorizacionComprobante>` +
      (fields.estadoConsulta ? `<estadoConsulta>${fields.estadoConsulta}</estadoConsulta>` : "") +
      (fields.accessKey ? `<claveAcceso>${fields.accessKey}</claveAcceso>` : "") +
      messagesXml(fields.messages ?? []) +
      (fields.estadoAutorizacion
        ? `<estadoAutorizacion>${fields.estadoAutorizacion}</estadoAutorizacion><tipoComprobante>Factura</tipoComprobante><rucEmisor>1790012345001</rucEmisor><fechaAutorizacion>2026-10-04T10:00:00-05:00</fechaAutorizacion>`
        : "") +
      "</EstadoAutorizacionComprobante></ns2:consultarEstadoAutorizacionComprobanteResponse>",
  );
}

export const soapFault = (faultstring = "Error interno") =>
  soap(
    `<soap:Fault><faultcode>soap:Server</faultcode><faultstring>${faultstring}</faultstring></soap:Fault>`,
  );

/** Resultado de transporte con una respuesta HTTP. */
export function response(
  body: string | Buffer,
  httpStatus = 200,
  truncated = false,
): TransportOutcome {
  return {
    kind: "RESPONSE",
    httpStatus,
    headers: { "content-type": "text/xml;charset=UTF-8" },
    body: typeof body === "string" ? Buffer.from(body, "utf8") : body,
    truncated,
    startedAt: at,
    headersAt: at,
    completedAt: at,
  };
}

export function failure(
  kind: "NOT_SENT" | "REQUEST_TIMEOUT" | "BODY_TIMEOUT" | "CONNECTION_LOST",
  errorCode = kind === "NOT_SENT" ? "ECONNREFUSED" : kind,
): TransportOutcome {
  return { kind, errorCode, startedAt: at, headersAt: null, completedAt: at };
}
