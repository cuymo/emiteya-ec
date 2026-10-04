// Clasificación de las respuestas del SRI (add-sri-transmission, design D11, D12 y D15): de la
// respuesta guardada a un resultado, sin efectos. Nunca se concluye por inferencia: lo que no se
// reconoce queda sin conclusión, y los mensajes se conservan todos, en orden.
import type { Environment } from "../../taxpayer/domain/taxpayer-config.ts";
import type { TransportOutcome } from "./transport.ts";

/** Mensaje del SRI tal como llegó (CTX §22.2). */
export type SriResponseMessage = Readonly<{
  identifier: string | null;
  message: string | null;
  additionalInformation: string | null;
  type: string | null;
}>;

/** Datos interpretados y seguros del intento: nunca el XML ni el cuerpo original. */
export type ParsedDetails = Readonly<Record<string, string | number | boolean | null>>;

export const RECEPTION_OUTCOMES = [
  "RECEIVED",
  "RETURNED",
  "KEY_IN_PROCESS",
  "KEY_REGISTERED",
  "SEQUENTIAL_REGISTERED",
  "UNKNOWN",
  "INCONSISTENT",
  "NOT_SENT",
] as const;
export type ReceptionOutcome = (typeof RECEPTION_OUTCOMES)[number];

export type ReceptionClassification = Readonly<{
  outcome: ReceptionOutcome;
  messages: readonly SriResponseMessage[];
  parsed: ParsedDetails;
}>;

export const AUTHORIZATION_OUTCOMES = [
  "AUTHORIZED",
  "NOT_AUTHORIZED",
  "NO_CONCLUSION",
  "KEY_UNKNOWN",
  "INCONSISTENT",
] as const;
export type AuthorizationOutcome = (typeof AUTHORIZATION_OUTCOMES)[number];

/**
 * Por qué no hubo conclusión: un fallo técnico (transporte, HTTP, HTML, Fault, XML ilegible) o una
 * respuesta válida del SRI que todavía no concluye. Solo la segunda cuenta para la ventana de
 * conclusión; la primera reintenta y, al agotar los intentos, detiene el job (design D4).
 */
export type NoConclusionCause = "TECHNICAL" | "SRI";

/** Autorización leída de un `AUTORIZADO` válido (design D16). */
export type ReadAuthorization = Readonly<{
  number: string;
  date: Date;
  /** Texto original de `fechaAutorizacion`. */
  dateText: string;
  environment: Environment;
  /** Bytes UTF-8 exactos del XML autorizado, si la respuesta lo trae. */
  authorizedXml: Buffer | null;
}>;

export type AuthorizationClassification = Readonly<{
  outcome: AuthorizationOutcome;
  /** Solo en `NO_CONCLUSION`. */
  cause: NoConclusionCause | null;
  messages: readonly SriResponseMessage[];
  parsed: ParsedDetails;
  /** Solo en `AUTHORIZED`. */
  authorization: ReadAuthorization | null;
}>;

/** Estados de la consulta de validez (ficha v2.34, §8.2.3 y §8.4). */
export const VALIDITY_STATES = [
  "AUTORIZADO",
  "NO AUTORIZADO",
  "PENDIENTE DE ANULAR",
  "ANULADO",
] as const;
export type ValidityState = (typeof VALIDITY_STATES)[number];

export type ValidityClassification = Readonly<{
  outcome: "KEY_KNOWN" | "NO_EVIDENCE" | "INCONSISTENT";
  /** Solo en `KEY_KNOWN`. */
  state: ValidityState | null;
  messages: readonly SriResponseMessage[];
  parsed: ParsedDetails;
}>;

/** Clasificadores de las respuestas, con su versión para el resultado guardado (design D7). */
export type SriClassifiers = Readonly<{
  reception: (outcome: TransportOutcome, accessKey: string) => ReceptionClassification;
  authorization: (
    outcome: TransportOutcome,
    expected: Readonly<{ accessKey: string; environment: Environment }>,
  ) => AuthorizationClassification;
  validity: (outcome: TransportOutcome, accessKey: string) => ValidityClassification;
  versions: Readonly<{ reception: string; authorization: string; validity: string }>;
}>;
