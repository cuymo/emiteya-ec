// Firma de comprobantes con la firma vigente de la empresa (add-invoice-emission, design D9). Lee
// el certificado activo y su secreto sellado, lo abre con la custodia en el hilo principal (ADR
// 0011) y firma en el pool criptográfico, que comprueba la huella del certificado embebido. Los
// fallos son códigos de design D10; ningún mensaje lleva secretos ni el XML.
import type { DocumentType } from "@facturador/contracts";
import { DEFAULT_EXPIRY_ALERT_DAYS, deriveValidity } from "../domain/certificate.ts";
import {
  CustodyError,
  type CertificateRepository,
  type CertificateVault,
  type XmlSigningTask,
} from "./ports.ts";

export const DOCUMENT_SIGNING_ERRORS = [
  "SIGNING_CERTIFICATE_NOT_USABLE",
  "CUSTODY_UNAVAILABLE",
  "CERTIFICATE_MISMATCH",
  "SIGNER_FAILED",
  "CRYPTO_BUSY",
  "CRYPTO_TIMEOUT",
  "CRYPTO_UNAVAILABLE",
] as const;
export type DocumentSigningErrorCode = (typeof DOCUMENT_SIGNING_ERRORS)[number];

export class DocumentSigningError extends Error {
  readonly code: DocumentSigningErrorCode;
  constructor(code: DocumentSigningErrorCode) {
    super(code);
    this.name = "DocumentSigningError";
    this.code = code;
  }
}

export type SignedDocument = Readonly<{
  xml: string;
  /** Huella SHA-256 del certificado que firmó, la del certificado embebido. */
  certificateFingerprint: string;
  certificateId: string;
}>;

/** Errores del pool por su código (CRYPTO_BUSY, CRYPTO_TIMEOUT, CRYPTO_UNAVAILABLE). */
function poolFailure(error: unknown): DocumentSigningErrorCode {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "CRYPTO_BUSY" || code === "CRYPTO_TIMEOUT") return code;
  return "CRYPTO_UNAVAILABLE";
}

export function createDocumentSigning({
  certificates,
  vault,
  task,
  now = () => new Date(),
}: {
  certificates: Pick<CertificateRepository, "findActive" | "findSealedSecret">;
  vault: CertificateVault | null;
  task: XmlSigningTask;
  now?: () => Date;
}) {
  return {
    async signDocument(
      companyId: string,
      xml: string,
      documentType: DocumentType,
    ): Promise<SignedDocument> {
      const certificate = await certificates.findActive(companyId);
      if (!certificate) throw new DocumentSigningError("SIGNING_CERTIFICATE_NOT_USABLE");
      const validity = deriveValidity({
        notAfter: certificate.notAfter,
        now: now(),
        expiryAlertDays: DEFAULT_EXPIRY_ALERT_DAYS,
        keyAvailable: true,
      });
      if (!validity.usable) throw new DocumentSigningError("SIGNING_CERTIFICATE_NOT_USABLE");
      if (!vault || !certificate.secret || !vault.canOpen(certificate.secret)) {
        throw new DocumentSigningError("CUSTODY_UNAVAILABLE");
      }
      const sealed = await certificates.findSealedSecret(companyId, certificate.id);
      if (!sealed) throw new DocumentSigningError("CUSTODY_UNAVAILABLE");
      let material;
      try {
        material = vault.open(sealed, { companyId, certificateId: certificate.id });
      } catch (error) {
        if (error instanceof CustodyError) throw new DocumentSigningError("CUSTODY_UNAVAILABLE");
        throw error;
      }
      let outcome;
      try {
        outcome = await task.sign({
          xml,
          documentType,
          p12: material.p12.reveal(),
          password: material.password.reveal(),
          fingerprint: certificate.fingerprint,
        });
      } catch (error) {
        throw new DocumentSigningError(poolFailure(error));
      } finally {
        material.p12.wipe();
      }
      if (!outcome.ok) {
        throw new DocumentSigningError(
          outcome.code === "CERTIFICATE_MISMATCH" ? "CERTIFICATE_MISMATCH" : "SIGNER_FAILED",
        );
      }
      return {
        xml: outcome.xml,
        certificateFingerprint: certificate.fingerprint,
        certificateId: certificate.id,
      };
    },
  };
}

export type DocumentSigning = ReturnType<typeof createDocumentSigning>;
