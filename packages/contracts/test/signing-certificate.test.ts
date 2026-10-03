import { describe, expect, it } from "vitest";
import {
  CERTIFICATE_MAX_BYTES_LIMIT,
  certificateValidityViewSchema,
  formatCertificateBytes,
  signingCertificateResponseSchema,
  expiryAlertSchema,
  signingCertificateViewSchema,
  uploadSigningCertificateSchema,
} from "../src/signing-certificate.ts";

const base64 = (bytes: number) => Buffer.alloc(bytes, 7).toString("base64");
const upload = (overrides: Record<string, unknown> = {}) => ({
  file: base64(3000),
  password: " Contraseña con espacios ",
  expectedCurrentId: null,
  ...overrides,
});

describe("carga de la firma (design D3)", () => {
  it("acepta el base64 y conserva la contraseña exacta, sin recortar ni normalizar", () => {
    const parsed = uploadSigningCertificateSchema.parse(upload({ password: " Café " }));
    expect(parsed.password).toBe(" Café ");
    expect(parsed.expectedCurrentId).toBeNull();
  });

  it("rechaza companyId y campos desconocidos", () => {
    expect(uploadSigningCertificateSchema.safeParse(upload({ companyId: "c" })).success).toBe(
      false,
    );
    expect(uploadSigningCertificateSchema.safeParse(upload({ extra: 1 })).success).toBe(false);
  });

  it("rechaza base64 inválido, vacío o por encima del tope absoluto", () => {
    for (const file of ["", "no es base64!", "abc", base64(CERTIFICATE_MAX_BYTES_LIMIT + 3)]) {
      expect(
        uploadSigningCertificateSchema.safeParse(upload({ file })).success,
        file.slice(0, 12),
      ).toBe(false);
    }
    expect(
      uploadSigningCertificateSchema.safeParse(
        upload({ file: base64(CERTIFICATE_MAX_BYTES_LIMIT) }),
      ).success,
    ).toBe(true);
  });

  it("exige una contraseña de 1 a 256 caracteres", () => {
    expect(uploadSigningCertificateSchema.safeParse(upload({ password: "" })).success).toBe(false);
    expect(
      uploadSigningCertificateSchema.safeParse(upload({ password: "x".repeat(257) })).success,
    ).toBe(false);
    expect(
      uploadSigningCertificateSchema.safeParse(upload({ password: "x".repeat(256) })).success,
    ).toBe(true);
  });
});

describe("anticipación del aviso (design D8)", () => {
  it("admite enteros de 1 a 90", () => {
    for (const days of [1, 30, 90])
      expect(expiryAlertSchema.safeParse({ days }).success).toBe(true);
    for (const days of [0, 91, 2.5, "30"])
      expect(expiryAlertSchema.safeParse({ days }).success).toBe(false);
    expect(expiryAlertSchema.safeParse({ days: 30, companyId: "c" }).success).toBe(false);
  });
});

describe("vistas sin secretos (design D9)", () => {
  const view = {
    id: "c1",
    subject: "CN=TITULAR",
    issuer: "CN=AC",
    serialNumber: "01",
    fingerprint: "ab",
    notBefore: "2026-01-01T00:00:00.000Z",
    notAfter: "2027-01-01T00:00:00.000Z",
    detectedRuc: "1790012345001",
    companyRuc: null,
    rucMatch: "PENDING",
    state: "VALID",
    usable: true,
    daysToExpiry: 90,
    uploadedAt: "2026-10-02T00:00:00.000Z",
  };

  it("la vista completa no admite campos secretos ni el estado NONE", () => {
    expect(signingCertificateViewSchema.safeParse(view).success).toBe(true);
    for (const secret of ["file", "password", "privateKey", "p12"]) {
      expect(signingCertificateViewSchema.safeParse({ ...view, [secret]: "x" }).success).toBe(
        false,
      );
    }
    expect(signingCertificateViewSchema.safeParse({ ...view, state: "NONE" }).success).toBe(false);
  });

  it("la vista de vigencia no lleva titular, emisor, serie ni RUC", () => {
    const validity = { state: "NONE", usable: false, notAfter: null, daysToExpiry: null };
    expect(certificateValidityViewSchema.safeParse(validity).success).toBe(true);
    expect(certificateValidityViewSchema.safeParse({ ...validity, subject: "x" }).success).toBe(
      false,
    );
    expect(certificateValidityViewSchema.safeParse({ ...validity, detectedRuc: "x" }).success).toBe(
      false,
    );
  });
});

describe("límite efectivo del archivo (design D3 y D9)", () => {
  it("la consulta publica el límite configurado, entero y positivo", () => {
    const response = { certificate: null, expiryAlertDays: 30, maxBytes: 131072 };
    expect(signingCertificateResponseSchema.parse(response).maxBytes).toBe(131072);
    for (const maxBytes of [undefined, 0, 1.5]) {
      expect(signingCertificateResponseSchema.safeParse({ ...response, maxBytes }).success).toBe(
        false,
      );
    }
  });

  it("formatea en KiB hacia abajo, igual para el backend y el selector de archivo", () => {
    expect(formatCertificateBytes(65536)).toBe("64 KiB");
    expect(formatCertificateBytes(65000)).toBe("63 KiB");
    expect(formatCertificateBytes(CERTIFICATE_MAX_BYTES_LIMIT)).toBe("1024 KiB");
    expect(formatCertificateBytes(500)).toBe("500 B");
  });
});
