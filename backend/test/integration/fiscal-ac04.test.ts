// ERS AC-04 y RNF-003 (design D5): 120 reservas simultáneas repartidas entre dos clientes de Prisma
// independientes, que simulan dos instancias con su propio pool, con la configuración de
// transacción por defecto de Prisma. Mide la duración total y la espera máxima de una reserva.
// Se ejecuta aislada del resto de la suite (backend/vitest.ac04.config.ts, docs/quality/testing.md).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { reserveSequentialIn } from "../../src/modules/fiscal/application/reservation.ts";
import { createSequentialReservation } from "../../src/modules/fiscal/application/reservation.ts";
import { createFiscalUnitOfWork } from "../../src/modules/fiscal/infrastructure/unit-of-work.ts";
import { createDatabase, type Database } from "../../src/platform/db/database.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import {
  insertFiscalCompany,
  key,
  reservationInput,
  type FiscalCompany,
} from "./fiscal-harness.ts";

const TOTAL = 120;

type Outcome = { sequential: number | null; ms: number; committed: boolean };

describe("ERS AC-04: reservas concurrentes", () => {
  let db: MigratedSchema;
  let instances: Database[];
  let company: FiscalCompany;
  const measurements: string[] = [];

  beforeAll(async () => {
    db = await createMigratedSchema("fiscal_ac_cuatro");
    company = await insertFiscalCompany(db.database.prisma, "Empresa A", 3);
    instances = [createDatabase(db.url), createDatabase(db.url)];
  });

  afterAll(async () => {
    console.log(`\nERS AC-04, configuración por defecto de Prisma:\n${measurements.join("\n")}`);
    await Promise.all(instances.map((instance) => instance.close()));
    await db.drop();
  });

  /** Lanza las reservas a la vez, alternando instancias, y mide cada una. */
  async function run(
    k: ReturnType<typeof key>,
    task: (index: number, instance: Database) => Promise<Omit<Outcome, "ms">>,
  ) {
    const started = performance.now();
    const outcomes = await Promise.all(
      Array.from({ length: TOTAL }, async (_, index) => {
        const begin = performance.now();
        const outcome = await task(index, instances[index % 2]!);
        return { ...outcome, ms: performance.now() - begin };
      }),
    );
    const total = performance.now() - started;
    const max = Math.max(...outcomes.map((outcome) => outcome.ms));
    return { outcomes, total, max, k };
  }

  async function expectConsecutive(k: ReturnType<typeof key>, committed: number[]) {
    const sorted = [...committed].sort((a, b) => a - b);
    expect(new Set(sorted).size).toBe(sorted.length);
    expect(sorted).toEqual(Array.from({ length: sorted.length }, (_, index) => index + 1));
    const counters = await db.database.prisma.fiscalSequence.findMany({ where: k });
    expect(counters).toHaveLength(1);
    expect(counters[0]).toMatchObject({
      nextNumber: sorted.length + 1,
      lastReserved: sorted.length,
    });
    expect(await db.database.prisma.fiscalSequenceReservation.count({ where: k })).toBe(
      sorted.length,
    );
  }

  const reserveWith = (instance: Database, k: ReturnType<typeof key>) =>
    createSequentialReservation(createFiscalUnitOfWork(instance.prisma)).reserve(
      reservationInput(k),
    );

  it("120 reservas sobre un contador que aún no existe crean un único contador y dan 1..120", async () => {
    const k = key(company, 0);
    const result = await run(k, async (_, instance) => ({
      sequential: (await reserveWith(instance, k)).sequential,
      committed: true,
    }));
    await expectConsecutive(
      k,
      result.outcomes.map((outcome) => outcome.sequential!),
    );
    measurements.push(
      `- contador nuevo: total ${result.total.toFixed(0)} ms, espera máxima de una reserva ${result.max.toFixed(0)} ms`,
    );
  });

  it("120 reservas sobre un contador existente dan 1..120", async () => {
    const k = key(company, 1);
    await db.database.prisma.fiscalSequence.create({ data: { ...k, nextNumber: 1 } });
    const result = await run(k, async (_, instance) => ({
      sequential: (await reserveWith(instance, k)).sequential,
      committed: true,
    }));
    await expectConsecutive(
      k,
      result.outcomes.map((outcome) => outcome.sequential!),
    );
    measurements.push(
      `- contador existente: total ${result.total.toFixed(0)} ms, espera máxima de una reserva ${result.max.toFixed(0)} ms`,
    );
  });

  it("con reversiones antes del commit y fallas después, los confirmados siguen sin duplicados", async () => {
    const k = key(company, 2);
    const result = await run(k, async (index, instance) => {
      if (index % 4 === 3) {
        // Se revierte antes del commit: el número no queda reservado.
        await expect(
          createFiscalUnitOfWork(instance.prisma).run(async (scope) => {
            await reserveSequentialIn(scope, reservationInput(k));
            throw new Error("falla antes de confirmar");
          }),
        ).rejects.toThrow("falla antes de confirmar");
        return { sequential: null, committed: false };
      }
      const reservation = await reserveWith(instance, k);
      // Una de cada cinco falla después de confirmar: el número queda consumido igual.
      return { sequential: reservation.sequential, committed: true };
    });
    const committed = result.outcomes
      .filter((outcome) => outcome.committed)
      .map((outcome) => outcome.sequential!);
    expect(committed).toHaveLength(90);
    await expectConsecutive(k, committed);
    measurements.push(
      `- con 30 reversiones: total ${result.total.toFixed(0)} ms, espera máxima ${result.max.toFixed(0)} ms`,
    );
  });
});
