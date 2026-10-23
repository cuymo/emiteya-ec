// Cifrado envolvente genérico (ADR 0011; add-email-delivery, design D9). Una clave de datos
// aleatoria cifra cada campo con AES-256-GCM y su propio AAD; la clave maestra, elegida por versión,
// la envuelve. El llamador decide los AAD y la etiqueta de la comprobación de la clave, así que cada
// tipo de secreto (la firma, la contraseña SMTP) conserva su formato y no se puede abrir con el
// contexto de otro. La comprobación es un HMAC de la clave maestra: dice si la clave configurada es
// la correcta sin descifrar nada.
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const DATA_KEY_BYTES = 32;

/** Claves maestras por versión; hoy se configura una, la activa. */
export type MasterKeyring = Readonly<{ activeVersion: string; keys: ReadonlyMap<string, Buffer> }>;

/** Un campo cifrado: el texto cifrado lleva al final la etiqueta de autenticación de GCM. */
export type SealedField = Readonly<{ ciphertext: Buffer; nonce: Buffer }>;

export type SealedEnvelope<K extends string> = Readonly<{
  keyVersion: string;
  keyCheck: Buffer;
  wrappedKey: Buffer;
  wrappedKeyNonce: Buffer;
  fields: Readonly<Record<K, SealedField>>;
}>;

/** Cómo se liga un sobre a su contexto: los AAD de la clave envuelta y la comprobación. */
export type EnvelopeContext = Readonly<{
  wrapAad: (keyVersion: string) => Buffer;
  keyCheckLabel: (keyVersion: string) => string;
}>;

/** El sobre no se pudo sellar o abrir: clave desconocida, datos alterados o contexto distinto. */
export class EnvelopeError extends Error {
  constructor() {
    super("No se pudo sellar o abrir el secreto.");
    this.name = "EnvelopeError";
  }
}

function encrypt(key: Buffer, plaintext: Buffer, aad: Buffer): SealedField {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce).setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  return { ciphertext, nonce };
}

function decrypt(key: Buffer, { ciphertext, nonce }: SealedField, aad: Buffer): Buffer {
  if (ciphertext.length < TAG_BYTES) throw new EnvelopeError();
  const tag = ciphertext.subarray(ciphertext.length - TAG_BYTES);
  const body = ciphertext.subarray(0, ciphertext.length - TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce).setAAD(aad).setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

const keyCheckOf = (masterKey: Buffer, label: string) =>
  createHmac("sha256", masterKey).update(label).digest();

function masterKeyOf(keyring: MasterKeyring, version: string): Buffer {
  const key = keyring.keys.get(version);
  if (!key) throw new EnvelopeError();
  return key;
}

/** Sella los campos con una clave de datos nueva, envuelta con la clave maestra activa. */
export function sealEnvelope<K extends string>(
  keyring: MasterKeyring,
  context: EnvelopeContext,
  fields: Readonly<Record<K, Readonly<{ plaintext: Buffer; aad: Buffer }>>>,
): SealedEnvelope<K> {
  const keyVersion = keyring.activeVersion;
  const master = masterKeyOf(keyring, keyVersion);
  const dataKey = randomBytes(DATA_KEY_BYTES);
  try {
    const sealed = {} as Record<K, SealedField>;
    for (const name of Object.keys(fields) as K[]) {
      sealed[name] = encrypt(dataKey, fields[name].plaintext, fields[name].aad);
    }
    const wrapped = encrypt(master, dataKey, context.wrapAad(keyVersion));
    return {
      keyVersion,
      keyCheck: keyCheckOf(master, context.keyCheckLabel(keyVersion)),
      wrappedKey: wrapped.ciphertext,
      wrappedKeyNonce: wrapped.nonce,
      fields: sealed,
    };
  } finally {
    dataKey.fill(0);
  }
}

/**
 * Abre los campos pedidos, cada uno con su AAD. Cualquier fallo (clave desconocida, AAD distinto,
 * datos alterados) es un `EnvelopeError`, sin detalles. La clave de datos se borra al terminar; el
 * llamador borra los textos claros cuando ya no los necesita.
 */
export function openEnvelope<K extends string>(
  keyring: MasterKeyring,
  context: EnvelopeContext,
  sealed: Readonly<{ keyVersion: string; wrappedKey: Buffer; wrappedKeyNonce: Buffer }>,
  fields: Readonly<Record<K, SealedField & Readonly<{ aad: Buffer }>>>,
): Record<K, Buffer> {
  let dataKey: Buffer | undefined;
  try {
    const master = masterKeyOf(keyring, sealed.keyVersion);
    dataKey = decrypt(
      master,
      { ciphertext: sealed.wrappedKey, nonce: sealed.wrappedKeyNonce },
      context.wrapAad(sealed.keyVersion),
    );
    const opened = {} as Record<K, Buffer>;
    for (const name of Object.keys(fields) as K[]) {
      opened[name] = decrypt(dataKey, fields[name], fields[name].aad);
    }
    return opened;
  } catch {
    throw new EnvelopeError();
  } finally {
    dataKey?.fill(0);
  }
}

/** Si la clave maestra de esa versión es la que selló el sobre, sin descifrar nada. */
export function keyCheckMatches(
  keyring: MasterKeyring,
  context: EnvelopeContext,
  sealed: Readonly<{ keyVersion: string; keyCheck: Buffer }>,
): boolean {
  const key = keyring.keys.get(sealed.keyVersion);
  if (!key) return false;
  const expected = keyCheckOf(key, context.keyCheckLabel(sealed.keyVersion));
  return expected.length === sealed.keyCheck.length && timingSafeEqual(expected, sealed.keyCheck);
}
