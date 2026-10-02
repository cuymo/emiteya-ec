import { describe, expect, it } from "vitest";
import {
  changeEnvironmentSchema,
  changeEstablishmentStatusSchema,
  createEmissionPointSchema,
  createEstablishmentSchema,
  setDefaultEmissionPointSchema,
  taxpayerProfileSchema,
  updateEstablishmentSchema,
  updateTaxpayerSchema,
} from "@facturador/contracts";

const profile = {
  ruc: "1790012345001",
  legalName: "Comercial Andina S.A.",
  headOfficeAddress: "Av. Amazonas N24-03 y Colón, Quito",
  accountingRequired: true,
};

const messages = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((issue) => issue.message) ?? [];

const parseProfile = (overrides: Record<string, unknown>) =>
  taxpayerProfileSchema.safeParse({ ...profile, ...overrides });

describe("perfil tributario (design D3)", () => {
  it("acepta el mínimo obligatorio y deja los opcionales en null", () => {
    const result = taxpayerProfileSchema.parse(profile);
    expect(result).toEqual({
      ...profile,
      tradeName: null,
      phone: null,
      email: null,
      specialTaxpayerNumber: null,
      withholdingAgentResolution: null,
      largeTaxpayer: false,
      rimpeCategory: null,
      providerRuc: null,
    });
  });

  it("normaliza a NFC, recorta y guarda los opcionales vacíos como null", () => {
    const decomposed = "Café del Valle";
    const result = taxpayerProfileSchema.parse({
      ...profile,
      legalName: `  ${decomposed}  `,
      tradeName: "   ",
      email: "",
    });
    expect(result.legalName).toBe("Café del Valle");
    expect(result.legalName).toBe(result.legalName.normalize("NFC"));
    expect(result.tradeName).toBeNull();
    expect(result.email).toBeNull();
  });

  it("exige la razón social, la dirección matriz y el RUC, e indica el campo", () => {
    for (const [field, message] of [
      ["legalName", "La razón social es obligatoria."],
      ["headOfficeAddress", "La dirección matriz es obligatoria."],
      ["ruc", "El RUC es obligatorio."],
    ] as const) {
      const { [field]: _omitted, ...rest } = profile;
      expect(messages(taxpayerProfileSchema.safeParse(rest)), field).toContain(message);
      expect(messages(parseProfile({ [field]: "   " })), field).toContain(
        field === "ruc" ? "El RUC debe tener 13 dígitos y terminar en 001." : message,
      );
    }
  });

  it("exige declarar si la empresa está obligada a llevar contabilidad", () => {
    const { accountingRequired: _omitted, ...withoutAccounting } = profile;
    const result = taxpayerProfileSchema.safeParse(withoutAccounting);
    expect(messages(result)).toContain("Indica si la empresa está obligada a llevar contabilidad.");
  });

  it.each([
    ["12 dígitos", "179001234500"],
    ["letras", "17900123450A1"],
    ["sin 001", "1790012345002"],
  ])("rechaza un RUC con %s", (_case, ruc) => {
    expect(messages(parseProfile({ ruc }))).toContain(
      "El RUC debe tener 13 dígitos y terminar en 001.",
    );
  });

  it("acepta un RUC que cumple el patrón aunque falle un dígito verificador local", () => {
    // 123456789 + 0 falla el módulo 10 de la cédula (el verificador sería 7), y aun así es válido.
    expect(parseProfile({ ruc: "1234567890001" }).success).toBe(true);
  });

  it("acepta 300 caracteres y rechaza 301", () => {
    expect(parseProfile({ legalName: "a".repeat(300) }).success).toBe(true);
    expect(messages(parseProfile({ legalName: "a".repeat(301) }))).toContain(
      "La razón social debe tener como máximo 300 caracteres.",
    );
    expect(messages(parseProfile({ tradeName: "a".repeat(301) }))).toContain(
      "El nombre comercial debe tener como máximo 300 caracteres.",
    );
  });

  it.each(["\n", "\r"])("rechaza un salto de línea (%j)", (breakChar) => {
    expect(messages(parseProfile({ headOfficeAddress: `Calle 1${breakChar}Quito` }))).toContain(
      "La dirección matriz no puede tener saltos de línea.",
    );
  });

  it("valida el número de contribuyente especial de 3 a 13 caracteres alfanuméricos", () => {
    const invalid = "El número de contribuyente especial tiene de 3 a 13 letras o dígitos.";
    expect(messages(parseProfile({ specialTaxpayerNumber: "12" }))).toContain(invalid);
    expect(parseProfile({ specialTaxpayerNumber: "123" }).success).toBe(true);
    expect(parseProfile({ specialTaxpayerNumber: "ABC1234567890" }).success).toBe(true);
    expect(messages(parseProfile({ specialTaxpayerNumber: "A".repeat(14) }))).toContain(invalid);
    expect(messages(parseProfile({ specialTaxpayerNumber: "12-34" }))).toContain(invalid);
  });

  it("valida la resolución de agente de retención como hasta 8 dígitos", () => {
    const invalid = "El número de resolución de agente de retención tiene hasta 8 dígitos.";
    expect(parseProfile({ withholdingAgentResolution: "12345678" }).success).toBe(true);
    expect(messages(parseProfile({ withholdingAgentResolution: "123456789" }))).toContain(invalid);
    expect(messages(parseProfile({ withholdingAgentResolution: "NAC-1" }))).toContain(invalid);
    expect(parseProfile({ withholdingAgentResolution: true }).success).toBe(false);
  });

  it("valida el RUC proveedor con el formato del RUC y lo deja vacío por defecto", () => {
    expect(taxpayerProfileSchema.parse(profile).providerRuc).toBeNull();
    expect(parseProfile({ providerRuc: "0990012345001" }).success).toBe(true);
    expect(messages(parseProfile({ providerRuc: "0990012345" }))).toContain(
      "El RUC proveedor debe tener 13 dígitos y terminar en 001.",
    );
  });

  it("valida el teléfono y el correo", () => {
    expect(parseProfile({ phone: "+593 (2) 255-1234" }).success).toBe(true);
    expect(messages(parseProfile({ phone: "llamar luego" }))).toContain(
      "El teléfono solo admite dígitos, espacios, +, -, ( y ).",
    );
    expect(messages(parseProfile({ phone: "1".repeat(31) }))).toContain(
      "El teléfono debe tener como máximo 30 caracteres.",
    );
    expect(parseProfile({ email: "facturacion@andina.ec" }).success).toBe(true);
    expect(messages(parseProfile({ email: "facturacion@" }))).toContain(
      "El correo no tiene un formato válido.",
    );
  });

  it("admite solo las categorías RIMPE declaradas", () => {
    expect(parseProfile({ rimpeCategory: "NEGOCIO_POPULAR" }).success).toBe(true);
    expect(parseProfile({ rimpeCategory: "GENERAL" }).success).toBe(false);
  });
});

describe("escrituras de configuración", () => {
  it("rechazan companyId y el ambiente dentro del perfil", () => {
    for (const extra of [{ companyId: "otra" }, { environment: "PRODUCTION" }]) {
      const result = updateTaxpayerSchema.safeParse({ ...profile, expectedVersion: 1, ...extra });
      expect(messages(result)).toContain("La solicitud contiene campos no permitidos.");
    }
  });

  it("exigen la versión esperada, nula solo en el primer registro", () => {
    expect(updateTaxpayerSchema.safeParse({ ...profile, expectedVersion: null }).success).toBe(
      true,
    );
    expect(updateTaxpayerSchema.safeParse(profile).success).toBe(false);
    expect(changeEnvironmentSchema.safeParse({ environment: "PRODUCTION" }).success).toBe(false);
    expect(
      changeEnvironmentSchema.safeParse({ environment: "PRODUCTION", expectedVersion: null })
        .success,
    ).toBe(false);
    expect(
      changeEnvironmentSchema.safeParse({ environment: "PRODUCTION", expectedVersion: 3 }).success,
    ).toBe(true);
  });
});

describe("establecimientos y puntos (design D7)", () => {
  it.each(["1", "0001", "A01", ""])("rechaza el código %j", (code) => {
    expect(messages(createEstablishmentSchema.safeParse({ code, address: "Quito" }))).toContain(
      "El código debe tener exactamente tres dígitos.",
    );
    expect(messages(createEmissionPointSchema.safeParse({ code }))).toContain(
      "El código debe tener exactamente tres dígitos.",
    );
  });

  it("acepta el código 001 con su dirección", () => {
    expect(createEstablishmentSchema.safeParse({ code: "001", address: "Quito" }).success).toBe(
      true,
    );
    expect(createEmissionPointSchema.safeParse({ code: "001" }).success).toBe(true);
  });

  it("no acepta el código ni companyId en las ediciones", () => {
    for (const extra of [{ code: "002" }, { companyId: "otra" }]) {
      expect(
        messages(updateEstablishmentSchema.safeParse({ address: "Guayaquil", ...extra })),
      ).toContain("La solicitud contiene campos no permitidos.");
      expect(
        messages(changeEstablishmentStatusSchema.safeParse({ status: "INACTIVE", ...extra })),
      ).toContain("La solicitud contiene campos no permitidos.");
    }
  });

  it("exige la dirección del establecimiento, de una línea y hasta 300 caracteres", () => {
    expect(messages(createEstablishmentSchema.safeParse({ code: "001", address: " " }))).toContain(
      "La dirección del establecimiento es obligatoria.",
    );
    expect(
      messages(createEstablishmentSchema.safeParse({ code: "001", address: "a".repeat(301) })),
    ).toContain("La dirección del establecimiento debe tener como máximo 300 caracteres.");
  });

  it("acepta quitar el predeterminado con null", () => {
    expect(setDefaultEmissionPointSchema.safeParse({ emissionPointId: null }).success).toBe(true);
    expect(setDefaultEmissionPointSchema.safeParse({}).success).toBe(false);
  });
});
