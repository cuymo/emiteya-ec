// Presentación de la bandeja y de los documentos (add-document-archive, design D13): estados del
// RIDE y motivos de una generación detenida en lenguaje de negocio, sin códigos internos.
import type { DocumentListItem, RideStatus } from "@facturador/contracts";

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

/** "1 destinatario", "3 destinatarios". */
export const recipientCountLabel = (count: number) =>
  count === 1 ? "1 destinatario" : `${count} destinatarios`;

/**
 * Receptor de un comprobante en la bandeja (add-shipping-guides, design D21): el comprador, o en una
 * guía de remisión el nombre de su único destinatario o "N destinatarios". La guía nunca se presenta
 * con uno de sus destinatarios como receptor único.
 */
export function receiverOf(item: Pick<DocumentListItem, "buyer" | "recipients">): {
  name: string;
  identification: string | null;
} {
  if (item.buyer) return { name: item.buyer.name, identification: item.buyer.identification };
  const recipients = item.recipients;
  if (!recipients) return { name: "Sin receptor", identification: null };
  if (recipients.count === 1 && recipients.name) {
    return { name: recipients.name, identification: null };
  }
  return { name: recipientCountLabel(recipients.count), identification: null };
}
