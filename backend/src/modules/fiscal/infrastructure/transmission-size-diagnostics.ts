// Diagnóstico de la política conservadora de tamaño (adopt-conservative-sri-transmission-size-policy-v1,
// design D4): guarda la última comprobación para la readiness y cuenta los bloqueos. La métrica no
// lleva clave, RUC, número, tercero ni contenido, y no tiene etiquetas.
import { Counter, type Registry } from "@prometheus-io/client";
import type {
  TransmissionSizeCheck,
  TransmissionSizeObserver,
} from "../application/transmission-size-diagnostics.ts";

export type ObservedTransmissionSize = TransmissionSizeObserver &
  Readonly<{ lastCheck: () => TransmissionSizeCheck | null }>;

export function createTransmissionSizeDiagnostics(
  options: Readonly<{ registry: Registry }>,
): ObservedTransmissionSize {
  const blocks = new Counter({
    name: "sri_transmission_size_policy_blocks_total",
    help: "Comprobantes que la política conservadora de tamaño de EmiteYa detuvo antes de llamar al SRI.",
    registers: [options.registry],
  });
  blocks.inc(0);
  let last: TransmissionSizeCheck | null = null;
  return {
    observe(check) {
      last = check;
      if (!check.allowed) blocks.inc();
    },
    lastCheck: () => last,
  };
}
