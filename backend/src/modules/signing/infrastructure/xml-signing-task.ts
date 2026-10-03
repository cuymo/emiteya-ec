// Lado principal de la tarea `sign-xml` (add-invoice-emission, design D9): transfiere los bytes del
// P12 al worker, que firma y comprueba la huella del certificado embebido. Los fallos del pool
// (saturado, plazo vencido, cerrado o worker caído) llegan como sus errores tipados.
import type { CryptoWorkerPool } from "../../../platform/workers/crypto-worker-pool.ts";
import type { XmlSigningTask } from "../application/ports.ts";
import { SIGN_XML } from "./certificate-task-names.ts";

export function createXmlSigningTask(pool: CryptoWorkerPool): XmlSigningTask {
  return {
    async sign({ xml, documentType, p12, password, fingerprint }) {
      // Buffer.from(buffer) copia en un ArrayBuffer propio, que se transfiere sin compartir memoria.
      const copy = new Uint8Array(p12).buffer;
      p12.fill(0);
      const outcome = await pool.run<string>(
        SIGN_XML,
        { xml, documentType, p12: copy, password, fingerprint },
        [copy],
      );
      return outcome.ok ? { ok: true, xml: outcome.value } : { ok: false, code: outcome.code };
    },
  };
}
