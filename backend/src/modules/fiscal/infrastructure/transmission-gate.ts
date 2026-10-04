// Interruptor de la transmisión al SRI (design D5): deshabilitada, el runner no toma jobs `sri.*`
// y la instalación puede estar lista, pero lo deja ver en la readiness, en una métrica y en el log
// de arranque. Habilitada, exige sus precondiciones técnicas; si falta una, la readiness es 503,
// el motivo va al log y los jobs `sri.*` siguen pausados. Nunca salta una invariante fiscal: los
// handlers comprueban igual la integridad, el tamaño y la evidencia previa.
import { Gauge, type Registry } from "@prometheus-io/client";
import type { Logger } from "pino";

export const SRI_JOB_PREFIX = "sri.";

export type TransmissionPreconditions = Readonly<{
  enabled: boolean;
  workers: number;
  /** Endpoints por ambiente y servicio resueltos y válidos. */
  endpointsValid: () => boolean;
  /** Hay una política de tamaño vigente (design D17). */
  sizePolicyAvailable: () => Promise<boolean>;
}>;

export type TransmissionState = Readonly<{
  enabled: boolean;
  ready: boolean;
  missing: readonly string[];
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

  async function refresh(): Promise<TransmissionState> {
    if (!preconditions.enabled) {
      open = false;
      return { enabled: false, ready: true, missing: [] };
    }
    const missing: string[] = [];
    if (preconditions.workers < 1) missing.push("workers");
    if (!preconditions.endpointsValid()) missing.push("endpoints");
    if (!(await preconditions.sizePolicyAvailable().catch(() => false)))
      missing.push("size-policy");
    open = missing.length === 0;
    const key = missing.join(",");
    if (key !== lastMissing) {
      if (open) deps.logger.info("transmisión al SRI habilitada con sus precondiciones");
      else deps.logger.warn({ missing }, "transmisión al SRI habilitada sin sus precondiciones");
      lastMissing = key;
    }
    return { enabled: true, ready: open, missing };
  }

  return {
    refresh,
    open: () => open,
    pausedPrefixes: () => (open ? [] : [SRI_JOB_PREFIX]),
  };
}
