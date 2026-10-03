// Lector de PKCS#12 con node-forge y registro de extractores de RUC (design D3 y D4, ADR 0019).
import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, inject, it } from "vitest";
import {
  CertificateInspectionError,
  inspectPkcs12,
} from "../../src/modules/signing/infrastructure/pkcs12/pkcs12-reader.ts";
import {
  FIXTURE_NONASCII_PASSWORD,
  FIXTURE_OTHER_RUC,
  FIXTURE_PASSWORD,
  FIXTURE_RUC,
  readFixture,
} from "../support/p12-fixtures.ts";

const dir = inject("p12FixturesDir");
const inspect = (file: string, password = FIXTURE_PASSWORD) =>
  inspectPkcs12(readFixture(dir, file), password);
const codeOf = (file: string, password = FIXTURE_PASSWORD) => {
  try {
    inspect(file, password);
    return null;
  } catch (error) {
    expect(String((error as Error).message)).not.toContain(password);
    return error instanceof CertificateInspectionError ? error.code : `otro: ${String(error)}`;
  }
};
const fingerprintOf = (name: string) =>
  new X509Certificate(readFileSync(join(dir, `${name}.crt`))).fingerprint256
    .replaceAll(":", "")
    .toLowerCase();

describe("lector de PKCS#12 (design D3)", () => {
  it("abre un P12 moderno y extrae metadatos, clave y RUC", () => {
    const certificate = inspect("sd-utf8.modern.p12");
    expect(certificate).toMatchObject({
      keyAlgorithm: "RSA",
      keyBits: 2048,
      chainLength: 2,
      detectedRuc: FIXTURE_RUC,
      rucExtractor: "extension-oid:1.3.6.1.4.1.37746.3.11",
      fingerprint: fingerprintOf("sd-utf8"),
    });
    expect(certificate.subject).toContain("CN=TITULAR DE PRUEBA sd-utf8");
    expect(certificate.issuer).toContain("CN=AC Pruebas");
    expect(new Date(certificate.notAfter).getTime()).toBeGreaterThan(Date.now());
  });

  it("abre los formatos legados (RC2-40 y 3DES) y solo 3DES", () => {
    for (const file of ["sd-utf8.legacy.p12", "sd-utf8.3des.p12"]) {
      expect(inspect(file).fingerprint, file).toBe(fingerprintOf("sd-utf8"));
    }
  });

  it("una contraseña no ASCII funciona en el formato legado y es INCOMPATIBLE en el moderno (PBES2)", () => {
    expect(inspect("sd-utf8.legacy.nonascii.p12", FIXTURE_NONASCII_PASSWORD).detectedRuc).toBe(
      FIXTURE_RUC,
    );
    expect(codeOf("sd-utf8.modern.nonascii.p12", FIXTURE_NONASCII_PASSWORD)).toBe(
      "CERTIFICATE_INCOMPATIBLE",
    );
  });

  it("distingue una contraseña incorrecta de un archivo ilegible", () => {
    expect(codeOf("sd-utf8.modern.p12", "otra-clave-incorrecta")).toBe(
      "CERTIFICATE_PASSWORD_INVALID",
    );
    expect(codeOf("sd-utf8.legacy.p12", "otra-clave-incorrecta")).toBe(
      "CERTIFICATE_PASSWORD_INVALID",
    );
    expect(codeOf("corrupt-truncated.p12")).toBe("CERTIFICATE_UNREADABLE");
    expect(codeOf("corrupt-random.p12")).toBe("CERTIFICATE_UNREADABLE");
  });

  it("rechaza más de 100 000 iteraciones antes de descifrar", () => {
    expect(codeOf("sd-utf8.iter150000.p12")).toBe("CERTIFICATE_INCOMPATIBLE");
  });

  it("exige una clave RSA de 2048 bits o más que corresponda a un certificado", () => {
    expect(inspect("rsa4096.modern.p12").keyBits).toBe(4096);
    for (const file of ["rsa1024.modern.p12", "ec.modern.p12", "mismatch.p12", "nokey.p12"]) {
      expect(codeOf(file), file).toBe("CERTIFICATE_KEY_UNSUPPORTED");
    }
  });

  it("exige que el certificado del titular sea el primero, el que embebe el firmador", () => {
    expect(codeOf("ca-first.p12")).toBe("CERTIFICATE_INCOMPATIBLE");
  });

  it("devuelve las fechas de vigencia sin decidir: la carga compara con el reloj del servidor", () => {
    expect(inspect("expired.modern.p12").notAfter).toBe("2024-01-01T00:00:00.000Z");
    expect(inspect("future.modern.p12").notBefore).toBe("2030-01-01T00:00:00.000Z");
  });
});

describe("registro de extractores de RUC (design D4)", () => {
  it("lee el OID de Security Data en UTF8String, PrintableString e IA5String", () => {
    for (const file of ["sd-utf8.modern.p12", "sd-printable.modern.p12", "sd-ia5.modern.p12"]) {
      expect(inspect(file).detectedRuc, file).toBe(FIXTURE_RUC);
    }
    expect(inspect("other-ruc.modern.p12").detectedRuc).toBe(FIXTURE_OTHER_RUC);
  });

  it("sin un valor fiable no hay RUC: ausente, inválido o mezclado con texto", () => {
    for (const file of ["noruc.modern.p12", "badruc.modern.p12", "textruc.modern.p12"]) {
      expect(inspect(file), file).toMatchObject({ detectedRuc: null, rucExtractor: null });
    }
  });
});
