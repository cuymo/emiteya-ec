// Lectura de las respuestas SOAP del SRI con `fast-xml-parser` (add-sri-transmission, design D11).
// Rechaza DTD y `<!DOCTYPE>`: un documento con DTD es ilegible. Quita los prefijos de espacio de
// nombres, conserva el texto exacto (sin recortar) y guarda las secciones CDATA aparte, para que el
// XML autorizado salga byte a byte. Solo se usa en la infraestructura de sri-engine.
import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { SriResponseMessage } from "../application/classification.ts";
import type { TransportOutcome } from "../application/transport.ts";

export const CDATA = "__cdata";

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: false,
  processEntities: true,
  cdataPropName: CDATA,
  isArray: (_name, jpath) =>
    /(?:mensajes\.mensaje|autorizaciones\.autorizacion|comprobantes\.comprobante)$/.test(
      String(jpath),
    ),
});

export type XmlNode = Record<string, unknown>;

/** Cuerpo SOAP de una respuesta, o el motivo técnico por el que no se puede leer. */
export type SoapRead =
  Readonly<{ ok: true; body: XmlNode }> | Readonly<{ ok: false; reason: string; detail?: string }>;

const isNode = (value: unknown): value is XmlNode =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Lee el `Body` de un sobre SOAP de una respuesta HTTP exitosa y completa. */
export function readSoapResponse(outcome: TransportOutcome): SoapRead {
  if (outcome.kind !== "RESPONSE") return { ok: false, reason: outcome.kind };
  if (outcome.truncated) return { ok: false, reason: "TRUNCATED" };
  if (outcome.httpStatus < 200 || outcome.httpStatus > 299) {
    return { ok: false, reason: "HTTP_STATUS", detail: String(outcome.httpStatus) };
  }
  const text = outcome.body.toString("utf8");
  if (text.trim() === "") return { ok: false, reason: "EMPTY" };
  if (/<!DOCTYPE/i.test(text)) return { ok: false, reason: "DTD" };
  if (XMLValidator.validate(text) !== true) return { ok: false, reason: "MALFORMED" };
  let document: unknown;
  try {
    document = parser.parse(text);
  } catch {
    return { ok: false, reason: "MALFORMED" };
  }
  const envelope = isNode(document) ? document.Envelope : undefined;
  const body = isNode(envelope) ? envelope.Body : undefined;
  if (!isNode(body)) return { ok: false, reason: "NOT_SOAP" };
  if ("Fault" in body) {
    const fault = body.Fault;
    const reason = isNode(fault) ? text_(fault.faultstring) : null;
    return { ok: false, reason: "SOAP_FAULT", ...(reason ? { detail: reason.slice(0, 200) } : {}) };
  }
  return { ok: true, body };
}

/** Texto de un elemento simple: su texto, o la concatenación de sus CDATA. */
function text_(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (isNode(value)) {
    if (CDATA in value) {
      const cdata = value[CDATA];
      return Array.isArray(cdata) ? cdata.map(String).join("") : String(cdata);
    }
    if (typeof value["#text"] === "string") return value["#text"];
  }
  return null;
}
export const text = text_;

/** Texto recortado para comparar claves, estados e identificadores; el original se conserva. */
export const trimmed = (value: unknown): string | null => text_(value)?.trim() ?? null;

export const child = (node: unknown, name: string): unknown =>
  isNode(node) ? node[name] : undefined;

export const children = (node: unknown, path: readonly string[]): unknown[] => {
  let current: unknown = node;
  for (const name of path.slice(0, -1)) current = child(current, name);
  const last = child(current, path.at(-1)!);
  return Array.isArray(last) ? last : last === undefined || last === "" ? [] : [last];
};

/** Mensajes del SRI en orden, con todos sus campos tal como llegaron. */
export function readMessages(node: unknown): SriResponseMessage[] {
  return children(node, ["mensajes", "mensaje"]).map((message) => ({
    identifier: text_(child(message, "identificador")),
    message: text_(child(message, "mensaje")),
    additionalInformation: text_(child(message, "informacionAdicional")),
    type: text_(child(message, "tipo")),
  }));
}

/** Estado normalizado para compararlo: sin tildes, en mayúsculas y con un espacio. */
export const normalizedState = (value: string | null): string | null =>
  value === null
    ? null
    : value
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .trim()
        .replace(/\s+/g, " ")
        .toUpperCase();
