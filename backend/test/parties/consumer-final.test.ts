// Reposición del consumidor final con un almacén falso (add-parties-and-products, design D5): solo
// pide la política si falta alguno, y falla si al terminar queda una empresa sin él.
import { describe, expect, it } from "vitest";
import {
  ConsumerFinalMissingError,
  ConsumerFinalPolicyUnavailableError,
  ensureConsumerFinalParties,
  type ConsumerFinalStore,
} from "../../src/modules/parties/application/consumer-final.ts";

const policy = {
  identificationType: "07",
  identification: "9999999999999",
  canonicalName: "CONSUMIDOR FINAL",
};
const policies = (value: typeof policy | null = policy) => ({
  consumerFinalPolicy: () => Promise.resolve(value),
});

function store(
  present: string[],
  { inserts = true } = {},
): ConsumerFinalStore & { inserted: string[] } {
  const have = new Set(present);
  const inserted: string[] = [];
  return {
    inserted,
    companiesWithConsumerFinal: (ids) => Promise.resolve(new Set(ids.filter((id) => have.has(id)))),
    insertMissing: (ids, record) => {
      expect(record).toMatchObject({
        systemRecord: "CONSUMER_FINAL",
        legalName: "CONSUMIDOR FINAL",
      });
      inserted.push(...ids);
      if (inserts) for (const id of ids) have.add(id);
      return Promise.resolve();
    },
  };
}

describe("ensureConsumerFinalParties", () => {
  it("crea solo los que faltan", async () => {
    const s = store(["a"]);
    const result = await ensureConsumerFinalParties({
      companyIds: ["a", "b"],
      store: s,
      policies: policies(),
      date: "2026-10-03",
    });
    expect(result).toEqual({ created: 1 });
    expect(s.inserted).toEqual(["b"]);
  });

  it("sin faltantes no pide la política ni inserta", async () => {
    const s = store(["a"]);
    const result = await ensureConsumerFinalParties({
      companyIds: ["a"],
      store: s,
      policies: policies(null),
      date: "2026-10-03",
    });
    expect(result).toEqual({ created: 0 });
    expect(s.inserted).toEqual([]);
  });

  it("con faltantes y sin política falla de forma explícita", async () => {
    await expect(
      ensureConsumerFinalParties({
        companyIds: ["a"],
        store: store([]),
        policies: policies(null),
        date: "2026-07-01",
      }),
    ).rejects.toBeInstanceOf(ConsumerFinalPolicyUnavailableError);
  });

  it("falla si después de reponer queda una empresa sin consumidor final", async () => {
    await expect(
      ensureConsumerFinalParties({
        companyIds: ["a", "b"],
        store: store([], { inserts: false }),
        policies: policies(),
        date: "2026-10-03",
      }),
    ).rejects.toBeInstanceOf(ConsumerFinalMissingError);
  });
});
