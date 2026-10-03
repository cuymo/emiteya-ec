// Esquemas de la configuración tributaria de la empresa (add-taxpayer-setup, design D3, D6 y D9).
// Las restricciones de los campos del emisor salen de los XSD oficiales del SRI conservados en
// docs/product/sri-xsd/. Las escrituras son estrictas: rechazan `companyId`, `environment` en el
// perfil y cualquier campo desconocido. Los textos se normalizan (NFC y recorte) y un opcional
// vacío se guarda como `null`.
import { z } from "zod";
import { EMAIL_MAX_LENGTH } from "./users.ts";

/** Longitud máxima de razonSocial, nombreComercial, dirMatriz y dirEstablecimiento en el XSD. */
export const FISCAL_TEXT_MAX_LENGTH = 300;
export const PHONE_MAX_LENGTH = 30;

/** XSD `numeroRuc`. Sin dígito verificador: CTX §1.1 y §9.1 prohíben rechazar por un algoritmo local. */
export const RUC_PATTERN = /^[0-9]{10}001$/;
/** XSD `contribuyenteEspecial` (5 de los 6 tipos; la retención 2.0.0 admite de 3 a 5). */
export const SPECIAL_TAXPAYER_PATTERN = /^[A-Za-z0-9]{3,13}$/;
/** XSD `agenteRetencion`: número de la resolución, solo dígitos y hasta 8 (C-10). */
export const WITHHOLDING_RESOLUTION_PATTERN = /^[0-9]{1,8}$/;
const PHONE_PATTERN = /^(?=.*[0-9])[0-9+()\- ]+$/;
const SINGLE_LINE = /^[^\r\n]*$/;

export const ENVIRONMENTS = ["TEST", "PRODUCTION"] as const;
export const environmentSchema = z.enum(ENVIRONMENTS, { error: "El ambiente no es válido." });
export type Environment = z.infer<typeof environmentSchema>;

export const RIMPE_CATEGORIES = ["EMPRENDEDOR", "NEGOCIO_POPULAR"] as const;
export const rimpeCategorySchema = z.enum(RIMPE_CATEGORIES, {
  error: "La categoría RIMPE no es válida.",
});
export type RimpeCategory = z.infer<typeof rimpeCategorySchema>;

const strict = <T extends z.core.$ZodLooseShape>(shape: T) =>
  z.strictObject(shape, {
    error: (issue) =>
      issue.code === "unrecognized_keys"
        ? "La solicitud contiene campos no permitidos."
        : "La solicitud no es válida.",
  });

const normalized = (required: string) => z.string({ error: required }).normalize("NFC").trim();

/** Texto obligatorio de una línea con el máximo del XSD; `required` es el mensaje si falta. */
export function fiscalText(label: string, required: string, max = FISCAL_TEXT_MAX_LENGTH) {
  return normalized(required)
    .min(1, required)
    .max(max, `${label} debe tener como máximo ${max} caracteres.`)
    .regex(SINGLE_LINE, `${label} no puede tener saltos de línea.`);
}

/** Opcional: ausente, `null` o vacío se guardan como `null`; si tiene valor, se valida. */
function optional<T extends z.ZodType<string, string>>(schema: T, invalid: string) {
  return z
    .string({ error: invalid })
    .normalize("NFC")
    .trim()
    .nullish()
    .transform((value) => (value ? value : null))
    .pipe(schema.nullable());
}

export const rucSchema = normalized("El RUC es obligatorio.").regex(
  RUC_PATTERN,
  "El RUC debe tener 13 dígitos y terminar en 001.",
);

const providerRucSchema = z
  .string()
  .regex(RUC_PATTERN, "El RUC proveedor debe tener 13 dígitos y terminar en 001.");

const phoneSchema = z
  .string()
  .max(PHONE_MAX_LENGTH, `El teléfono debe tener como máximo ${PHONE_MAX_LENGTH} caracteres.`)
  .regex(PHONE_PATTERN, "El teléfono solo admite dígitos, espacios, +, -, ( y ).");

const companyEmailSchema = z
  .email({ error: "El correo no tiene un formato válido." })
  .max(EMAIL_MAX_LENGTH, "El correo no tiene un formato válido.");

const specialTaxpayerSchema = z
  .string()
  .regex(
    SPECIAL_TAXPAYER_PATTERN,
    "El número de contribuyente especial tiene de 3 a 13 letras o dígitos.",
  );

const withholdingResolutionSchema = z
  .string()
  .regex(
    WITHHOLDING_RESOLUTION_PATTERN,
    "El número de resolución de agente de retención tiene hasta 8 dígitos.",
  );

export const taxpayerProfileShape = {
  ruc: rucSchema,
  legalName: fiscalText("La razón social", "La razón social es obligatoria."),
  tradeName: optional(
    z
      .string()
      .max(
        FISCAL_TEXT_MAX_LENGTH,
        `El nombre comercial debe tener como máximo ${FISCAL_TEXT_MAX_LENGTH} caracteres.`,
      )
      .regex(SINGLE_LINE, "El nombre comercial no puede tener saltos de línea."),
    "El nombre comercial no es válido.",
  ),
  headOfficeAddress: fiscalText("La dirección matriz", "La dirección matriz es obligatoria."),
  phone: optional(phoneSchema, "El teléfono no es válido."),
  email: optional(companyEmailSchema, "El correo no tiene un formato válido."),
  // ERS RF-103: se declara, no se infiere; por eso no tiene valor por defecto.
  accountingRequired: z.boolean({
    error: "Indica si la empresa está obligada a llevar contabilidad.",
  }),
  specialTaxpayerNumber: optional(
    specialTaxpayerSchema,
    "El número de contribuyente especial no es válido.",
  ),
  withholdingAgentResolution: optional(
    withholdingResolutionSchema,
    "El número de resolución de agente de retención no es válido.",
  ),
  largeTaxpayer: z.boolean({ error: "Indica si la empresa es gran contribuyente." }).default(false),
  rimpeCategory: rimpeCategorySchema.nullish().transform((value) => value ?? null),
  // CTX §37.1 y Q-37: vacío por defecto; nunca un valor propio ni ficticio.
  providerRuc: optional(providerRucSchema, "El RUC proveedor no es válido."),
};

export const taxpayerProfileSchema = strict(taxpayerProfileShape);
export type TaxpayerProfile = z.output<typeof taxpayerProfileSchema>;
export type TaxpayerProfileInput = z.input<typeof taxpayerProfileSchema>;

const expectedVersionSchema = z
  .number({ error: "La versión esperada no es válida." })
  .int("La versión esperada no es válida.")
  .min(1, "La versión esperada no es válida.");

/** PUT /taxpayer: el perfil completo deseado y la versión de la que parte (`null` en el primer registro). */
export const updateTaxpayerSchema = strict({
  ...taxpayerProfileShape,
  expectedVersion: expectedVersionSchema.nullable(),
});
export type UpdateTaxpayerInput = z.input<typeof updateTaxpayerSchema>;

/** PUT /taxpayer/environment: solo con datos registrados, de modo que siempre hay versión. */
export const changeEnvironmentSchema = strict({
  environment: environmentSchema,
  expectedVersion: expectedVersionSchema,
});
export type ChangeEnvironmentInput = z.infer<typeof changeEnvironmentSchema>;

/** Tipos con que se puede enviar el logo; el formato real se reconoce por el contenido. */
export const LOGO_UPLOAD_CONTENT_TYPES = [
  "image/png",
  "image/jpeg",
  "application/octet-stream",
] as const;
export const LOGO_RESPONSE_CONTENT_TYPES = ["image/png", "image/jpeg"] as const;

/** Consulta de PUT y DELETE /taxpayer/logo, cuyo cuerpo es la imagen o está vacío. */
export const logoQuerySchema = z.object({
  expectedVersion: z.coerce
    .number({ error: "La versión esperada no es válida." })
    .int("La versión esperada no es válida.")
    .min(1, "La versión esperada no es válida."),
});

export const taxpayerProfileViewSchema = z.strictObject({
  ruc: z.string(),
  legalName: z.string(),
  tradeName: z.string().nullable(),
  headOfficeAddress: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  accountingRequired: z.boolean(),
  specialTaxpayerNumber: z.string().nullable(),
  withholdingAgentResolution: z.string().nullable(),
  largeTaxpayer: z.boolean(),
  rimpeCategory: rimpeCategorySchema.nullable(),
  providerRuc: z.string().nullable(),
});

export const logoMetadataSchema = z.strictObject({
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  sha256: z.string(),
});

/** GET /taxpayer: sin datos registrados, `configured: false`, ambiente TEST y sin bloqueo. */
export const taxpayerViewSchema = z.strictObject({
  configured: z.boolean(),
  version: z.number().int().nullable(),
  environment: environmentSchema,
  taxIdentityLocked: z.boolean(),
  profile: taxpayerProfileViewSchema.nullable(),
  logo: logoMetadataSchema.nullable(),
  logoMaxBytes: z.number().int(),
  updatedAt: z.iso.datetime().nullable(),
});
export type TaxpayerView = z.infer<typeof taxpayerViewSchema>;

export const READINESS_CHECKS = ["TAXPAYER_DATA", "EMISSION_POINT", "SIGNING_CERTIFICATE"] as const;
export const readinessCheckSchema = z.enum(READINESS_CHECKS);
export const readinessStatusSchema = z.enum(["MET", "PENDING"]);
export type ReadinessCheck = z.infer<typeof readinessCheckSchema>;
export type ReadinessStatus = z.infer<typeof readinessStatusSchema>;

/** GET /company/status: ambiente y preparación para emitir, para administradores y operadores. */
export const companyStatusSchema = z.strictObject({
  environment: environmentSchema,
  displayName: z.string().nullable(),
  readiness: z.strictObject({
    ready: z.boolean(),
    checks: z.array(z.strictObject({ key: readinessCheckSchema, status: readinessStatusSchema })),
  }),
});
export type CompanyStatus = z.infer<typeof companyStatusSchema>;

/** Ayudas de texto y de cuerpo estricto compartidas con terceros y productos (add-parties-and-products). */
export { optional as optionalText, strict as strictBody };
