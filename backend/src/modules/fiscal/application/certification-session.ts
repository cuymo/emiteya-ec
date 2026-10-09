// Sesión de certificación en Pruebas (add-sri-certification-safety-cap, design D4 a D6): si está
// encendida y lo que observa cada comprobación, para la readiness, la métrica y el registro. Sin la
// sesión el sistema se comporta como antes: el puerto es opcional y nace apagado.
import type { Environment } from "../../taxpayer/domain/taxpayer-config.ts";
import type {
  CertificationSizes,
  EffectiveSizePolicySource,
} from "../domain/certification-safety-cap.ts";

export type CertificationBlockReason =
  | "CERTIFICATION_SIZE_CAP_EXCEEDED"
  | "CERTIFICATION_ENVIRONMENT_NOT_TEST";

/**
 * Una comprobación de la sesión, sin identificar el comprobante: ni clave, ni RUC, ni número, ni
 * terceros, ni contenido.
 */
export type CertificationCheck = Readonly<{
  fiscalEnvironment: Environment;
  allowed: boolean;
  reason: CertificationBlockReason | null;
  /** Las tres medidas, cuando se llegó a construir el cuerpo de la recepción. */
  sizes: CertificationSizes | null;
  capBytes: number;
  effectiveSizePolicySource: EffectiveSizePolicySource | null;
  at: Date;
}>;

export type CertificationSession = Readonly<{
  enabled: boolean;
  observe(check: CertificationCheck): void;
}>;

export const CERTIFICATION_SESSION_OFF: CertificationSession = {
  enabled: false,
  observe: () => {},
};
