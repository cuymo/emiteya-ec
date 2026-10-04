// Comprobante electrónico y su máquina de estados (add-invoice-emission, design D3; ADR 0010; y
// add-sri-transmission, design D3). Nace `RESERVED` con número, clave y snapshot, y solo pasa a
// `SIGNED` con su artefacto exacto; un fallo después de reservar queda como diagnóstico del último
// intento (D10). Desde `SIGNED`, la transmisión al SRI sigue la tabla de transiciones de abajo, que
// el trigger `electronic_document_guard` repite en la base de datos.

export const DOCUMENT_STATES = [
  "RESERVED",
  "SIGNED",
  "SEND_UNKNOWN",
  "RECEIVED",
  "RETURNED",
  "AUTHORIZED",
  "NOT_AUTHORIZED",
  "MANUAL_REVIEW",
] as const;
export type DocumentState = (typeof DOCUMENT_STATES)[number];

/**
 * Transiciones permitidas. `RETURNED` no tiene salida en este cambio (BR-28 es futura) y
 * `MANUAL_REVIEW` solo sale con una reconciliación manual concluyente (design D4).
 */
const TRANSITIONS: Readonly<Record<DocumentState, readonly DocumentState[]>> = {
  RESERVED: ["SIGNED"],
  SIGNED: ["RECEIVED", "RETURNED", "SEND_UNKNOWN"],
  SEND_UNKNOWN: ["RECEIVED", "AUTHORIZED", "NOT_AUTHORIZED", "RETURNED", "MANUAL_REVIEW"],
  RECEIVED: ["AUTHORIZED", "NOT_AUTHORIZED", "MANUAL_REVIEW"],
  RETURNED: [],
  AUTHORIZED: [],
  NOT_AUTHORIZED: [],
  MANUAL_REVIEW: ["RECEIVED", "AUTHORIZED", "NOT_AUTHORIZED"],
};

export const canTransition = (from: DocumentState, to: DocumentState): boolean =>
  TRANSITIONS[from].includes(to);

/** Estados que nunca cambian: el SRI decidió (I-15, I-16; Q-07). */
export const TERMINAL_STATES: ReadonlySet<DocumentState> = new Set([
  "AUTHORIZED",
  "NOT_AUTHORIZED",
]);

/** Causas de las transiciones: la emisión, la firma y las tres de la transmisión (design D2). */
export const TRANSITION_CAUSES = [
  "EMISSION",
  "SIGNING",
  "TRANSMISSION",
  "AUTHORIZATION",
  "RECONCILIATION",
] as const;
export type TransitionCause = (typeof TRANSITION_CAUSES)[number];

export type TransitionActor =
  Readonly<{ type: "USER"; userId: string }> | Readonly<{ type: "SYSTEM" }>;

export type AttemptClass =
  "RETRYABLE_OPERATIONAL" | "DETERMINISTIC_CONFIGURATION" | "DETERMINISTIC_VALIDATION";

/** Para XSD_INVALID: la línea y el nombre del elemento, nunca su valor (design D10). */
export type AttemptDetail = Readonly<{ line: number | null; element: string | null }>;

/** Diagnóstico del último intento fallido: etapa, código tipado, clase y fecha, sin secretos. */
export type AttemptDiagnostic = Readonly<{
  stage: string;
  code: string;
  class: AttemptClass;
  at: Date;
  detail: AttemptDetail | null;
}>;

/** Lo enviado (`SIGNED_XML`) y lo recibido del SRI (`AUTHORIZED_XML`, design D16). */
export const ARTIFACT_KINDS = ["SIGNED_XML", "AUTHORIZED_XML"] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];
