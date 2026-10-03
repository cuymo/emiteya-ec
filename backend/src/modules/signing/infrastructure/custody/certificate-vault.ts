// Cifrado envolvente de la firma (ADR 0011, design D5, formato 1). Una clave de datos aleatoria
// por certificado cifra el P12 y la contraseña con AES-256-GCM; la clave maestra la envuelve. Cada
// secreto guarda la versión de la clave maestra y un HMAC que permite saber si la clave configurada
// es la correcta sin descifrar nada. Rotar será volver a envolver la clave de datos.
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import {
  CustodyError,
  type CertificateVault,
  type SealedSecret,
  type SecretBinding,
} from "../../application/ports.ts";
import { SecretBytes, SecretText, type SigningMaterial } from "../../domain/secret.ts";

export const FORMAT_VERSION = 1;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/** Claves maestras por versión; hoy se configura una, la activa. */
export type MasterKeyring = Readonly<{ activeVersion: string; keys: ReadonlyMap<string, Buffer> }>;

const fieldAad = (b: SecretBinding, field: "p12" | "password") =>
  Buffer.from(`signing-certificate|${FORMAT_VERSION}|${b.companyId}|${b.certificateId}|${field}`);
const wrapAad = (b: SecretBinding, keyVersion: string) =>
  Buffer.from(
    `signing-certificate-key|${FORMAT_VERSION}|${keyVersion}|${b.companyId}|${b.certificateId}`,
  );
const keyCheckOf = (masterKey: Buffer, keyVersion: string) =>
  createHmac("sha256", masterKey).update(`signing-certificate-key-check|${keyVersion}`).digest();

function encrypt(key: Buffer, plaintext: Buffer, aad: Buffer) {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce).setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  return { ciphertext, nonce };
}

function decrypt(key: Buffer, ciphertext: Buffer, nonce: Buffer, aad: Buffer): Buffer {
  const tag = ciphertext.subarray(ciphertext.length - TAG_BYTES);
  const body = ciphertext.subarray(0, ciphertext.length - TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce).setAAD(aad).setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

export function createCertificateVault(keyring: MasterKeyring): CertificateVault {
  const masterKey = (version: string) => {
    const key = keyring.keys.get(version);
    if (!key) throw new CustodyError();
    return key;
  };

  return {
    seal({ p12, password }, binding) {
      const keyVersion = keyring.activeVersion;
      const master = masterKey(keyVersion);
      const dataKey = randomBytes(32);
      try {
        const passwordBytes = Buffer.from(password.reveal(), "utf8");
        const sealedP12 = encrypt(dataKey, p12.reveal(), fieldAad(binding, "p12"));
        const sealedPassword = encrypt(dataKey, passwordBytes, fieldAad(binding, "password"));
        passwordBytes.fill(0);
        const wrapped = encrypt(master, dataKey, wrapAad(binding, keyVersion));
        return {
          formatVersion: FORMAT_VERSION,
          keyVersion,
          keyCheck: keyCheckOf(master, keyVersion),
          wrappedKey: wrapped.ciphertext,
          wrappedKeyNonce: wrapped.nonce,
          p12Ciphertext: sealedP12.ciphertext,
          p12Nonce: sealedP12.nonce,
          passwordCiphertext: sealedPassword.ciphertext,
          passwordNonce: sealedPassword.nonce,
        };
      } finally {
        dataKey.fill(0);
      }
    },

    open(sealed: SealedSecret, binding): SigningMaterial {
      if (sealed.formatVersion !== FORMAT_VERSION) throw new CustodyError();
      let dataKey: Buffer | undefined;
      try {
        const master = masterKey(sealed.keyVersion);
        dataKey = decrypt(
          master,
          sealed.wrappedKey,
          sealed.wrappedKeyNonce,
          wrapAad(binding, sealed.keyVersion),
        );
        const p12 = decrypt(
          dataKey,
          sealed.p12Ciphertext,
          sealed.p12Nonce,
          fieldAad(binding, "p12"),
        );
        const passwordBytes = decrypt(
          dataKey,
          sealed.passwordCiphertext,
          sealed.passwordNonce,
          fieldAad(binding, "password"),
        );
        const password = passwordBytes.toString("utf8");
        passwordBytes.fill(0);
        return { p12: new SecretBytes(p12), password: new SecretText(password) };
      } catch {
        throw new CustodyError();
      } finally {
        dataKey?.fill(0);
      }
    },

    canOpen({ keyVersion, keyCheck }) {
      const key = keyring.keys.get(keyVersion);
      if (!key) return false;
      const expected = keyCheckOf(key, keyVersion);
      return expected.length === keyCheck.length && timingSafeEqual(expected, keyCheck);
    },
  };
}
