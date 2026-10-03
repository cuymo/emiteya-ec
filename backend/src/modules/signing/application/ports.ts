// Puertos de la firma electrónica (add-signing-certificate, design D1, D2 y D5). La infraestructura
// los implementa; los casos de uso solo ven datos del dominio y material secreto opaco.
import type { SigningMaterial } from "../domain/secret.ts";

/** Ligadura del secreto a su registro: copiarlo a otra empresa u otro registro no se descifra. */
export type SecretBinding = Readonly<{ companyId: string; certificateId: string }>;

/** Secreto cifrado tal como se guarda (formato 1 de design D5); ninguno de sus campos es legible. */
export type SealedSecret = Readonly<{
  formatVersion: number;
  keyVersion: string;
  keyCheck: Buffer;
  wrappedKey: Buffer;
  wrappedKeyNonce: Buffer;
  p12Ciphertext: Buffer;
  p12Nonce: Buffer;
  passwordCiphertext: Buffer;
  passwordNonce: Buffer;
}>;

/** Único punto que cifra y descifra el material de la firma (ADR 0011). */
export interface CertificateVault {
  seal(material: SigningMaterial, binding: SecretBinding): SealedSecret;
  /** Solo lo usará el adaptador de firma; lanza `CustodyError` si no se puede abrir. */
  open(sealed: SealedSecret, binding: SecretBinding): SigningMaterial;
  /** true si la clave configurada es la que envolvió el secreto, sin descifrar nada. */
  canOpen(sealed: Pick<SealedSecret, "keyVersion" | "keyCheck">): boolean;
}

export class CustodyError extends Error {
  constructor() {
    super("El secreto de la firma no se puede abrir con la clave de custodia configurada.");
    this.name = "CustodyError";
  }
}

/** Códigos de la inspección y la firma de prueba (design D3). */
export const CERTIFICATE_REJECTIONS = [
  "CERTIFICATE_UNREADABLE",
  "CERTIFICATE_PASSWORD_INVALID",
  "CERTIFICATE_KEY_UNSUPPORTED",
  "CERTIFICATE_INCOMPATIBLE",
] as const;
export type CertificateRejection = (typeof CERTIFICATE_REJECTIONS)[number];

/** Lo que la carga sabe del P12 tras inspeccionarlo y firmar con él una prueba (sin secretos). */
export type InspectedCertificate = Readonly<{
  subject: string;
  issuer: string;
  serialNumber: string;
  /** SHA-256 del certificado DER, hexadecimal en minúsculas. */
  fingerprint: string;
  notBefore: string;
  notAfter: string;
  keyAlgorithm: "RSA";
  keyBits: number;
  detectedRuc: string | null;
  rucExtractor: string | null;
  chainLength: number;
}>;

/** Inspección y firma de prueba fuera del event loop (design D3 y D18). */
export interface CertificateInspector {
  inspect(
    p12: Buffer,
    password: string,
  ): Promise<
    { ok: true; certificate: InspectedCertificate } | { ok: false; code: CertificateRejection }
  >;
}
