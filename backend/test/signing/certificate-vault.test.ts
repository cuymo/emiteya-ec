import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { CustodyError } from "../../src/modules/signing/application/ports.ts";
import { SecretBytes, SecretText } from "../../src/modules/signing/domain/secret.ts";
import { createCertificateVault } from "../../src/modules/signing/infrastructure/custody/certificate-vault.ts";

const keyring = (version: string, fill: number) => ({
  activeVersion: version,
  keys: new Map([[version, Buffer.alloc(32, fill)]]),
});
const P12 = Buffer.from("contenido-pkcs12-de-prueba-".repeat(40));
const PASSWORD = "contraseña-ñ-€-de-prueba";
const material = () => ({
  p12: new SecretBytes(Buffer.from(P12)),
  password: new SecretText(PASSWORD),
});
const binding = { companyId: "empresa-a", certificateId: "cert-1" };

describe("custodia cifrada (design D5, ADR 0011)", () => {
  const vault = createCertificateVault(keyring("1", 7));

  it("ida y vuelta: sella y abre el P12 y la contraseña", () => {
    const sealed = vault.seal(material(), binding);
    expect(sealed).toMatchObject({ formatVersion: 1, keyVersion: "1" });
    const opened = vault.open(sealed, binding);
    expect(opened.p12.reveal().equals(P12)).toBe(true);
    expect(opened.password.reveal()).toBe(PASSWORD);
  });

  it("el secreto sellado no contiene el P12 ni la contraseña, y cada sello usa claves y nonces nuevos", () => {
    const a = vault.seal(material(), binding);
    const b = vault.seal(material(), binding);
    const stored = Buffer.concat([a.p12Ciphertext, a.passwordCiphertext, a.wrappedKey]);
    expect(stored.includes(P12.subarray(0, 32))).toBe(false);
    expect(stored.includes(Buffer.from(PASSWORD, "utf8"))).toBe(false);
    expect(a.p12Nonce.equals(b.p12Nonce)).toBe(false);
    expect(a.wrappedKey.equals(b.wrappedKey)).toBe(false);
  });

  it("falla con otra clave maestra de la misma versión, o sin la versión que lo envolvió", () => {
    const sealed = vault.seal(material(), binding);
    expect(() => createCertificateVault(keyring("1", 8)).open(sealed, binding)).toThrow(
      CustodyError,
    );
    expect(() => createCertificateVault(keyring("2", 7)).open(sealed, binding)).toThrow(
      CustodyError,
    );
  });

  it("falla con el AAD de otra empresa o de otro registro", () => {
    const sealed = vault.seal(material(), binding);
    expect(() => vault.open(sealed, { ...binding, companyId: "empresa-b" })).toThrow(CustodyError);
    expect(() => vault.open(sealed, { ...binding, certificateId: "cert-2" })).toThrow(CustodyError);
  });

  it("falla si se altera un byte de cualquier parte del secreto", () => {
    const sealed = vault.seal(material(), binding);
    for (const field of [
      "p12Ciphertext",
      "passwordCiphertext",
      "wrappedKey",
      "p12Nonce",
    ] as const) {
      const tampered = Buffer.from(sealed[field]);
      tampered[0] = tampered[0]! ^ 0xff;
      expect(() => vault.open({ ...sealed, [field]: tampered }, binding), field).toThrow(
        CustodyError,
      );
    }
  });

  it("canOpen comprueba la clave sin descifrar: ignora un texto cifrado dañado", () => {
    const sealed = vault.seal(material(), binding);
    const damaged = { ...sealed, p12Ciphertext: Buffer.alloc(sealed.p12Ciphertext.length) };
    expect(vault.canOpen(damaged)).toBe(true);
    expect(createCertificateVault(keyring("1", 8)).canOpen(sealed)).toBe(false);
    expect(createCertificateVault(keyring("2", 7)).canOpen(sealed)).toBe(false);
  });

  it("el material secreto no se revela al serializarlo ni al inspeccionarlo", () => {
    const secret = material();
    const printed = [
      JSON.stringify(secret),
      inspect(secret, { depth: 5 }),
      secret.p12.toString(),
      String(secret.password),
    ];
    for (const text of printed) {
      expect(text).not.toContain(PASSWORD);
      expect(text).not.toContain(P12.toString("utf8", 0, 20));
      expect(text).toContain("[secreto]");
    }
    secret.p12.wipe();
    expect(secret.p12.reveal().every((byte) => byte === 0)).toBe(true);
  });

  it("el error de custodia no lleva detalles del secreto", () => {
    const sealed = vault.seal(material(), binding);
    try {
      createCertificateVault(keyring("1", 8)).open(sealed, binding);
    } catch (error) {
      expect(String((error as Error).message)).not.toContain(PASSWORD);
      expect((error as Error).cause).toBeUndefined();
    }
  });

  it("abre un secreto sellado antes de mover el cifrado a platform/secrets (formato 1 intacto)", () => {
    // Sellado con la bóveda anterior (add-email-delivery, tarea 1.2): clave de prueba, sin secretos.
    const hex = (value: string) => Buffer.from(value, "hex");
    const golden = {
      formatVersion: 1,
      keyVersion: "1",
      keyCheck: hex("1f253e362d60fbf0e08631c6f4703cda6397b25a5b0bd39acbf947e9c906b9fa"),
      wrappedKey: hex(
        "1ce52f40f3c83f108bbbbd1a695a679e04306031cf9a120c231a2b2570290f708a26860a91fbf69b318205ba11b45672",
      ),
      wrappedKeyNonce: hex("dbdebba5f366fc0424edf2cd"),
      p12Ciphertext: hex("2013c4a183f3490ed7590a4b04df1134f9ae1f369899e25389a5"),
      p12Nonce: hex("15d730866b3e9665affc5382"),
      passwordCiphertext: hex("161cb8cc809bba4cbca1e21c2ac14f97091a49d92e4a14c7881f6021a04c8c"),
      passwordNonce: hex("f717e04428be0c828aaa5f0f"),
    };
    expect(vault.canOpen(golden)).toBe(true);
    const opened = vault.open(golden, binding);
    expect(opened.p12.reveal().toString()).toBe("p12-dorado");
    expect(opened.password.reveal()).toBe("clave-dorada-ñ");
  });
});
