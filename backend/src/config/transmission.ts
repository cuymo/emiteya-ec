// Configuración de la transmisión al SRI desde el entorno (add-sri-transmission, design D22). El
// backoff de las consultas rige también los reintentos del envío (`deployment.md`).
import type { TransmissionSettings } from "../modules/fiscal/infrastructure/index.ts";
import type { Env } from "./env.ts";

const SECOND = 1_000;
const HOUR = 3_600 * SECOND;

export function transmissionSettingsFromEnv(env: Env): TransmissionSettings {
  const backoff = {
    baseMs: env.SRI_POLL_BACKOFF_BASE_SECONDS * SECOND,
    capMs: env.SRI_POLL_BACKOFF_CAP_SECONDS * SECOND,
    minMs: SECOND,
  };
  return {
    transmit: {
      maxAttempts: env.SRI_TRANSMIT_MAX_ATTEMPTS,
      deadlineMs: env.SRI_TRANSMIT_DEADLINE_HOURS * HOUR,
      backoff,
    },
    poll: {
      firstDelayMs: env.SRI_AUTHORIZATION_FIRST_DELAY_SECONDS * SECOND,
      backoff,
      windowMs: env.SRI_CONCLUSION_WINDOW_HOURS * HOUR,
      error70DelayMs: env.SRI_ERROR70_DELAY_SECONDS * SECOND,
    },
  };
}
