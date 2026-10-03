// Contratos de terceros (add-parties-and-products, design D3, D4, D10 y D11). Los cuerpos son
// estrictos y rechazan `companyId`; la regla de formato de cada tipo de identificación es dato del
// catálogo fiscal y la aplica el backend, que conoce su versión vigente.
import { z } from "zod";
import {
  listMetaSchema,
  pageParams,
  recordStatusFilterSchema,
  recordStatusSchema,
  searchParam,
  sortDirectionSchema,
} from "./pagination.ts";
import { FISCAL_TEXT_MAX_LENGTH, fiscalText, optionalText, strictBody } from "./taxpayer.ts";

export const PARTY_ROLES = ["CUSTOMER", "SUPPLIER", "CARRIER"] as const;
export const partyRoleSchema = z.enum(PARTY_ROLES, { error: "El rol no es válido." });
export type PartyRole = z.infer<typeof partyRoleSchema>;
export const PARTY_ROLE_LABELS: Record<PartyRole, string> = {
  CUSTOMER: "Cliente",
  SUPPLIER: "Proveedor",
  CARRIER: "Transportista",
};

/** Registros del sistema que la empresa no edita (design D5). */
export const SYSTEM_RECORDS = ["CONSUMER_FINAL"] as const;
export const systemRecordSchema = z.enum(SYSTEM_RECORDS);
export type SystemRecord = z.infer<typeof systemRecordSchema>;

export const IDENTIFICATION_MAX_LENGTH = 20;
export const PARTY_ADDRESS_MAX_LENGTH = 300;
export const PARTY_EMAIL_MAX_LENGTH = 300;
export const PARTY_PHONE_MAX_LENGTH = 50;
const SINGLE_LINE = /^[^\r\n]*$/;

/** Código de dos dígitos del catálogo de tipos de identificación. */
export const identificationTypeSchema = z
  .string({ error: "El tipo de identificación es obligatorio." })
  .regex(/^[0-9]{2}$/, "El tipo de identificación no es válido.");

const identificationSchema = z
  .string({ error: "La identificación es obligatoria." })
  .normalize("NFC")
  .trim()
  .min(1, "La identificación es obligatoria.")
  .max(
    IDENTIFICATION_MAX_LENGTH,
    `La identificación debe tener como máximo ${IDENTIFICATION_MAX_LENGTH} caracteres.`,
  )
  .regex(SINGLE_LINE, "La identificación no puede tener saltos de línea.");

const addressSchema = z
  .string()
  .max(
    PARTY_ADDRESS_MAX_LENGTH,
    `La dirección debe tener como máximo ${PARTY_ADDRESS_MAX_LENGTH} caracteres.`,
  )
  .regex(SINGLE_LINE, "La dirección no puede tener saltos de línea.");
const emailSchema = z
  .email({ error: "El correo no tiene un formato válido." })
  .max(PARTY_EMAIL_MAX_LENGTH, "El correo no tiene un formato válido.");
const phoneSchema = z
  .string()
  .max(
    PARTY_PHONE_MAX_LENGTH,
    `El teléfono debe tener como máximo ${PARTY_PHONE_MAX_LENGTH} caracteres.`,
  )
  .regex(SINGLE_LINE, "El teléfono no puede tener saltos de línea.");

/** Roles sin duplicados y en orden canónico: el mismo conjunto siempre se guarda igual. */
const rolesSchema = z
  .array(partyRoleSchema, { error: "Los roles no son válidos." })
  .default([])
  .transform((roles) => PARTY_ROLES.filter((role) => roles.includes(role)));

export const partyShape = {
  identificationType: identificationTypeSchema,
  identification: identificationSchema,
  legalName: fiscalText(
    "La razón social",
    "La razón social es obligatoria.",
    FISCAL_TEXT_MAX_LENGTH,
  ),
  address: optionalText(addressSchema, "La dirección no es válida."),
  email: optionalText(emailSchema, "El correo no tiene un formato válido."),
  phone: optionalText(phoneSchema, "El teléfono no es válido."),
  roles: rolesSchema,
};

export const createPartySchema = strictBody(partyShape);
export type CreatePartyInput = z.input<typeof createPartySchema>;
export type PartyData = z.output<typeof createPartySchema>;

const expectedVersionSchema = z
  .number({ error: "La versión esperada es obligatoria." })
  .int("La versión esperada no es válida.")
  .min(1, "La versión esperada no es válida.");

export const updatePartySchema = strictBody({
  ...partyShape,
  expectedVersion: expectedVersionSchema,
});
export type UpdatePartyInput = z.input<typeof updatePartySchema>;

export const changePartyStatusSchema = strictBody({ status: recordStatusSchema });
export type ChangePartyStatusInput = z.infer<typeof changePartyStatusSchema>;

export const PARTY_SORTS = ["name", "identification"] as const;

/** Consulta de la lista: no es estricta, de modo que un `companyId` se ignora. */
export const listPartiesQuerySchema = z.object({
  search: searchParam,
  status: recordStatusFilterSchema,
  role: partyRoleSchema.optional(),
  sort: z.enum(PARTY_SORTS, { error: "El orden no es válido." }).default("name"),
  direction: sortDirectionSchema,
  ...pageParams,
});
export type ListPartiesQuery = z.output<typeof listPartiesQuerySchema>;

export const partyIdParamsSchema = z.strictObject({ partyId: z.string().min(1) });

export const partyViewSchema = z.strictObject({
  id: z.string(),
  identificationType: z.string(),
  /** Denominación oficial del tipo en el catálogo fiscal, si tiene versión vigente. */
  identificationTypeLabel: z.string().nullable(),
  identification: z.string(),
  legalName: z.string(),
  address: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  roles: z.array(partyRoleSchema),
  status: recordStatusSchema,
  systemRecord: systemRecordSchema.nullable(),
  version: z.number().int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type PartyView = z.infer<typeof partyViewSchema>;

export const partyListSchema = z.array(partyViewSchema);
export const partyListMetaSchema = listMetaSchema;
