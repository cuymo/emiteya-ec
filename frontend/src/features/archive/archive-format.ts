// Presentación de la bandeja y de los documentos (add-document-archive, design D13): estados del
// RIDE y motivos de una generación detenida en lenguaje de negocio, sin códigos internos.
import type { RideStatus } from "@facturador/contracts";

/** Qué significa cada motivo de detención para el usuario, en una frase. */
const STOP_REASONS: Record<string, string> = {
  RIDE_GLYPH_MISSING:
    "El comprobante tiene caracteres que el RIDE no puede representar con sus fuentes.",
  RIDE_SOURCE_UNSUPPORTED: "El comprobante tiene contenido que el RIDE todavía no muestra.",
  RIDE_SOURCE_INVALID: "El XML del comprobante no se pudo leer para preparar el RIDE.",
  RIDE_SOURCE_INTEGRITY: "El XML guardado del comprobante no pasó la verificación de integridad.",
  RIDE_AUTHORIZATION_MISMATCH:
    "Los datos de la autorización no corresponden al XML del comprobante.",
  RIDE_LOGO_INTEGRITY: "El logo de la configuración no pasó la verificación de integridad.",
  RIDE_LOGO_INVALID: "El logo de la configuración no es una imagen válida.",
  RIDE_FONTS_UNAVAILABLE: "Las fuentes del RIDE no están disponibles en el servidor.",
};

export function stopReason(code: string | null): string {
  return (code && STOP_REASONS[code]) ?? "La preparación del RIDE falló varias veces y se detuvo.";
}

/** Texto corto del RIDE para la bandeja; null cuando no aplica. */
export const RIDE_STATUS_LABELS: Record<RideStatus, string | null> = {
  AVAILABLE: "Disponible",
  PENDING: "En preparación",
  STOPPED: "Detenido",
  NOT_APPLICABLE: null,
};
