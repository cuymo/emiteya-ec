// Composición del módulo de terceros para main.ts y las pruebas (add-parties-and-products).
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import type { DbClient } from "../../../platform/db/database.ts";
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
