// Cifrado envolvente de la firma (ADR 0011, design D5, formato 1). Una clave de datos aleatoria
// por certificado cifra el P12 y la contraseña con AES-256-GCM; la clave maestra la envuelve. Cada
// secreto guarda la versión de la clave maestra y un HMAC que permite saber si la clave configurada
// es la correcta sin descifrar nada. Rotar será volver a envolver la clave de datos. El cifrado es el
// sobre genérico de `platform/secrets` (add-email-delivery, design D9); los AAD y la etiqueta de la
// comprobación son los de siempre, así que los secretos ya guardados se siguen abriendo.
import {
  type EnvelopeContext,
  EnvelopeError,
  keyCheckMatches,
  type MasterKeyring,
  openEnvelope,
  sealEnvelope,
} from "../../../../platform/secrets/envelope.ts";
import {
  CustodyError,
  type CertificateVault,
  type SealedSecret,
  type SecretBinding,
} from "../../application/ports.ts";
import { SecretBytes, SecretText, type SigningMaterial } from "../../domain/secret.ts";

export type { MasterKeyring } from "../../../../platform/secrets/envelope.ts";

export const FORMAT_VERSION = 1;

const fieldAad = (b: SecretBinding, field: "p12" | "password") =>
  Buffer.from(`signing-certificate|${FORMAT_VERSION}|${b.companyId}|${b.certificateId}|${field}`);

const contextOf = (b: SecretBinding): EnvelopeContext => ({
  wrapAad: (keyVersion) =>
    Buffer.from(
      `signing-certificate-key|${FORMAT_VERSION}|${keyVersion}|${b.companyId}|${b.certificateId}`,
    ),
  keyCheckLabel: (keyVersion) => `signing-certificate-key-check|${keyVersion}`,
});

// La comprobación de la clave no depende del certificado: solo de la clave maestra y su versión.
const KEY_CHECK_CONTEXT = contextOf({ companyId: "", certificateId: "" });

export function createCertificateVault(keyring: MasterKeyring): CertificateVault {
  return {
    seal({ p12, password }, binding) {
      const passwordBytes = Buffer.from(password.reveal(), "utf8");
      try {
        const sealed = sealEnvelope(keyring, contextOf(binding), {
          p12: { plaintext: p12.reveal(), aad: fieldAad(binding, "p12") },
          password: { plaintext: passwordBytes, aad: fieldAad(binding, "password") },
        });
        return {
          formatVersion: FORMAT_VERSION,
          keyVersion: sealed.keyVersion,
          keyCheck: sealed.keyCheck,
          wrappedKey: sealed.wrappedKey,
          wrappedKeyNonce: sealed.wrappedKeyNonce,
          p12Ciphertext: sealed.fields.p12.ciphertext,
          p12Nonce: sealed.fields.p12.nonce,
          passwordCiphertext: sealed.fields.password.ciphertext,
          passwordNonce: sealed.fields.password.nonce,
        };
      } catch (error) {
        if (error instanceof EnvelopeError) throw new CustodyError();
        throw error;
      } finally {
        passwordBytes.fill(0);
      }
    },

    open(sealed: SealedSecret, binding): SigningMaterial {
      if (sealed.formatVersion !== FORMAT_VERSION) throw new CustodyError();
      try {
        const opened = openEnvelope(keyring, contextOf(binding), sealed, {
          p12: {
            ciphertext: sealed.p12Ciphertext,
            nonce: sealed.p12Nonce,
            aad: fieldAad(binding, "p12"),
          },
          password: {
            ciphertext: sealed.passwordCiphertext,
            nonce: sealed.passwordNonce,
            aad: fieldAad(binding, "password"),
          },
        });
        const password = opened.password.toString("utf8");
        opened.password.fill(0);
        return { p12: new SecretBytes(opened.p12), password: new SecretText(password) };
      } catch {
        throw new CustodyError();
      }
    },

    canOpen(secret) {
      return keyCheckMatches(keyring, KEY_CHECK_CONTEXT, secret);
    },
  };
}
