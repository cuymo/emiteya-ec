// Configuración tributaria de la empresa (add-taxpayer-setup, design D2 y D3): el perfil que declara
// el administrador, el ambiente y el logo. Cada versión es completa e inmutable; aquí solo viven la
// comparación y la diferencia que deciden si hay versión nueva y qué registra la auditoría.

export const ENVIRONMENTS = ["TEST", "PRODUCTION"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

/** Sin versión registrada el ambiente es Pruebas (ERS RF-004, CTX §6). */
export const DEFAULT_ENVIRONMENT: Environment = "TEST";

export type RimpeCategory = "EMPRENDEDOR" | "NEGOCIO_POPULAR";

export type TaxpayerProfile = Readonly<{
  ruc: string;
  legalName: string;
  tradeName: string | null;
  headOfficeAddress: string;
  phone: string | null;
  email: string | null;
  accountingRequired: boolean;
  specialTaxpayerNumber: string | null;
  withholdingAgentResolution: string | null;
  largeTaxpayer: boolean;
  rimpeCategory: RimpeCategory | null;
  providerRuc: string | null;
}>;

export const PROFILE_FIELDS = [
  "ruc",
  "legalName",
  "tradeName",
  "headOfficeAddress",
  "phone",
  "email",
  "accountingRequired",
  "specialTaxpayerNumber",
  "withholdingAgentResolution",
  "largeTaxpayer",
  "rimpeCategory",
  "providerRuc",
] as const satisfies readonly (keyof TaxpayerProfile)[];

/** Metadatos del logo de una versión (ADR 0017); nunca los bytes. */
export type LogoRef = Readonly<{
  assetId: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}>;

export type TaxpayerConfig = Readonly<{
  profile: TaxpayerProfile;
  environment: Environment;
  logo: LogoRef | null;
}>;

export type ConfigChanges = Record<string, string | number | boolean | null>;

export function sameProfile(a: TaxpayerProfile, b: TaxpayerProfile): boolean {
  return PROFILE_FIELDS.every((field) => a[field] === b[field]);
}

/** El estado deseado es igual al vigente: no hay versión nueva ni evento (design D2). */
export function sameConfig(a: TaxpayerConfig, b: TaxpayerConfig): boolean {
  return (
    sameProfile(a.profile, b.profile) &&
    a.environment === b.environment &&
    (a.logo?.sha256 ?? null) === (b.logo?.sha256 ?? null)
  );
}

/**
 * Diferencia campo a campo para la auditoría (design D11): `<campo>.from` y `<campo>.to` solo de
 * los campos cambiados. En el primer registro no hay valores anteriores: solo `.to` de los
 * campos con valor.
 */
export function profileChanges(
  before: TaxpayerProfile | null,
  after: TaxpayerProfile,
): ConfigChanges {
  const changes: ConfigChanges = {};
  for (const field of PROFILE_FIELDS) {
    if (before === null) {
      if (after[field] !== null) changes[`${field}.to`] = after[field];
    } else if (before[field] !== after[field]) {
      changes[`${field}.from`] = before[field];
      changes[`${field}.to`] = after[field];
    }
  }
  return changes;
}

/** Logo anterior y nuevo por sus metadatos; la ausencia se registra como null. */
export function logoChanges(before: LogoRef | null, after: LogoRef | null): ConfigChanges {
  return {
    "logoSha256.from": before?.sha256 ?? null,
    "logoSha256.to": after?.sha256 ?? null,
    "logoMimeType.from": before?.mimeType ?? null,
    "logoMimeType.to": after?.mimeType ?? null,
    "logoSizeBytes.from": before?.sizeBytes ?? null,
    "logoSizeBytes.to": after?.sizeBytes ?? null,
  };
}
