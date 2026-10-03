// Puertos del módulo de terceros (add-parties-and-products, design D3, D4, D10 y D14).
import type { ListPartiesQuery, PartyData, RecordStatus } from "@facturador/contracts";
import type { AuditLog } from "../../audit/application/audit-log.ts";
import type { IdentificationRule, PartyRecord } from "../domain/party.ts";

/** Reglas de los tipos de identificación de `catalogs` (design D2), sin sesión. */
export type IdentificationRules = {
  identificationRule(code: string, date: string): Promise<IdentificationRule | null>;
};

export interface PartyRepository {
  find(companyId: string, partyId: string): Promise<PartyRecord | null>;
  findByIdentification(
    companyId: string,
    identificationType: string,
    identification: string,
  ): Promise<PartyRecord | null>;
  search(
    companyId: string,
    query: ListPartiesQuery,
  ): Promise<{ items: PartyRecord[]; total: number }>;
  /** Falla con DuplicateIdentificationError si la identificación ya existe en la empresa. */
  create(companyId: string, data: PartyData, userId: string): Promise<PartyRecord>;
  /** Solo si la versión coincide y no es un registro del sistema; devuelve si actualizó. */
  updateIfVersion(
    companyId: string,
    partyId: string,
    expectedVersion: number,
    data: PartyData,
    userId: string,
  ): Promise<boolean>;
  /** Solo si el estado cambia y no es un registro del sistema; devuelve si actualizó. */
  changeStatusIfDifferent(
    companyId: string,
    partyId: string,
    status: RecordStatus,
    userId: string,
  ): Promise<boolean>;
}

export interface PartiesUnitOfWork {
  run<T>(work: (scope: { parties: PartyRepository; audit: AuditLog }) => Promise<T>): Promise<T>;
}

export class DuplicateIdentificationError extends Error {
  constructor() {
    super("La identificación ya existe en la empresa.");
    this.name = "DuplicateIdentificationError";
  }
}
