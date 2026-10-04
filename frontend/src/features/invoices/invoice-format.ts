// Presentación de facturas y borradores (add-invoice-emission, design D15; add-sri-transmission,
// design D20): estados con icono y el texto del glosario, etapas y clases del diagnóstico en
// lenguaje de negocio, y fechas en la hora de Ecuador.
import {
  INVOICE_STATE_LABELS,
  type InvoiceState,
  type SigningAttemptClass,
  type SigningAttemptStage,
  type SriOperation,
  type SriResultOutcome,
} from "@facturador/contracts";
import {
  BadgeCheck,
  Ban,
  Clock3,
  FileCheck2,
  Hourglass,
  SearchCheck,
  TriangleAlert,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import type { StatusTone } from "@/components/states";

export const INVOICE_STATE_BADGES: Record<
  InvoiceState,
  { tone: StatusTone; label: string; icon: LucideIcon }
> = {
  RESERVED: { tone: "warning", label: INVOICE_STATE_LABELS.RESERVED, icon: Hourglass },
  SIGNED: { tone: "info", label: INVOICE_STATE_LABELS.SIGNED, icon: FileCheck2 },
  SEND_UNKNOWN: { tone: "warning", label: INVOICE_STATE_LABELS.SEND_UNKNOWN, icon: SearchCheck },
  RECEIVED: { tone: "info", label: INVOICE_STATE_LABELS.RECEIVED, icon: Clock3 },
  RETURNED: { tone: "danger", label: INVOICE_STATE_LABELS.RETURNED, icon: Undo2 },
  AUTHORIZED: { tone: "success", label: INVOICE_STATE_LABELS.AUTHORIZED, icon: BadgeCheck },
  NOT_AUTHORIZED: { tone: "danger", label: INVOICE_STATE_LABELS.NOT_AUTHORIZED, icon: Ban },
  MANUAL_REVIEW: {
    tone: "danger",
    label: INVOICE_STATE_LABELS.MANUAL_REVIEW,
    icon: TriangleAlert,
  },
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

/** Operaciones con el SRI en lenguaje de negocio (add-sri-transmission, design D20). */
export const OPERATION_LABELS: Record<SriOperation, string> = {
  RECEPTION: "Envío al SRI",
  AUTHORIZATION: "Consulta de autorización",
  VALIDITY: "Consulta de validez",
};

/** Resultado de cada intento con el SRI, sin términos técnicos. */
export const OUTCOME_LABELS: Record<SriResultOutcome, string> = {
  RECEIVED: "Recibida",
  RETURNED: "Devuelta",
  KEY_IN_PROCESS: "Clave en procesamiento (error 70)",
  KEY_REGISTERED: "Clave ya registrada (error 43)",
  SEQUENTIAL_REGISTERED: "Secuencial ya registrado (error 45)",
  UNKNOWN: "Sin respuesta concluyente",
  INCONSISTENT: "Respuesta inconsistente",
  AUTHORIZED: "Autorizada",
  NOT_AUTHORIZED: "No autorizada",
  NO_CONCLUSION: "En procesamiento",
  KEY_UNKNOWN: "El SRI aún no registra la clave",
  KEY_KNOWN: "El SRI registra la clave",
  NO_EVIDENCE: "Sin datos del SRI",
  NOT_SENT: "No se pudo enviar",
  UNPARSEABLE: "Respuesta ilegible",
};

/** Causa de cada cambio de estado del historial. */
export const CAUSE_LABELS: Record<string, string> = {
  EMISSION: "Emisión",
  SIGNING: "Firma",
  TRANSMISSION: "Transmisión",
  AUTHORIZATION: "Autorización",
  RECONCILIATION: "Reconciliación",
};
