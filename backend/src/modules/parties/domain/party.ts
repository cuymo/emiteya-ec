// Tercero de una empresa (add-parties-and-products, design D3, D4 y D13): reglas puras de su
// identificación, sus claves de búsqueda y los cambios que se auditan.
import type { PartyData, PartyRole, RecordStatus, SystemRecord } from "@facturador/contracts";
import { searchKey } from "../../../platform/search/search-key.ts";

export type PartyRecord = {
  id: string;
  companyId: string;
  identificationType: string;
  identification: string;
  legalName: string;
  address: string | null;
  email: string | null;
  phone: string | null;
  roles: PartyRole[];
  status: RecordStatus;
  systemRecord: SystemRecord | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

/** Regla de formato de un tipo de identificación, tal como la publica el catálogo fiscal. */
export type IdentificationRule = {
  code: string;
  officialLabel: string;
  pattern: string | null;
  description: string;
  reservedFor: "CONSUMER_FINAL" | null;
};

export type IdentificationProblem =
  | { kind: "TYPE_UNAVAILABLE" }
  | { kind: "RESERVED" }
  | { kind: "INVALID"; rule: IdentificationRule };

/** Valida con la regla vigente; nunca con un algoritmo de dígito verificador (ERS RF-322). */
export function identificationProblem(
  rule: IdentificationRule | null,
  identification: string,
): IdentificationProblem | null {
  if (!rule) return { kind: "TYPE_UNAVAILABLE" };
  if (rule.reservedFor) return { kind: "RESERVED" };
  if (rule.pattern !== null && !new RegExp(rule.pattern).test(identification)) {
    return { kind: "INVALID", rule };
  }
  return null;
}

export function partySearchKeys(data: Pick<PartyData, "legalName" | "identification">) {
  return {
    searchName: searchKey(data.legalName),
    searchIdentification: searchKey(data.identification),
  };
}

const CONTACT_FIELDS = ["address", "email", "phone"] as const;

/**
 * Cambios auditables de una corrección (design D13): valor anterior y nuevo de la identidad, la
 * razón social y los roles; de los datos de contacto, solo qué campos cambiaron, sin sus valores.
 * null si la corrección no cambia nada.
 */
export function partyChanges(
  before: PartyRecord,
  after: PartyData,
): Record<string, string | readonly string[]> | null {
  const changes: Record<string, string | readonly string[]> = {};
  for (const field of ["identificationType", "identification", "legalName"] as const) {
    if (before[field] !== after[field]) {
      changes[`${field}.from`] = before[field];
      changes[`${field}.to`] = after[field];
    }
  }
  if (before.roles.join(",") !== after.roles.join(",")) {
    changes["roles.from"] = before.roles;
    changes["roles.to"] = after.roles;
  }
  const changedFields = CONTACT_FIELDS.filter((field) => before[field] !== after[field]);
  if (changedFields.length > 0) changes.changedFields = changedFields;
  return Object.keys(changes).length > 0 ? changes : null;
}
