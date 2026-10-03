// Comprobante electrónico y su máquina local (add-invoice-emission, design D3; ADR 0010): nace
// `RESERVED` con número, clave y snapshot, y solo pasa a `SIGNED` con su artefacto exacto. Un fallo
// después de reservar no cambia el estado: queda como diagnóstico del último intento (D10).

export const DOCUMENT_STATES = ["RESERVED", "SIGNED"] as const;
export type DocumentState = (typeof DOCUMENT_STATES)[number];

/** Transiciones permitidas por la máquina local de este cambio. */
const TRANSITIONS: Readonly<Record<DocumentState, readonly DocumentState[]>> = {
  RESERVED: ["SIGNED"],
  SIGNED: [],
};

export const canTransition = (from: DocumentState, to: DocumentState): boolean =>
  TRANSITIONS[from].includes(to);

export type TransitionActor =
  Readonly<{ type: "USER"; userId: string }> | Readonly<{ type: "SYSTEM" }>;

export type AttemptClass =
  "RETRYABLE_OPERATIONAL" | "DETERMINISTIC_CONFIGURATION" | "DETERMINISTIC_VALIDATION";

/** Diagnóstico del último intento fallido: etapa, código tipado, clase y fecha, sin secretos. */
export type AttemptDiagnostic = Readonly<{
  stage: string;
  code: string;
  class: AttemptClass;
  at: Date;
}>;
