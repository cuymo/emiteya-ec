// Clasificación pura de la consulta de validez (add-sri-transmission, design D15; ficha v2.34,
// §8.2.3 y §8.4; WSDL oficial de `ConsultaComprobante`). Un estado informado para la clave del
// comprobante la muestra conocida; el error 99 (`estadoConsulta` `RECHAZADA`: fuera de rango o sin
// datos), una respuesta desconocida o un fallo técnico no aportan evidencia. Una respuesta por otra
// clave es inconsistente con el comprobante (design D4). Esta consulta solo puede impedir un
// reenvío: nunca lo autoriza.
import {
  VALIDITY_STATES,
  type ValidityClassification,
  type ValidityState,
} from "../application/classification.ts";
import type { TransportOutcome } from "../application/transport.ts";
import { child, normalizedState, readMessages, readSoapResponse, trimmed } from "./sri-xml.ts";

export const VALIDITY_CLASSIFIER_VERSION = "validity/2";

export function classifyValidity(
  transport: TransportOutcome,
  expectedAccessKey: string,
): ValidityClassification {
  const read = readSoapResponse(transport);
  if (!read.ok) {
    return { outcome: "NO_EVIDENCE", state: null, messages: [], parsed: { reason: read.reason } };
  }
  const response = child(
    child(read.body, "consultarEstadoAutorizacionComprobanteResponse"),
    "EstadoAutorizacionComprobante",
  );
  if (response === undefined) {
    return {
      outcome: "NO_EVIDENCE",
      state: null,
      messages: [],
      parsed: { reason: "NOT_VALIDITY_RESPONSE" },
    };
  }
  const messages = readMessages(response);
  const key = trimmed(child(response, "claveAcceso"));
  const query = normalizedState(trimmed(child(response, "estadoConsulta")));
  const state = normalizedState(trimmed(child(response, "estadoAutorizacion")));
  const parsed = { claveAcceso: key, estadoConsulta: query, estadoAutorizacion: state };
  const noEvidence = (reason: string): ValidityClassification => ({
    outcome: "NO_EVIDENCE",
    state: null,
    messages,
    parsed: { ...parsed, reason },
  });

  // Una respuesta por otra clave no es de este comprobante: inconsistente, sea cual sea su estado.
  if (key !== null && key !== expectedAccessKey) {
    return {
      outcome: "INCONSISTENT",
      state: null,
      messages,
      parsed: { ...parsed, reason: "ACCESS_KEY_MISMATCH" },
    };
  }
  // La ficha nombra `estadoAutorizacion` para el rechazo de la consulta y su ejemplo usa
  // `estadoConsulta`: cualquiera de los dos, o el error 99, es una consulta sin datos.
  if (query === "RECHAZADA" || state === "RECHAZADA") return noEvidence("QUERY_REJECTED");
  if (messages.some((message) => message.identifier?.trim() === "99"))
    return noEvidence("ERROR_99");
  // Sin la clave no se puede atribuir el estado al comprobante.
  if (key === null) return noEvidence("MISSING_ACCESS_KEY");
  if (state !== null && (VALIDITY_STATES as readonly string[]).includes(state)) {
    return { outcome: "KEY_KNOWN", state: state as ValidityState, messages, parsed };
  }
  return noEvidence(state === null ? "MISSING_STATE" : "UNKNOWN_STATE");
}
