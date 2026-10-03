// Vigencia derivada, condición de utilizable y coincidencia del RUC de la firma electrónica
// (add-signing-certificate, design D4 y D8). Se calculan al leer, con el reloj del servidor: no
// hay un estado vencido persistido ni un job que lo marque.
import { EXPIRY_ALERT_DAYS, type CertificateState, type RucMatch } from "@facturador/contracts";

export const DEFAULT_EXPIRY_ALERT_DAYS: number = EXPIRY_ALERT_DAYS.default;
const DAY_MS = 86_400_000;

export type CertificateValidity = Readonly<{
  state: Exclude<CertificateState, "NONE">;
  daysToExpiry: number;
  usable: boolean;
}>;

/** Días que faltan para el vencimiento, redondeados hacia arriba; negativos si ya venció. */
export function daysToExpiry(notAfter: Date, now: Date): number {
  return Math.ceil((notAfter.getTime() - now.getTime()) / DAY_MS) || 0;
}

/**
 * Vigencia de la firma vigente. La carga rechaza certificados todavía no vigentes, así que
 * `notBefore` no interviene: una firma guardada siempre empezó su vigencia antes de cargarse.
 */
export function deriveValidity(input: {
  notAfter: Date;
  now: Date;
  expiryAlertDays: number;
  /** false si la clave de custodia no abre el secreto o la custodia está deshabilitada. */
  keyAvailable: boolean;
}): CertificateValidity {
  const remaining = input.notAfter.getTime() - input.now.getTime();
  let state: CertificateValidity["state"];
  if (remaining < 0) state = "EXPIRED";
  else if (!input.keyAvailable) state = "KEY_UNAVAILABLE";
  else if (remaining < input.expiryAlertDays * DAY_MS) state = "EXPIRING";
  else state = "VALID";
  return {
    state,
    daysToExpiry: daysToExpiry(input.notAfter, input.now),
    usable: state === "VALID" || state === "EXPIRING",
  };
}

/** Coincidencia con el RUC vigente de la empresa (Q-17): solo informa, nunca bloquea. */
export function rucMatch(detectedRuc: string, companyRuc: string | null): RucMatch {
  if (companyRuc === null) return "PENDING";
  return detectedRuc === companyRuc ? "MATCH" : "MISMATCH";
}
