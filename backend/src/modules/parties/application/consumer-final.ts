// Ciclo de vida del consumidor final (add-parties-and-products, design D5). Lo crea el iniciador de
// empresa en la misma transacción que la empresa, y el arranque repone los que falten antes de
// atender peticiones. La identidad sale solo de la política vigente; sin política, nada se crea.
import {
  consumerFinalRecord,
  type ConsumerFinalIdentity,
  type ConsumerFinalRecord,
} from "../domain/consumer-final.ts";

/** Lectura de la política de consumidor final de `catalogs` (design D2), sin sesión. */
export type ConsumerFinalPolicyReader = {
  consumerFinalPolicy(date: string): Promise<ConsumerFinalIdentity | null>;
};

export interface ConsumerFinalStore {
  /** Empresas, de las indicadas, que ya tienen su consumidor final. */
  companiesWithConsumerFinal(companyIds: readonly string[]): Promise<Set<string>>;
  /** Inserta los que falten; un conflicto de unicidad no es un error (arranques simultáneos). */
  insertMissing(companyIds: readonly string[], record: ConsumerFinalRecord): Promise<void>;
}

export class ConsumerFinalPolicyUnavailableError extends Error {
  constructor(date: string) {
    super(
      `No hay una política de consumidor final aplicable el ${date}; no se crea el consumidor final.`,
    );
    this.name = "ConsumerFinalPolicyUnavailableError";
  }
}

export class ConsumerFinalMissingError extends Error {
  readonly companyIds: readonly string[];

  constructor(companyIds: readonly string[]) {
    super(`Empresas sin consumidor final después de la reposición: ${companyIds.join(", ")}.`);
    this.name = "ConsumerFinalMissingError";
    this.companyIds = companyIds;
  }
}

/** Registro del consumidor final con la política aplicable en la fecha, o un error explícito. */
export async function consumerFinalFor(
  policies: ConsumerFinalPolicyReader,
  date: string,
): Promise<ConsumerFinalRecord> {
  const policy = await policies.consumerFinalPolicy(date);
  if (!policy) throw new ConsumerFinalPolicyUnavailableError(date);
  return consumerFinalRecord(policy);
}

/**
 * Repone el consumidor final de las empresas que no lo tienen (casos A y C de design D5). Es
 * idempotente y segura ante arranques simultáneos, y falla si al terminar queda alguna sin él.
 */
export async function ensureConsumerFinalParties({
  companyIds,
  store,
  policies,
  date,
}: {
  companyIds: readonly string[];
  store: ConsumerFinalStore;
  policies: ConsumerFinalPolicyReader;
  date: string;
}): Promise<{ created: number }> {
  const present = await store.companiesWithConsumerFinal(companyIds);
  const missing = companyIds.filter((id) => !present.has(id));
  if (missing.length > 0)
    await store.insertMissing(missing, await consumerFinalFor(policies, date));
  const after = await store.companiesWithConsumerFinal(companyIds);
  const stillMissing = companyIds.filter((id) => !after.has(id));
  if (stillMissing.length > 0) throw new ConsumerFinalMissingError(stillMissing);
  return { created: missing.length };
}
