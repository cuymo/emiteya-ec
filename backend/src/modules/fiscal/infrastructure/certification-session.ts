// Sesión de certificación en Pruebas (add-sri-certification-safety-cap, design D6): guarda la última
// comprobación para la readiness y cuenta los bloqueos por motivo. Las métricas no llevan clave, RUC,
// número, tercero ni contenido: una sola etiqueta `reason` con dos valores.
import { Counter, Gauge, type Registry } from "@prometheus-io/client";
import type {
  CertificationBlockReason,
  CertificationCheck,
  CertificationSession,
} from "../application/certification-session.ts";

const BLOCK_LABELS: Readonly<Record<CertificationBlockReason, string>> = {
  CERTIFICATION_SIZE_CAP_EXCEEDED: "SIZE_CAP_EXCEEDED",
  CERTIFICATION_ENVIRONMENT_NOT_TEST: "ENVIRONMENT_NOT_TEST",
};

export type ObservedCertificationSession = CertificationSession &
  Readonly<{ lastCheck: () => CertificationCheck | null }>;

export function createCertificationSession(
  options: Readonly<{ enabled: boolean; registry: Registry }>,
): ObservedCertificationSession {
  new Gauge({
    name: "sri_certification_safety_cap_enabled",
    help: "1 si la sesión de certificación en Pruebas (tope de seguridad, no un límite del SRI) está activa, 0 si no.",
    registers: [options.registry],
  }).set(options.enabled ? 1 : 0);
  const blocks = new Counter({
    name: "sri_certification_gate_blocks_total",
    help: "Comprobantes que la sesión de certificación detuvo antes de llamar al SRI, por motivo.",
    labelNames: ["reason"] as const,
    registers: [options.registry],
  });
  for (const label of Object.values(BLOCK_LABELS)) blocks.inc({ reason: label }, 0);
  let last: CertificationCheck | null = null;
  return {
    enabled: options.enabled,
    observe(check) {
      last = check;
      if (!check.allowed && check.reason) blocks.inc({ reason: BLOCK_LABELS[check.reason] });
    },
    lastCheck: () => last,
  };
}
