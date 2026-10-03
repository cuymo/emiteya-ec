// Presentación de facturas y borradores (add-invoice-emission, design D15): estados con icono y
// texto, etapas y clases del diagnóstico en lenguaje de negocio, y fechas en la hora de Ecuador.
import type { InvoiceState, SigningAttemptClass, SigningAttemptStage } from "@facturador/contracts";
import { FileCheck2, Hourglass, type LucideIcon } from "lucide-react";
import type { StatusTone } from "@/components/states";

export const INVOICE_STATE_BADGES: Record<
  InvoiceState,
  { tone: StatusTone; label: string; icon: LucideIcon }
> = {
  RESERVED: { tone: "warning", label: "Procesando", icon: Hourglass },
  SIGNED: { tone: "info", label: "Pendiente de envío", icon: FileCheck2 },
};

export const STAGE_LABELS: Record<SigningAttemptStage, string> = {
  BUILD_XML: "Preparación del XML",
  VALIDATE_XSD: "Validación del XML",
  SIGN: "Firma",
  VALIDATE_SIGNED_XSD: "Validación del XML firmado",
  PERSIST: "Registro de la factura firmada",
};

export const CLASS_LABELS: Record<SigningAttemptClass, string> = {
  RETRYABLE_OPERATIONAL: "Puedes reintentar ahora.",
  DETERMINISTIC_CONFIGURATION: "Corrige la configuración indicada y reintenta.",
  DETERMINISTIC_VALIDATION: "Requiere soporte: reintentar dará el mismo resultado.",
};

const DATE_TIME = new Intl.DateTimeFormat("es-EC", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Guayaquil",
});

/** Fecha y hora en Ecuador: 03/10/2026, 10:15. */
export const formatDateTime = (iso: string) => DATE_TIME.format(new Date(iso));

/** Fecha fiscal `YYYY-MM-DD` como 03/10/2026, sin conversión de zona horaria. */
export function formatIssueDate(date: string): string {
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

/** Comprador en una línea: razón social e identificación. */
export const buyerLabel = (buyer: { legalName: string; identification: string }) =>
  `${buyer.legalName} · ${buyer.identification}`;
