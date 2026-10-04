// Clasificación pura de la respuesta de autorización (add-sri-transmission, design D12 y D16;
// ficha v2.34, §7.2.3 y tabla 6). Un `AUTORIZADO` solo es válido con la clave, el número, la fecha,
// el ambiente y el XML del comprobante coherentes; si no, es una inconsistencia. `NO AUTORIZADO` y
// `RECHAZADO` (el ejemplo oficial "Comprobante No Autorizado") son el estado no autorizado. Lo
// demás queda sin conclusión, y varias autorizaciones nunca se resuelven tomando la primera.
import type {
  AuthorizationClassification,
  ParsedDetails,
  ReadAuthorization,
  SriResponseMessage,
} from "../application/classification.ts";
import type { TransportOutcome } from "../application/transport.ts";
import type { Environment } from "../../taxpayer/domain/taxpayer-config.ts";
import {
  child,
  children,
  normalizedState,
  readMessages,
  readSoapResponse,
  text,
  trimmed,
} from "./sri-xml.ts";

export const AUTHORIZATION_CLASSIFIER_VERSION = "authorization/1";

const NOT_AUTHORIZED_STATES = new Set(["NO AUTORIZADO", "RECHAZADO"]);
const ENVIRONMENTS: Readonly<Record<string, Environment>> = {
  PRUEBAS: "TEST",
  PRODUCCION: "PRODUCTION",
};

export type AuthorizationExpectation = Readonly<{ accessKey: string; environment: Environment }>;

const result = (
  outcome: AuthorizationClassification["outcome"],
  messages: readonly SriResponseMessage[],
  parsed: ParsedDetails,
  extra: Partial<Pick<AuthorizationClassification, "cause" | "authorization">> = {},
): AuthorizationClassification => ({
  outcome,
  cause: extra.cause ?? null,
  messages,
  parsed,
  authorization: extra.authorization ?? null,
});

/**
 * `fechaAutorizacion`: ISO 8601 con desfase (el WSDL la declara `xs:dateTime`), o
 * `dd/MM/yyyy HH:mm:ss` en la hora de Ecuador (UTC−5, sin horario de verano). Si no, null.
 */
export function parseAuthorizationDate(value: string): Date | null {
  const iso =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (iso) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const local = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (local) {
    const [, day, month, year, hour, minute, second] = local;
    const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}-05:00`);
    if (Number.isNaN(date.getTime())) return null;
    // Rechaza fechas que el constructor corrige en silencio (31/02).
    const check = new Date(date.getTime() - 5 * 3_600_000);
    return check.getUTCDate() === Number(day) && check.getUTCMonth() + 1 === Number(month)
      ? date
      : null;
  }
  return null;
}

/** La clave de acceso del XML autorizado, o null si no la trae una sola vez. */
function authorizedXmlKey(xml: string): string | null {
  const keys = [...xml.matchAll(/<claveAcceso>\s*([0-9]{49})\s*<\/claveAcceso>/g)].map(
    (m) => m[1]!,
  );
  return keys.length === 1 ? keys[0]! : null;
}

type Reading = { authorization?: ReadAuthorization; problem?: string };

/** Comprueba un `AUTORIZADO` contra el comprobante (design D12). */
function readAuthorized(node: unknown, expected: AuthorizationExpectation): Reading {
  const number = trimmed(child(node, "numeroAutorizacion"));
  if (number === null) return { problem: "MISSING_AUTHORIZATION_NUMBER" };
  if (number !== expected.accessKey) return { problem: "AUTHORIZATION_NUMBER_MISMATCH" };
  const dateText = trimmed(child(node, "fechaAutorizacion"));
  if (dateText === null) return { problem: "MISSING_AUTHORIZATION_DATE" };
  const date = parseAuthorizationDate(dateText);
  if (date === null) return { problem: "UNREADABLE_AUTHORIZATION_DATE" };
  const environment = ENVIRONMENTS[normalizedState(trimmed(child(node, "ambiente"))) ?? ""];
  if (environment === undefined) return { problem: "UNKNOWN_ENVIRONMENT" };
  if (environment !== expected.environment) return { problem: "ENVIRONMENT_MISMATCH" };
  const xml = text(child(node, "comprobante"));
  let authorizedXml: Buffer | null = null;
  if (xml !== null && xml.trim() !== "") {
    if (authorizedXmlKey(xml) !== expected.accessKey)
      return { problem: "AUTHORIZED_XML_KEY_MISMATCH" };
    authorizedXml = Buffer.from(xml, "utf8");
  }
  return { authorization: { number, date, dateText, environment, authorizedXml } };
}

export function classifyAuthorization(
  transport: TransportOutcome,
  expected: AuthorizationExpectation,
): AuthorizationClassification {
  const read = readSoapResponse(transport);
  if (!read.ok) {
    return result(
      "NO_CONCLUSION",
      [],
      { reason: read.reason, ...(read.detail ? { detail: read.detail } : {}) },
      { cause: "TECHNICAL" },
    );
  }
  const response = child(
    child(read.body, "autorizacionComprobanteResponse"),
    "RespuestaAutorizacionComprobante",
  );
  if (response === undefined) {
    return result(
      "NO_CONCLUSION",
      [],
      { reason: "NOT_AUTHORIZATION_RESPONSE" },
      { cause: "TECHNICAL" },
    );
  }
  const queried = trimmed(child(response, "claveAccesoConsultada"));
  const count = trimmed(child(response, "numeroComprobantes"));
  const authorizations = children(response, ["autorizaciones", "autorizacion"]);
  const messages = authorizations.flatMap(readMessages);
  const states = authorizations.map((node) => normalizedState(trimmed(child(node, "estado"))));
  const parsed: ParsedDetails = {
    claveAccesoConsultada: queried,
    numeroComprobantes: count,
    autorizaciones: authorizations.length,
    estados: states.map((state) => state ?? "").join(","),
  };

  if (queried !== null && queried !== expected.accessKey) {
    return result("INCONSISTENT", messages, { ...parsed, reason: "QUERIED_KEY_MISMATCH" });
  }
  if (authorizations.length === 0) {
    return count === "0" && queried !== null
      ? result("KEY_UNKNOWN", messages, parsed)
      : result(
          "NO_CONCLUSION",
          messages,
          { ...parsed, reason: "NO_AUTHORIZATIONS" },
          { cause: "SRI" },
        );
  }
  // Sin la clave consultada no se puede atribuir ninguna autorización al comprobante.
  if (queried === null)
    return result("INCONSISTENT", messages, { ...parsed, reason: "MISSING_QUERIED_KEY" });

  const authorizedIndexes = states.flatMap((state, index) =>
    state === "AUTORIZADO" ? [index] : [],
  );
  if (authorizedIndexes.length > 1) {
    return result("INCONSISTENT", messages, { ...parsed, reason: "SEVERAL_AUTHORIZED" });
  }
  if (authorizedIndexes.length === 1) {
    // Puede haber varias respuestas no autorizadas y una sola autorizada (ficha v2.34, p. 142).
    const reading = readAuthorized(authorizations[authorizedIndexes[0]!], expected);
    return reading.authorization
      ? result("AUTHORIZED", messages, parsed, { authorization: reading.authorization })
      : result("INCONSISTENT", messages, { ...parsed, reason: reading.problem! });
  }
  if (authorizations.length > 1) {
    return result("INCONSISTENT", messages, { ...parsed, reason: "SEVERAL_WITHOUT_AUTHORIZED" });
  }
  const [only] = authorizations;
  const state = states[0] ?? null;
  if (state !== null && NOT_AUTHORIZED_STATES.has(state)) {
    const environment = ENVIRONMENTS[normalizedState(trimmed(child(only, "ambiente"))) ?? ""];
    if (environment !== expected.environment) {
      return result("INCONSISTENT", messages, { ...parsed, reason: "ENVIRONMENT_MISMATCH" });
    }
    return result("NOT_AUTHORIZED", messages, parsed);
  }
  // En procesamiento (PPR) u otro estado: el texto exacto no se supone (design D12).
  return result(
    "NO_CONCLUSION",
    messages,
    { ...parsed, reason: state ? "UNRESOLVED_STATE" : "MISSING_STATE" },
    { cause: "SRI" },
  );
}
