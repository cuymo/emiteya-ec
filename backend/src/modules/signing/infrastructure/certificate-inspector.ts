// Lado principal de la inspección (design D3 y D18): envía el P12 al pool criptográfico y traduce
// el resultado. Transfiere una copia de los bytes, de modo que el original pueda ponerse a cero aquí.
import {
  workerEntry,
  type CryptoWorkerPool,
} from "../../../platform/workers/crypto-worker-pool.ts";
import {
  CERTIFICATE_REJECTIONS,
  INCOMPATIBLE_REASONS,
  type CertificateInspector,
  type CertificateRejection,
  type IncompatibleReason,
  type InspectedCertificate,
  type InspectionRejection,
} from "../application/ports.ts";
import { INSPECT_AND_TEST_SIGN } from "./certificate-task-names.ts";

/** Módulo del worker con las tareas de la firma electrónica. */
export const certificateTasksEntry = (): URL => workerEntry(import.meta.url, "./certificate-tasks");

const isRejection = (code: string): code is CertificateRejection =>
  (CERTIFICATE_REJECTIONS as readonly string[]).includes(code);
const isReason = (reason: string | undefined): reason is IncompatibleReason =>
  reason !== undefined && (INCOMPATIBLE_REASONS as readonly string[]).includes(reason);

/** "CODIGO" o "CODIGO:CAUSA", tal como lo devuelve el worker. */
function rejectionOf(raw: string): InspectionRejection {
  const [code = "", reason] = raw.split(":");
  if (!isRejection(code)) return { code: "CERTIFICATE_UNREADABLE" };
  return isReason(reason) ? { code, reason } : { code };
}

export function createCertificateInspector(pool: CryptoWorkerPool): CertificateInspector {
  return {
    async inspect(p12, password) {
      const copy = new Uint8Array(p12).buffer;
      const outcome = await pool.run<InspectedCertificate>(
        INSPECT_AND_TEST_SIGN,
        { p12: copy, password },
        [copy],
      );
      if (outcome.ok) return { ok: true, certificate: outcome.value };
      return { ok: false, ...rejectionOf(outcome.code) };
    },
  };
}
