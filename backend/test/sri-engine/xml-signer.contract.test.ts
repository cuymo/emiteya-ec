// Contrato del adaptador XmlSigner sobre EcSriSigner (ADR 0018, design D16): debe pasar antes de
// aceptar cualquier actualización de facturacion-electronica-ec o de ec-sri-invoice-signer.
import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, inject, it } from "vitest";
import { XmlSignerError } from "../../src/modules/sri-engine/application/ports.ts";
import { createXmlSigner } from "../../src/modules/sri-engine/infrastructure/ec-sri-signer.ts";
import {
  readEnvelopedSignature,
  verifyEnvelopedSignature,
} from "../../src/modules/sri-engine/infrastructure/signature-inspection.ts";
import {
  FIXTURE_NONASCII_PASSWORD,
  FIXTURE_PASSWORD,
  readFixture,
} from "../support/p12-fixtures.ts";

const dir = inject("p12FixturesDir");
const signer = createXmlSigner();
const certificate = (name: string) => new X509Certificate(readFileSync(join(dir, `${name}.crt`)));
const sign = (file: string, password = FIXTURE_PASSWORD) =>
  signer.sign({
    xml: signer.testDocument(),
    documentType: "01",
    p12: readFixture(dir, file),
    password,
  });
const codeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) => (error instanceof XmlSignerError ? error.code : `otro: ${String(error)}`),
  );

describe("contrato de XmlSigner sobre EcSriSigner (ADR 0018)", () => {
  for (const [file, holder, password] of [
    ["sd-utf8.modern.p12", "sd-utf8", FIXTURE_PASSWORD],
    ["sd-utf8.legacy.p12", "sd-utf8", FIXTURE_PASSWORD],
    ["sd-utf8.3des.p12", "sd-utf8", FIXTURE_PASSWORD],
    ["sd-utf8.legacy.nonascii.p12", "sd-utf8", FIXTURE_NONASCII_PASSWORD],
    ["rsa4096.modern.p12", "rsa4096", FIXTURE_PASSWORD],
  ] as const) {
    it(`firma con ${file}: XAdES-BES rsa-sha1 verificable y con el certificado del titular`, async () => {
      const signed = await sign(file, password);
      expect(signed).toContain("SignedProperties");
      expect(signed).toContain("<ds:KeyInfo");
      const signature = readEnvelopedSignature(signed);
      expect(signature.algorithm).toBe("http://www.w3.org/2000/09/xmldsig#rsa-sha1");
      expect(signature.certificate.fingerprint256).toBe(certificate(holder).fingerprint256);
      expect(
        verifyEnvelopedSignature(
          signature,
          certificate(holder).publicKey.export({ type: "spki", format: "pem" }) as string,
        ),
      ).toBe(true);
    });
  }

  it("una contraseña incorrecta es PASSWORD_INVALID y el error no la contiene", async () => {
    const error = await sign("sd-utf8.modern.p12", "contraseña-incorrecta-secreta").catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(XmlSignerError);
    expect((error as XmlSignerError).code).toBe("PASSWORD_INVALID");
    expect(String((error as Error).message)).not.toContain("contraseña-incorrecta-secreta");
    expect((error as Error).cause).toBeUndefined();
  });

  it("clasifica los P12 que no puede usar", async () => {
    // PBES2 con contraseña no ASCII: node-forge no lo descifra. Según los bytes basura falla el
    // relleno o el ASN.1; el lector, que va antes, lo clasifica siempre como INCOMPATIBLE.
    expect(["INCOMPATIBLE", "UNREADABLE"]).toContain(
      await codeOf(sign("sd-utf8.modern.nonascii.p12", FIXTURE_NONASCII_PASSWORD)),
    );
    expect(await codeOf(sign("ec.modern.p12"))).toBe("INCOMPATIBLE");
    expect(await codeOf(sign("nokey.p12"))).toBe("INCOMPATIBLE");
    expect(await codeOf(sign("corrupt-truncated.p12"))).toBe("UNREADABLE");
    // Bytes aleatorios: el lector los clasifica antes; el firmador nunca filtra el mensaje.
    expect(["UNREADABLE", "SIGNER_FAILED"]).toContain(await codeOf(sign("corrupt-random.p12")));
  });

  it("con la cadena de la CA primero embebe el certificado de la CA: lo detecta la comparación con el inspeccionado", async () => {
    const signature = readEnvelopedSignature(await sign("ca-first.p12"));
    expect(signature.certificate.fingerprint256).toBe(certificate("ca").fingerprint256);
    expect(signature.certificate.fingerprint256).not.toBe(certificate("sd-utf8").fingerprint256);
  });

  it("con una clave que no corresponde, la firma no verifica con el certificado embebido", async () => {
    const signature = readEnvelopedSignature(await sign("mismatch.p12"));
    const embeddedKey = signature.certificate.publicKey.export({
      type: "spki",
      format: "pem",
    }) as string;
    expect(verifyEnvelopedSignature(signature, embeddedKey)).toBe(false);
  });
});
