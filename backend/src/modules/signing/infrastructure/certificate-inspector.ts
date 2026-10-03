// Lado principal de la inspección (design D3 y D18): envía el P12 al pool criptográfico y traduce
// el resultado. Transfiere una copia de los bytes, de modo que el original pueda ponerse a cero aquí.
import type { CryptoWorkerPool } from "../../../platform/workers/crypto-worker-pool.ts";
import { workerEntry } from "../../../platform/workers/crypto-worker-pool.ts";
import {
  CERTIFICATE_REJECTIONS,
  type CertificateInspector,
  type CertificateRejection,
  type InspectedCertificate,
} from "../application/ports.ts";

export const INSPECT_AND_TEST_SIGN = "inspect-and-test-sign";

/** Módulo del worker con las tareas de la firma electrónica. */
export const certificateTasksEntry = (): URL => workerEntry(import.meta.url, "./certificate-tasks");

const isRejection = (code: string): code is CertificateRejection =>
  (CERTIFICATE_REJECTIONS as readonly string[]).includes(code);

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
      return {
        ok: false,
        code: isRejection(outcome.code) ? outcome.code : "CERTIFICATE_UNREADABLE",
      };
    },
  };
}
