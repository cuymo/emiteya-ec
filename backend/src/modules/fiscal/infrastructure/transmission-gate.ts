// Interruptor de la transmisión al SRI (design D5): deshabilitada, el runner no toma jobs `sri.*`
// y la instalación puede estar lista, pero lo deja ver en la readiness, en una métrica y en el log
// de arranque. Habilitada, exige sus precondiciones técnicas; si falta una, la readiness es 503,
// el motivo va al log y los jobs `sri.*` siguen pausados. Nunca salta una invariante fiscal: los
// handlers comprueban igual la integridad, la política de tamaño y la evidencia previa. La política
// conservadora de tamaño siempre existe y no es una precondición
// (adopt-conservative-sri-transmission-size-policy-v1, design D4).
import { Gauge, type Registry } from "@prometheus-io/client";
import type { Logger } from "pino";
import type { TransmissionSizeCheck } from "../application/transmission-size-diagnostics.ts";
import {
  TRANSMISSION_SIZE_POLICY,
  type TransmissionSizePolicyId,
} from "../domain/transmission-size-policy.ts";

export const SRI_JOB_PREFIX = "sri.";

export type TransmissionPreconditions = Readonly<{
  enabled: boolean;
  workers: number;
  /** Endpoints por ambiente y servicio resueltos y válidos. */
  endpointsValid: () => boolean;
  /** Última comprobación de la política de tamaño, sin identificar el comprobante. */
  lastSizeCheck?: () => TransmissionSizeCheck | null;
}>;

/**
 * La política de tamaño vigente y su última comprobación, sin secretos: nunca el XML, el base64 ni
 * el cuerpo SOAP. Su fuente es la política del producto, nunca una política oficial del SRI.
 */
export type SizePolicyState = Readonly<{
  source: TransmissionSizePolicyId;
  limitBytes: number;
  lastCheck: TransmissionSizeCheck | null;
}>;

export type TransmissionState = Readonly<{
  enabled: boolean;
  ready: boolean;
  missing: readonly string[];
  sizePolicy: SizePolicyState;
}>;

export type TransmissionGate = {
  /** Reevalúa las precondiciones; la readiness la llama en cada sondeo. */
  refresh: () => Promise<TransmissionState>;
  /** Último estado conocido, sin esperar: los workers lo consultan en cada vuelta. */
  open: () => boolean;
  /** Prefijos pausados para el runner. */
  pausedPrefixes: () => readonly string[];
};

export function createTransmissionGate(
  preconditions: TransmissionPreconditions,
  deps: Readonly<{ logger: Pick<Logger, "warn" | "info">; registry: Registry }>,
): TransmissionGate {
  new Gauge({
    name: "sri_transmission_enabled",
    help: "1 si la transmisión al SRI está habilitada en esta instancia, 0 si no.",
    registers: [deps.registry],
  }).set(preconditions.enabled ? 1 : 0);
  let open = false;
  let lastMissing: string | undefined;

  function refresh(): Promise<TransmissionState> {
    const sizePolicy: SizePolicyState = {
      source: TRANSMISSION_SIZE_POLICY.id,
      limitBytes: TRANSMISSION_SIZE_POLICY.limitBytes,
      lastCheck: preconditions.lastSizeCheck?.() ?? null,
    };
    if (!preconditions.enabled) {
      open = false;
      return Promise.resolve({ enabled: false, ready: true, missing: [], sizePolicy });
    }
    const missing: string[] = [];
    if (preconditions.workers < 1) missing.push("workers");
    if (!preconditions.endpointsValid()) missing.push("endpoints");
    open = missing.length === 0;
    const key = missing.join(",");
    if (key !== lastMissing) {
      if (open) deps.logger.info("transmisión al SRI habilitada con sus precondiciones");
      else deps.logger.warn({ missing }, "transmisión al SRI habilitada sin sus precondiciones");
      lastMissing = key;
    }
    return Promise.resolve({ enabled: true, ready: open, missing, sizePolicy });
  }

  return {
    refresh,
    open: () => open,
    pausedPrefixes: () => (open ? [] : [SRI_JOB_PREFIX]),
  };
}
