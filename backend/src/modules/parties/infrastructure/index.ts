// Composición del módulo de terceros para main.ts y las pruebas (add-parties-and-products).
import type { DbClient } from "../../../platform/db/database.ts";
import { ecuadorDate } from "../../catalogs/infrastructure/index.ts";
import type { CompanyInitializer } from "../../identity/infrastructure/better-auth/index.ts";
import {
  consumerFinalFor,
  ensureConsumerFinalParties,
  type ConsumerFinalPolicyReader,
} from "../application/consumer-final.ts";
import { createConsumerFinalStore } from "./prisma-consumer-final.ts";

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
