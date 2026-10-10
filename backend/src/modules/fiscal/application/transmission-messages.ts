// Motivo de una transmisión detenida en lenguaje de negocio (add-sri-transmission, design D18 y
// D20): sin datos técnicos ni secretos. Un código desconocido recibe el mensaje genérico. Solo dice
// qué pasó: la acción depende del rol y la indica la interfaz. Vive en `fiscal` porque lo comparten
// todos los tipos; la retención no importa `invoices` (add-withholding-receipts, design D1).
import type { TransmissionStopCode } from "../domain/transmission.ts";

const STOP_MESSAGES: Readonly<Record<TransmissionStopCode, string>> = {
  INTEGRITY_FAILED:
    "El XML firmado guardado no superó la comprobación de integridad. No se envió nada al SRI; requiere soporte.",
  TRANSMISSION_SIZE_POLICY_EXCEEDED:
    "El comprobante excede el límite de seguridad de transmisión de EmiteYa. Reduzca el contenido antes de enviarlo.",
  SRI_UNAVAILABLE: "El SRI no respondió durante los reintentos.",
  HANDLER_ERROR: "La transmisión falló de forma inesperada.",
};

export const stopMessage = (code: string): string =>
  STOP_MESSAGES[code as TransmissionStopCode] ?? "La transmisión se detuvo.";
