// Carreras de la numeración (design D3 y D4): creación perezosa concurrente con un ajuste (B),
// reserva y ajuste sobre un contador existente (C) y desactivación del punto durante una reserva.
// Los órdenes se fijan reteniendo una transacción antes de confirmar; además se repiten ejecuciones
// simultáneas. Ningún error de restricción llega al dominio.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import {
  adjustParams,
  adminContext,
  deferred,
  fiscalServices,
  holdingUow,
  insertFiscalCompany,
  key,
  reservationInput,
  stillPending,
  type FiscalCompany,
} from "./fiscal-harness.ts";

const DOMAIN_CODES = new Set(["SEQUENCE_CHANGED"]);

describe("carreras de la numeración", () => {
  let db: MigratedSchema;
  let company: FiscalCompany;

  const counterRows = (k: ReturnType<typeof key>) =>
    db.database.prisma.fiscalSequence.findMany({ where: k });
  const reservedOf = async (k: ReturnType<typeof key>) =>
    (
      await db.database.prisma.fiscalSequenceReservation.findMany({
        where: k,
        orderBy: { sequential: "asc" },
      })
    ).map((row) => row.sequential);

  /** Invariantes que toda carrera debe dejar intactas. */
  async function expectCoherent(k: ReturnType<typeof key>) {
    const rows = await counterRows(k);
    expect(rows).toHaveLength(1);
    const reserved = await reservedOf(k);
    expect(new Set(reserved).size).toBe(reserved.length);
    expect(rows[0]!.nextNumber).toBeGreaterThan(rows[0]!.lastReserved ?? 0);
    expect(rows[0]!.lastReserved).toBe(reserved.at(-1) ?? null);
  }

  beforeAll(async () => {
    db = await createMigratedSchema("fiscal_races");
    company = await insertFiscalCompany(db.database.prisma, "Empresa A", 4);
  });

  afterAll(async () => {
    await db.drop();
  });

  describe("B: primera reserva y primer ajuste sobre una clave sin contador", () => {
    it("si la reserva confirma antes, recibe el 1 y el ajuste se rechaza con conflicto", async () => {
      const k = key(company, 0, "01");
      const reached = deferred();
      const release = deferred();
      const held = fiscalServices(db.database.prisma, {
        wrap: (uow) => holdingUow(uow, reached, release),
      });
      const reservation = held.reservation.reserve(reservationInput(k));
      await reached.promise;
      const adjustment = fiscalServices(db.database.prisma).administration.adjust(
        adminContext(company),
        adjustParams(k),
        { nextNumber: 1501, expectedNextNumber: 1 },
      );
      expect(await stillPending(adjustment)).toBe(true);
      release.resolve();
      expect((await reservation).sequential).toBe(1);
      await expect(adjustment).rejects.toMatchObject({ code: "SEQUENCE_CHANGED", status: 409 });
      await expectCoherent(k);
    });

    it("si el ajuste confirma antes, la reserva recibe el valor ajustado", async () => {
      const k = key(company, 0, "03");
      const reached = deferred();
      const release = deferred();
      const held = fiscalServices(db.database.prisma, {
        wrap: (uow) => holdingUow(uow, reached, release),
      });
      const adjustment = held.administration.adjust(adminContext(company), adjustParams(k), {
        nextNumber: 1501,
        expectedNextNumber: 1,
      });
      await reached.promise;
      const reservation = fiscalServices(db.database.prisma).reservation.reserve(
        reservationInput(k),
      );
      expect(await stillPending(reservation)).toBe(true);
      release.resolve();
      await adjustment;
      expect((await reservation).sequential).toBe(1501);
      await expectCoherent(k);
    });

    it("ejecuciones simultáneas repetidas sobre claves nuevas solo dan resultados previstos", async () => {
      const types = ["04", "05", "06", "07"] as const;
      for (const environment of ["TEST", "PRODUCTION"] as const) {
        for (const documentType of types) {
          for (const pointIndex of [1, 2]) {
            const k = key(company, pointIndex, documentType, environment);
            const services = fiscalServices(db.database.prisma);
            const [reservation, adjustment] = await Promise.allSettled([
              services.reservation.reserve(reservationInput(k)),
              services.administration.adjust(adminContext(company), adjustParams(k), {
                nextNumber: 500,
                expectedNextNumber: 1,
              }),
            ]);
            expect(reservation.status).toBe("fulfilled");
            const sequential = (reservation as PromiseFulfilledResult<{ sequential: number }>).value
              .sequential;
            if (adjustment.status === "fulfilled") {
              expect(sequential).toBe(500);
            } else {
              expect(DOMAIN_CODES.has((adjustment.reason as { code?: string }).code ?? "")).toBe(
                true,
              );
              expect(sequential).toBe(1);
            }
            await expectCoherent(k);
          }
        }
      }
    });
  });

  describe("C: reserva y ajuste sobre un contador existente", () => {
    it("si la reserva confirma antes, el ajuste preparado sobre el valor anterior se rechaza", async () => {
      const k = key(company, 3, "01");
      const services = fiscalServices(db.database.prisma);
      await services.reservation.reserve(reservationInput(k));
      const reached = deferred();
      const release = deferred();
      const held = fiscalServices(db.database.prisma, {
        wrap: (uow) => holdingUow(uow, reached, release),
      });
      const reservation = held.reservation.reserve(reservationInput(k));
      await reached.promise;
      const adjustment = services.administration.adjust(adminContext(company), adjustParams(k), {
        nextNumber: 100,
        expectedNextNumber: 2,
      });
      expect(await stillPending(adjustment)).toBe(true);
      release.resolve();
      expect((await reservation).sequential).toBe(2);
      await expect(adjustment).rejects.toMatchObject({ code: "SEQUENCE_CHANGED" });
      await expectCoherent(k);
    });

    it("si el ajuste confirma antes, la reserva recibe el siguiente ajustado", async () => {
      const k = key(company, 3, "01");
      const reached = deferred();
      const release = deferred();
      const held = fiscalServices(db.database.prisma, {
        wrap: (uow) => holdingUow(uow, reached, release),
      });
      const adjustment = held.administration.adjust(adminContext(company), adjustParams(k), {
        nextNumber: 100,
        expectedNextNumber: 3,
      });
      await reached.promise;
      const reservation = fiscalServices(db.database.prisma).reservation.reserve(
        reservationInput(k),
      );
      expect(await stillPending(reservation)).toBe(true);
      release.resolve();
      await adjustment;
      expect((await reservation).sequential).toBe(100);
      await expectCoherent(k);
    });

    it("un retroceso concurrente con reservas nunca vuelve a un número reservado", async () => {
      const k = key(company, 3, "01");
      const services = fiscalServices(db.database.prisma);
      const ctx = () => adminContext(company);
      for (let round = 0; round < 10; round++) {
        // Avanza 100 para dejar margen y, a la vez que dos reservas, retrocede 50 con motivo.
        const start = (await counterRows(k))[0]!.nextNumber;
        await services.administration.adjust(ctx(), adjustParams(k), {
          nextNumber: start + 100,
          expectedNextNumber: start,
        });
        const results = await Promise.allSettled([
          services.reservation.reserve(reservationInput(k)),
          services.administration.adjust(ctx(), adjustParams(k), {
            nextNumber: start + 50,
            expectedNextNumber: start + 100,
            reason: "Se avanzó de más",
          }),
          services.reservation.reserve(reservationInput(k)),
        ]);
        expect(results[0].status).toBe("fulfilled");
        expect(results[2].status).toBe("fulfilled");
        if (results[1].status === "rejected") {
          expect((results[1].reason as { code?: string }).code).toBe("SEQUENCE_CHANGED");
        }
        await expectCoherent(k);
      }
    });
  });

  describe("desactivación concurrente del punto (design D4)", () => {
    it("una reserva en curso se completa aunque la desactivación se confirme antes que ella", async () => {
      const prisma = db.database.prisma;
      const k = key(company, 2, "01");
      const reached = deferred();
      const release = deferred();
      const held = fiscalServices(prisma, { wrap: (uow) => holdingUow(uow, reached, release) });
      const reservation = held.reservation.reserve(reservationInput(k));
      await reached.promise;
      // La desactivación no espera a la reserva: se confirma mientras la reserva sigue abierta.
      await prisma.emissionPoint.update({
        where: { id: k.emissionPointId },
        data: { active: false },
      });
      release.resolve();
      expect((await reservation).sequential).toBe(1);
      expect(await reservedOf(k)).toEqual([1]);
      await expect(
        fiscalServices(prisma).reservation.reserve(reservationInput(k)),
      ).rejects.toMatchObject({ code: "EMISSION_POINT_UNAVAILABLE" });
      expect((await counterRows(k))[0]).toMatchObject({ nextNumber: 2, lastReserved: 1 });
    });

    it("una reserva que comienza después de la desactivación confirmada se rechaza sin tocar contadores", async () => {
      // Clave que ninguna prueba anterior usó: el rechazo tampoco crea su contador.
      const k = key(company, 2, "03");
      const existing = key(company, 2, "01");
      const before = await counterRows(existing);
      expect(await counterRows(k)).toEqual([]);
      for (const target of [k, existing]) {
        await expect(
          fiscalServices(db.database.prisma).reservation.reserve(reservationInput(target)),
        ).rejects.toMatchObject({ code: "EMISSION_POINT_UNAVAILABLE", status: 409 });
      }
      expect(await counterRows(k)).toEqual([]);
      expect(await counterRows(existing)).toEqual(before);
    });
  });
});
