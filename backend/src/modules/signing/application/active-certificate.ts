// Firma vigente para la emisión de facturas (add-invoice-emission, design D1 y D9): su id, su huella
// y si es utilizable ahora. La emisión la lee dentro de su transacción de reserva y antes de firmar.
// Utilizable no depende de la anticipación del aviso: solo distingue vigente de por vencer.
import { DEFAULT_EXPIRY_ALERT_DAYS, deriveValidity } from "../domain/certificate.ts";
import type { CertificateRepository, CertificateVault } from "./ports.ts";

export type ActiveCertificate = Readonly<{
  id: string;
  /** SHA-256 del certificado DER, hexadecimal en minúsculas. */
  fingerprint: string;
  usable: boolean;
}>;

export function activeCertificateReader({
  certificates,
  vault,
  now,
}: {
  certificates: Pick<CertificateRepository, "findActive">;
  vault: Pick<CertificateVault, "canOpen"> | null;
  now: () => Date;
}) {
  return {
    async activeCertificate(companyId: string): Promise<ActiveCertificate | null> {
      const certificate = await certificates.findActive(companyId);
      if (!certificate) return null;
      const validity = deriveValidity({
        notAfter: certificate.notAfter,
        now: now(),
        expiryAlertDays: DEFAULT_EXPIRY_ALERT_DAYS,
        keyAvailable:
          vault !== null && certificate.secret !== null && vault.canOpen(certificate.secret),
      });
      return { id: certificate.id, fingerprint: certificate.fingerprint, usable: validity.usable };
    },
  };
}
