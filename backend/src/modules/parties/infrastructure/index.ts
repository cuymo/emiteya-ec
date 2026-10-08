// Composición del módulo de terceros para main.ts y las pruebas (add-parties-and-products).
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import type { DbClient } from "../../../platform/db/database.ts";
import { escapeLike, searchKey } from "../../../platform/search/search-key.ts";
import { ecuadorDate } from "../../catalogs/infrastructure/index.ts";
import type { Authorizer } from "../../identity/application/authorization.ts";
import type { CompanyInitializer } from "../../identity/infrastructure/better-auth/index.ts";
import {
  consumerFinalFor,
  ensureConsumerFinalParties,
  type ConsumerFinalPolicyReader,
} from "../application/consumer-final.ts";
import { createParties } from "../application/parties.ts";
import type { IdentificationRules } from "../application/ports.ts";
import { partiesRouter } from "./http/parties-router.ts";
import { createConsumerFinalStore } from "./prisma-consumer-final.ts";
import { createPartyRepository } from "./prisma-parties.ts";
import { createPartiesUnitOfWork } from "./unit-of-work.ts";

/**
 * Iniciador de empresa: crea su consumidor final en la transacción que crea la empresa, con la
 * política vigente hoy en Ecuador (design D5, caso B). Sin política aplicable falla y la
 * transacción se revierte entera.
 */
export function consumerFinalInitializer({
  policies,
  now = () => new Date(),
}: {
  policies: ConsumerFinalPolicyReader;
  now?: () => Date;
}): CompanyInitializer {
  return async (tx, companyId) => {
    const record = await consumerFinalFor(policies, ecuadorDate(now()));
    await createConsumerFinalStore(tx).insert(companyId, record);
  };
}

/** Repone al arrancar el consumidor final que falte (design D5, casos A y C). */
export async function ensureConsumerFinals({
  db,
  policies,
  companyIds,
  now = () => new Date(),
}: {
  db: DbClient;
  policies: ConsumerFinalPolicyReader;
  companyIds: () => Promise<readonly string[]>;
  now?: () => Date;
}): Promise<{ created: number }> {
  return ensureConsumerFinalParties({
    companyIds: await companyIds(),
    store: createConsumerFinalStore(db),
    policies,
    date: ecuadorDate(now()),
  });
}

/** Lectura de un tercero de la empresa sobre un cliente, también en una transacción ajena (D1). */
export function partyReader(db: DbClient) {
  const parties = createPartyRepository(db);
  return { find: (companyId: string, partyId: string) => parties.find(companyId, partyId) };
}

/**
 * Proveedores de la empresa sobre un cliente, también en una transacción ajena: un tercero por
 * `(company_id, id)` con sus roles y su estado, y la búsqueda de los proveedores activos con los tipos
 * de identificación pedidos, por identificación o razón social, sin el consumidor final del sistema.
 * La usa el comprobante de retención (add-withholding-receipts, design D3), compuesta por `main.ts`.
 */
export function supplierReader(db: DbClient) {
  const view = (row: {
    id: string;
    status: string;
    identificationType: string;
    identification: string;
    legalName: string;
    roles: string[];
    systemRecord: string | null;
  }) => ({
    id: row.id,
    status: row.status,
    identificationType: row.identificationType,
    identification: row.identification,
    legalName: row.legalName,
    roles: row.roles,
    consumerFinal: row.systemRecord === "CONSUMER_FINAL",
  });
  return {
    async find(companyId: string, partyId: string) {
      const row = await db.party.findFirst({ where: { id: partyId, companyId } });
      return row ? view(row) : null;
    },
    async searchSuppliers(
      companyId: string,
      query: Readonly<{
        search?: string | undefined;
        identificationTypes: readonly string[];
        page: number;
        pageSize: number;
      }>,
    ) {
      const key = query.search ? escapeLike(searchKey(query.search)) : "";
      const where = {
        companyId,
        status: "ACTIVE",
        systemRecord: null,
        roles: { has: "SUPPLIER" },
        identificationType: { in: [...query.identificationTypes] },
        ...(key
          ? {
              OR: [
                { searchIdentification: { startsWith: key } },
                { searchName: { contains: key } },
              ],
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        db.party.findMany({
          where,
          orderBy: [{ searchName: "asc" }, { id: "asc" }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        db.party.count({ where }),
      ]);
      return { items: rows.map(view), total };
    },
  };
}

export type PartiesModuleOptions = {
  prisma: PrismaClient;
  authorizer: Authorizer;
  /** Reglas de identificación de `catalogs` (design D2). */
  rules: IdentificationRules;
  now?: () => Date;
};

export function partiesModule({
  prisma,
  authorizer,
  rules,
  now = () => new Date(),
}: PartiesModuleOptions) {
  const service = createParties({
    parties: createPartyRepository(prisma),
    uow: createPartiesUnitOfWork(prisma),
    rules,
    authorizer,
    today: () => ecuadorDate(now()),
  });
  return { routers: [partiesRouter(service)], service };
}

/**
 * Terceros para la guía de remisión (add-shipping-guides, design D3 y D7), sobre un cliente: la
 * lectura por identificador o por identidad tributaria con su dirección, los transportistas (activos,
 * con el rol `CARRIER`) y los destinatarios (activos, con cualquier rol), ambos de tipo 04, 05 o 06
 * y sin el consumidor final. La guía nunca asigna roles.
 */
export function shippingPartyReader(db: DbClient) {
  type Row = {
    id: string;
    status: string;
    identificationType: string;
    identification: string;
    legalName: string;
    address: string | null;
    roles: string[];
    systemRecord: string | null;
  };
  const view = (row: Row) => ({
    id: row.id,
    status: row.status,
    identificationType: row.identificationType,
    identification: row.identification,
    legalName: row.legalName,
    address: row.address,
    roles: row.roles,
    consumerFinal: row.systemRecord === "CONSUMER_FINAL",
  });
  const search = async (
    companyId: string,
    query: Readonly<{ search?: string | undefined; page: number; pageSize: number }>,
    carriers: boolean,
  ) => {
    const key = query.search ? escapeLike(searchKey(query.search)) : "";
    const where = {
      companyId,
      status: "ACTIVE",
      systemRecord: null,
      identificationType: { in: ["04", "05", "06"] },
      ...(carriers ? { roles: { has: "CARRIER" } } : {}),
      ...(key
        ? {
            OR: [{ searchIdentification: { startsWith: key } }, { searchName: { contains: key } }],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      db.party.findMany({
        where,
        orderBy: [{ searchName: "asc" }, { id: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      db.party.count({ where }),
    ]);
    return { items: rows.map(view), total };
  };
  return {
    async find(companyId: string, partyId: string) {
      const row = await db.party.findFirst({ where: { id: partyId, companyId } });
      return row ? view(row) : null;
    },
    async findByIdentity(companyId: string, identificationType: string, identification: string) {
      const row = await db.party.findFirst({
        where: { companyId, identificationType, identification },
      });
      return row ? view(row) : null;
    },
    searchCarriers: (
      companyId: string,
      query: Readonly<{ search?: string | undefined; page: number; pageSize: number }>,
    ) => search(companyId, query, true),
    searchRecipients: (
      companyId: string,
      query: Readonly<{ search?: string | undefined; page: number; pageSize: number }>,
    ) => search(companyId, query, false),
  };
}

/**
 * Proveedores para la liquidación de compra (add-purchase-settlements, design D4 y D21), sobre un
 * cliente: la lectura por identificador con su dirección y sus roles, y la búsqueda de los terceros
 * activos con el rol `SUPPLIER`, sin el consumidor final, con cualquier identificación (la
 * liquidación decide cuáles son seleccionables). La liquidación nunca asigna roles.
 */
export function purchaseSupplierReader(db: DbClient) {
  type Row = {
    id: string;
    status: string;
    identificationType: string;
    identification: string;
    legalName: string;
    address: string | null;
    roles: string[];
    systemRecord: string | null;
  };
  const view = (row: Row) => ({
    id: row.id,
    status: row.status,
    identificationType: row.identificationType,
    identification: row.identification,
    legalName: row.legalName,
    address: row.address,
    roles: row.roles,
    consumerFinal: row.systemRecord === "CONSUMER_FINAL",
  });
  return {
    async find(companyId: string, partyId: string) {
      const row = await db.party.findFirst({ where: { id: partyId, companyId } });
      return row ? view(row) : null;
    },
    async searchSuppliers(
      companyId: string,
      query: Readonly<{ search?: string | undefined; page: number; pageSize: number }>,
    ) {
      const key = query.search ? escapeLike(searchKey(query.search)) : "";
      const where = {
        companyId,
        status: "ACTIVE",
        systemRecord: null,
        roles: { has: "SUPPLIER" },
        ...(key
          ? {
              OR: [
                { searchIdentification: { startsWith: key } },
                { searchName: { contains: key } },
              ],
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        db.party.findMany({
          where,
          orderBy: [{ searchName: "asc" }, { id: "asc" }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        db.party.count({ where }),
      ]);
      return { items: rows.map(view), total };
    },
  };
}
