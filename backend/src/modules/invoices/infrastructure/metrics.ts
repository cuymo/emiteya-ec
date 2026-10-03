// Histograma de las etapas de la emisión (add-invoice-emission, design D16) en el registro de
// métricas existente. `outcome`: signed, reserved, replayed, rejected (4xx) o error.
import { Histogram, type Registry } from "@prometheus-io/client";
import type { StageTiming } from "../../../platform/metrics/stage-timings.ts";

export type EmissionOutcome = "signed" | "reserved" | "replayed" | "rejected" | "error";

export type EmissionObserver = (entries: readonly StageTiming[], outcome: EmissionOutcome) => void;

export function registerEmissionMetrics(registry: Registry): EmissionObserver {
  const histogram = new Histogram({
    name: "invoice_emission_stage_duration_seconds",
    help: "Duración de cada etapa de la emisión de una factura, por resultado.",
    labelNames: ["stage", "outcome"] as const,
    buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    registers: [registry],
  });
  return (entries, outcome) => {
    for (const { stage, ms } of entries) histogram.observe({ stage, outcome }, ms / 1000);
  };
}
