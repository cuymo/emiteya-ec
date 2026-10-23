import { describe, expect, it } from "vitest";
import {
  type EnvelopeContext,
  EnvelopeError,
  keyCheckMatches,
  openEnvelope,
  sealEnvelope,
} from "../../src/platform/secrets/envelope.ts";

// Sobre genérico de `platform/secrets` (add-email-delivery, design D9): lo usan la firma y la
// contraseña SMTP, cada una con sus AAD.
const keyring = (version: string, fill: number) => ({
  activeVersion: version,
  keys: new Map([[version, Buffer.alloc(32, fill)]]),
});
const context = (owner: string): EnvelopeContext => ({
  wrapAad: (keyVersion) => Buffer.from(`prueba-clave|${keyVersion}|${owner}`),
  keyCheckLabel: (keyVersion) => `prueba-comprobacion|${keyVersion}`,
});
const SECRET = "contraseña-smtp-ñ-€";
const aad = (owner: string) => Buffer.from(`prueba-campo|${owner}`);
const seal = (ring = keyring("1", 3), owner = "empresa-a") =>
  sealEnvelope(ring, context(owner), {
    secret: { plaintext: Buffer.from(SECRET, "utf8"), aad: aad(owner) },
  });
const open = (
  sealed: ReturnType<typeof seal>,
  ring = keyring("1", 3),
  owner = "empresa-a",
  fieldOwner = owner,
) =>
  openEnvelope(ring, context(owner), sealed, {
    secret: { ...sealed.fields.secret, aad: aad(fieldOwner) },
  });

describe("sobre cifrado genérico", () => {
  it("ida y vuelta: sella y abre el campo", () => {
    const sealed = seal();
    expect(sealed.keyVersion).toBe("1");
    expect(open(sealed).secret.toString("utf8")).toBe(SECRET);
  });

  it("no contiene el texto claro, y cada sello usa una clave de datos y nonces nuevos", () => {
    const first = seal();
    const second = seal();
    const bytes = Buffer.concat([first.wrappedKey, first.fields.secret.ciphertext]);
    expect(bytes.includes(Buffer.from(SECRET, "utf8"))).toBe(false);
    expect(first.wrappedKey.equals(second.wrappedKey)).toBe(false);
    expect(first.fields.secret.nonce.equals(second.fields.secret.nonce)).toBe(false);
  });

  it("falla con el AAD de otro dueño, en el campo o en la clave envuelta", () => {
    const sealed = seal();
    expect(() => open(sealed, keyring("1", 3), "empresa-a", "empresa-b")).toThrow(EnvelopeError);
    expect(() => open(sealed, keyring("1", 3), "empresa-b", "empresa-a")).toThrow(EnvelopeError);
  });

  it("falla con otra clave maestra o sin la versión que lo envolvió", () => {
    const sealed = seal();
    expect(() => open(sealed, keyring("1", 4))).toThrow(EnvelopeError);
    expect(() => open(sealed, keyring("2", 3))).toThrow(EnvelopeError);
  });

  it("falla si se altera un byte de la clave envuelta, del campo o de un nonce", () => {
    const flip = (buffer: Buffer) => {
      const copy = Buffer.from(buffer);
      copy[0] = (copy[0] ?? 0) ^ 1;
      return copy;
    };
    const sealed = seal();
    const field = sealed.fields.secret;
    expect(() => open({ ...sealed, wrappedKey: flip(sealed.wrappedKey) })).toThrow(EnvelopeError);
    expect(() =>
      open({ ...sealed, fields: { secret: { ...field, ciphertext: flip(field.ciphertext) } } }),
    ).toThrow(EnvelopeError);
    expect(() =>
      open({ ...sealed, fields: { secret: { ...field, nonce: flip(field.nonce) } } }),
    ).toThrow(EnvelopeError);
    expect(() =>
      open({ ...sealed, fields: { secret: { ...field, ciphertext: Buffer.alloc(4) } } }),
    ).toThrow(EnvelopeError);
  });

  it("no sella si falta la clave maestra activa", () => {
    const ring = { activeVersion: "2", keys: new Map([["1", Buffer.alloc(32, 3)]]) };
    expect(() => seal(ring)).toThrow(EnvelopeError);
  });

  it("la comprobación reconoce la clave correcta sin descifrar y rechaza otra o una versión desconocida", () => {
    const sealed = seal();
    expect(keyCheckMatches(keyring("1", 3), context("cualquiera"), sealed)).toBe(true);
    expect(keyCheckMatches(keyring("1", 4), context("empresa-a"), sealed)).toBe(false);
    expect(keyCheckMatches(keyring("2", 3), context("empresa-a"), sealed)).toBe(false);
  });

  it("el error no lleva detalles ni causa", () => {
    try {
      open(seal(), keyring("1", 4));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EnvelopeError);
      expect((error as Error).message).not.toContain(SECRET);
      expect((error as Error).cause).toBeUndefined();
    }
  });
});
