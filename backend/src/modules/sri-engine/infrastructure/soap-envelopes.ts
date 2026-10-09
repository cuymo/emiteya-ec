// Sobres SOAP 1.1 de los servicios del SRI (add-sri-transmission, design D10): funciones puras con
// los espacios de nombres y elementos de los WSDL oficiales (`docs/product/sri-wsdl/`) y de los
// ejemplos de la ficha v2.34 (§7.2.3 y §8.2.3). Los elementos hijos no llevan espacio de nombres
// (`elementFormDefault="unqualified"`). Se construyen como bytes: el comprobante firmado va en el
// base64 de su `Buffer` exacto, sin pasar por texto, y nunca se reconstruye.

import type { PreparedReception } from "../application/transport.ts";

const SOAP_ENV = "http://schemas.xmlsoap.org/soap/envelope/";
export const SRI_NAMESPACES = {
  RECEPTION: "http://ec.gob.sri.ws.recepcion",
  AUTHORIZATION: "http://ec.gob.sri.ws.autorizacion",
  VALIDITY: "http://ec.gob.sri.ws.consultas",
} as const;

const ACCESS_KEY = /^[0-9]{49}$/;

function envelope(namespace: string, body: string): Buffer {
  return Buffer.from(
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
      `<soapenv:Envelope xmlns:soapenv="${SOAP_ENV}" xmlns:ec="${namespace}">` +
      `<soapenv:Header/><soapenv:Body>${body}</soapenv:Body></soapenv:Envelope>`,
    "utf8",
  );
}

function accessKey(value: string): string {
  if (!ACCESS_KEY.test(value)) throw new Error("la clave de acceso debe tener 49 dígitos");
  return value;
}

/**
 * `validarComprobante(xml)` preparado una sola vez (add-sri-certification-safety-cap, design D2): el
 * base64 de los bytes firmados exactos se calcula una vez y el sobre se arma con ese mismo texto. Las
 * medidas son las de esos mismos bytes, y el sobre devuelto es el que se envía.
 */
export function prepareReception(signedXml: Buffer): PreparedReception {
  const base64 = signedXml.toString("base64");
  const body = envelope(
    SRI_NAMESPACES.RECEPTION,
    `<ec:validarComprobante><xml>${base64}</xml></ec:validarComprobante>`,
  );
  return {
    envelope: body,
    sizes: {
      signedXmlBytes: signedXml.length,
      base64PayloadBytes: Buffer.byteLength(base64, "utf8"),
      soapRequestBytes: body.length,
    },
  };
}

/** `validarComprobante(xml)`: los bytes firmados exactos en base64 (ficha v2.34, §7.2.3). */
export function receptionEnvelope(signedXml: Buffer): Buffer {
  return prepareReception(signedXml).envelope;
}

/** `autorizacionComprobante(claveAccesoComprobante)` (ficha v2.34, §7.2.3). */
export function authorizationEnvelope(key: string): Buffer {
  return envelope(
    SRI_NAMESPACES.AUTHORIZATION,
    `<ec:autorizacionComprobante><claveAccesoComprobante>${accessKey(key)}</claveAccesoComprobante></ec:autorizacionComprobante>`,
  );
}

/** `consultarEstadoAutorizacionComprobante(claveAcceso)` (ficha v2.34, §8.2.3). */
export function validityEnvelope(key: string): Buffer {
  return envelope(
    SRI_NAMESPACES.VALIDITY,
    `<ec:consultarEstadoAutorizacionComprobante><claveAcceso>${accessKey(key)}</claveAcceso></ec:consultarEstadoAutorizacionComprobante>`,
  );
}
