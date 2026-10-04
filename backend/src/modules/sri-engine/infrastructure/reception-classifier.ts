// Clasificación pura de la respuesta de recepción (add-sri-transmission, design D11 y D13; ficha
// v2.34, §7.2.3 y tabla de errores). `RECIBIDA` es la recepción; un `DEVUELTA` es concluyente solo
// sin los errores 70, 43 y 45, que exigen consultar antes de decidir. La ausencia de estado nunca
// equivale a `DEVUELTA`, y una clave distinta de la del comprobante es una inconsistencia.
import type {
  ParsedDetails,
  ReceptionClassification,
  SriResponseMessage,
} from "../application/classification.ts";
import type { TransportOutcome } from "../application/transport.ts";
import {
  child,
  children,
  normalizedState,
  readMessages,
  readSoapResponse,
  trimmed,
} from "./sri-xml.ts";

export const RECEPTION_CLASSIFIER_VERSION = "reception/1";

/** Errores de recepción que no son una devolución concluyente, en orden de prioridad (D13). */
const PRE_DECISION_ERRORS = [
  ["70", "KEY_IN_PROCESS"],
  ["43", "KEY_REGISTERED"],
  ["45", "SEQUENTIAL_REGISTERED"],
] as const;

const unknown = (
  reason: string,
  messages: readonly SriResponseMessage[] = [],
  extra: ParsedDetails = {},
): ReceptionClassification => ({ outcome: "UNKNOWN", messages, parsed: { reason, ...extra } });

export function classifyReception(
  transport: TransportOutcome,
  expectedAccessKey: string,
): ReceptionClassification {
  // Solo una causa anterior a la conexión prueba que no salió (design D10).
  if (transport.kind === "NOT_SENT") {
    return { outcome: "NOT_SENT", messages: [], parsed: { errorCode: transport.errorCode } };
  }
  const read = readSoapResponse(transport);
  if (!read.ok) return unknown(read.reason, [], read.detail ? { detail: read.detail } : {});

  const response = child(
    child(read.body, "validarComprobanteResponse"),
    "RespuestaRecepcionComprobante",
  );
  if (response === undefined) return unknown("NOT_RECEPTION_RESPONSE");
  const comprobantes = children(response, ["comprobantes", "comprobante"]);
  const messages = comprobantes.flatMap(readMessages);
  const keys = comprobantes.map((comprobante) => trimmed(child(comprobante, "claveAcceso")));
  const estado = normalizedState(trimmed(child(response, "estado")));
  const parsed = { estado, comprobantes: comprobantes.length };

  if (keys.some((key) => key !== null && key !== expectedAccessKey)) {
    return {
      outcome: "INCONSISTENT",
      messages,
      parsed: { ...parsed, reason: "ACCESS_KEY_MISMATCH" },
    };
  }
  if (estado === "RECIBIDA") return { outcome: "RECEIVED", messages, parsed };
  if (estado !== "DEVUELTA")
    return unknown(estado ? "UNKNOWN_STATE" : "MISSING_STATE", messages, parsed);

  const identifiers = new Set(messages.map((message) => message.identifier?.trim()));
  for (const [identifier, outcome] of PRE_DECISION_ERRORS) {
    if (identifiers.has(identifier)) return { outcome, messages, parsed };
  }
  // Un `DEVUELTA` sin ningún mensaje no explica la devolución: no se concluye.
  if (messages.length === 0) return unknown("RETURNED_WITHOUT_MESSAGES", messages, parsed);
  return { outcome: "RETURNED", messages, parsed };
}
