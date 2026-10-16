// Presentación de facturas y borradores (add-invoice-emission, design D15; add-sri-transmission,
// design D20): etapas y clases del diagnóstico en lenguaje de negocio, y fechas en la hora de
// Ecuador. Los estados se presentan con `DocumentStatusBadge` (features/documents).
import type {
  SigningAttemptClass,
  SigningAttemptStage,
  SriOperation,
  SriResultOutcome,
} from "@facturador/contracts";

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

/** Tipo de identificación del comprador en palabras, por su código del SRI. */
const IDENTIFICATION_LABELS: Record<string, string> = {
  "04": "RUC",
  "05": "Cédula",
  "06": "Pasaporte",
  "07": "Consumidor final",
  "08": "Identificación del exterior",
};

/** «Cédula 0431740372», «RUC 1790012345001»; un código desconocido muestra solo el número. */
export function identificationText(type: string, identification: string): string {
  const label = IDENTIFICATION_LABELS[type];
  return label ? `${label} ${identification}` : identification;
}

/**
 * Nombre corriente de cada forma de pago del catálogo del SRI. El nombre oficial y el código siguen a
 * la vista como detalle: se envía siempre la entrada del catálogo, nunca este nombre.
 */
const PAYMENT_METHOD_NAMES: Record<string, string> = {
  "01": "Efectivo",
  "15": "Compensación de deudas",
  "16": "Tarjeta de débito",
  "17": "Dinero electrónico",
  "18": "Tarjeta prepago",
  "19": "Tarjeta de crédito",
  "20": "Transferencia u otro medio financiero",
  "21": "Endoso de títulos",
};

/** «Efectivo», o el nombre oficial si el código no tiene nombre corriente. */
export const paymentMethodName = (code: string, officialLabel: string) =>
  PAYMENT_METHOD_NAMES[code] ?? officialLabel;

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
