// Motivo de una transmisión detenida en lenguaje de negocio (add-sri-transmission, design D18 y
// D20): sin datos técnicos ni secretos. Un código desconocido recibe el mensaje genérico. Solo dice
// qué pasó: la acción depende del rol y la indica la interfaz. Vive en `fiscal` porque lo comparten
// todos los tipos; la retención no importa `invoices` (add-withholding-receipts, design D1).
import type { TransmissionStopCode } from "../domain/transmission.ts";

const STOP_MESSAGES: Readonly<Record<TransmissionStopCode, string>> = {
  INTEGRITY_FAILED:
    "El XML firmado guardado no superó la comprobación de integridad. No se envió nada al SRI; requiere soporte.",
  TOO_LARGE: "El comprobante firmado supera el tamaño máximo de envío al SRI. No se envió.",
  SIZE_POLICY_MISSING:
    "No hay una política vigente del tamaño máximo de envío al SRI, así que no se envió nada.",
  SRI_UNAVAILABLE: "El SRI no respondió durante los reintentos.",
  HANDLER_ERROR: "La transmisión falló de forma inesperada.",
  CERTIFICATION_SIZE_CAP_EXCEEDED:
    "El comprobante supera el tope de seguridad de la sesión de certificación en Pruebas, que no es un límite del SRI. No se envió nada al SRI.",
  CERTIFICATION_ENVIRONMENT_NOT_TEST:
    "La sesión de certificación solo se comunica con el SRI sobre comprobantes del ambiente de Pruebas. No se envió nada al SRI.",
};

export const stopMessage = (code: string): string =>
  STOP_MESSAGES[code as TransmissionStopCode] ?? "La transmisión se detuvo.";
