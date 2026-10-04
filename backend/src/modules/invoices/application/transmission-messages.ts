// Motivo de una transmisión detenida en lenguaje de negocio (add-sri-transmission, design D18 y
// D20): sin datos técnicos ni secretos. Un código desconocido recibe el mensaje genérico.
import type { TransmissionStopCode } from "../../fiscal/domain/transmission.ts";

const STOP_MESSAGES: Readonly<Record<TransmissionStopCode, string>> = {
  INTEGRITY_FAILED:
    "El XML firmado guardado no superó la comprobación de integridad. No se envió nada al SRI; requiere soporte.",
  TOO_LARGE: "El comprobante firmado supera el tamaño máximo de envío al SRI. No se envió.",
  SIZE_POLICY_MISSING:
    "No hay una política vigente del tamaño máximo de envío al SRI, así que no se envió nada.",
  SRI_UNAVAILABLE:
    "El SRI no respondió durante los reintentos. Reconcilia cuando el servicio esté disponible.",
  HANDLER_ERROR: "La transmisión falló de forma inesperada. Reconcilia con el SRI para continuar.",
};

export const stopMessage = (code: string): string =>
  STOP_MESSAGES[code as TransmissionStopCode] ??
  "La transmisión se detuvo. Reconcilia con el SRI para continuar.";
