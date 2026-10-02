// Reserva del siguiente secuencial contra PostgreSQL (design D3, D4 y D6): creación perezosa,
// contadores independientes, disponibilidad del punto, qué significa reservado, límite de nueve
// dígitos y aislamiento por empresa.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFiscalUnitOfWork } from "../../src/modules/fiscal/infrastructure/unit-of-work.ts";
import { reserveSequentialIn } from "../../src/modules/fiscal/application/reservation.ts";
import { createSequenceRepository } from "../../src/modules/fiscal/infrastructure/prisma-sequences.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import {
  adjustParams,
  adminContext,
  fiscalServices,
  insertFiscalCompany,
  key,
  reservationInput,
  type FiscalCompany,
} from "./fiscal-harness.ts";

describe("reserva del siguiente secuencial", () => {
  let db: MigratedSchema;
  let companyA: FiscalCompany;
  let companyB: FiscalCompany;
  const reserve = (k: ReturnType<typeof key>) =>
    fiscalServices(db.database.prisma).reservation.reserve(reservationInput(k));
  const counterOf = (k: ReturnType<typeof key>) =>
    createSequenceRepository(db.database.prisma).find(k);

  beforeAll(async () => {
    db = await createMigratedSchema("fiscal_reservation");
    companyA = await insertFiscalCompany(db.database.prisma, "Empresa A");
    companyB = await insertFiscalCompany(db.database.prisma, "Empresa B");
  });

  afterAll(async () => {
    await db.drop();
  });

  describe("contadores (design D2 y D3)", () => {
    it("la primera reserva recibe 1, crea el contador y registra la reserva", async () => {
      const k = key(companyA);
      expect(await counterOf(k)).toBeNull();
      const reservation = await reserve(k);
      expect(reservation).toMatchObject({ sequential: 1, documentNumber: "001-001-000000001" });
      expect(await counterOf(k)).toEqual({ nextNumber: 2, lastReserved: 1 });
      const rows = await db.database.prisma.fiscalSequenceReservation.findMany({ where: k });
      expect(rows.map((row) => row.sequential)).toEqual([1]);
    });

    it("tipos, puntos y ambientes son independientes", async () => {
      expect((await reserve(key(companyA))).sequential).toBe(2);
      expect((await reserve(key(companyA, 0, "04"))).sequential).toBe(1);
      expect((await reserve(key(companyA, 1))).sequential).toBe(1);
      expect((await reserve(key(companyA, 0, "01", "PRODUCTION"))).sequential).toBe(1);
    });

    it("volver a un ambiente continúa su secuencia sin compartirla ni reiniciarla", async () => {
      expect((await reserve(key(companyA))).sequential).toBe(3);
      expect((await reserve(key(companyA, 0, "01", "PRODUCTION"))).sequential).toBe(2);
      expect((await reserve(key(companyA))).sequential).toBe(4);
    });

    it("el último reservado coincide con el máximo de las reservas", async () => {
      const k = key(companyA);
      const max = await db.database.prisma.fiscalSequenceReservation.aggregate({
        where: k,
        _max: { sequential: true },
      });
      expect((await counterOf(k))?.lastReserved).toBe(max._max.sequential);
    });

    it("el mismo código en otra empresa es otra numeración", async () => {
      expect((await reserve(key(companyB))).sequential).toBe(1);
      expect((await counterOf(key(companyA)))?.nextNumber).toBe(5);
    });
  });

  describe("disponibilidad del punto (design D4 y D8)", () => {
    it("rechaza un punto inactivo o de un establecimiento inactivo sin consumir número", async () => {
      const prisma = db.database.prisma;
      const k = key(companyA, 2);
      await reserve(k);
      await prisma.emissionPoint.update({
        where: { id: k.emissionPointId },
        data: { active: false },
      });
      await expect(reserve(k)).rejects.toMatchObject({
        code: "EMISSION_POINT_UNAVAILABLE",
        status: 409,
      });
      await prisma.emissionPoint.update({
        where: { id: k.emissionPointId },
        data: { active: true },
      });
      await prisma.establishment.update({
        where: { id: k.establishmentId },
        data: { active: false },
      });
      await expect(reserve(k)).rejects.toMatchObject({ code: "EMISSION_POINT_UNAVAILABLE" });
      expect(await counterOf(k)).toEqual({ nextNumber: 2, lastReserved: 1 });
      await prisma.establishment.update({
        where: { id: k.establishmentId },
        data: { active: true },
      });
      expect((await reserve(k)).sequential).toBe(2);
    });

    it("un punto de otra empresa o bajo otro establecimiento no existe para la reserva", async () => {
      await expect(
        reserve({ ...key(companyA), emissionPointId: companyB.points[0]!.emissionPointId }),
      ).rejects.toMatchObject({ code: "EMISSION_POINT_NOT_FOUND", status: 404 });
      await expect(
        reserve({ ...key(companyA, 0), establishmentId: companyA.points[1]!.establishmentId }),
      ).rejects.toMatchObject({ code: "EMISSION_POINT_NOT_FOUND" });
    });
  });

  describe("qué significa reservado (design D4)", () => {
    it("una transacción revertida antes del commit no reserva el número", async () => {
      const k = key(companyA, 0, "05");
      const uow = createFiscalUnitOfWork(db.database.prisma);
      await expect(
        uow.run(async (scope) => {
          const reservation = await reserveSequentialIn(scope, reservationInput(k));
          expect(reservation.sequential).toBe(1);
          throw new Error("falla antes de confirmar");
        }),
      ).rejects.toThrow("falla antes de confirmar");
      expect(await counterOf(k)).toBeNull();
      expect((await reserve(k)).sequential).toBe(1);
    });

    it("una falla posterior a la confirmación deja un hueco sin reutilizar el número", async () => {
      const k = key(companyA, 0, "05");
      const committed = await reserve(k);
      expect(committed.sequential).toBe(2);
      // El paso siguiente de la emisión (firma, XML, envío) falla después de confirmar la reserva.
      const signAfterCommit = (): never => {
        throw new Error("falla al firmar el comprobante " + committed.documentNumber);
      };
      expect(signAfterCommit).toThrow("falla al firmar");
      expect((await reserve(k)).sequential).toBe(3);
      const reserved = await db.database.prisma.fiscalSequenceReservation.findMany({
        where: k,
        orderBy: { sequential: "asc" },
      });
      expect(reserved.map((row) => row.sequential)).toEqual([1, 2, 3]);
    });
  });

  describe("límite de nueve dígitos (design D6)", () => {
    it("reserva el 999999999, luego se agota sin reiniciar ni exponer el valor interno", async () => {
      const k = key(companyA, 1, "06", "PRODUCTION");
      const admin = fiscalServices(db.database.prisma).administration;
      await admin.adjust(adminContext(companyA), adjustParams(k), {
        nextNumber: 999_999_999,
        expectedNextNumber: 1,
      });
      expect((await reserve(k)).documentNumber).toBe("002-001-999999999");
      const exhausted = await reserve(k).then(
        () => null,
        (error: unknown) => error as { code: string; status: number; message: string },
      );
      expect(exhausted).toMatchObject({ code: "SEQUENCE_EXHAUSTED", status: 409 });
      expect(exhausted?.message).toContain("guía de remisión en el punto 002-001 (Producción)");
      expect(await counterOf(k)).toEqual({ nextNumber: 1_000_000_000, lastReserved: 999_999_999 });
      const listed = await admin.list(adminContext(companyA), { environment: "PRODUCTION" });
      const entry = listed.find(
        (item) => item.key.emissionPointId === k.emissionPointId && item.key.documentType === "06",
      );
      expect(entry?.counter.nextNumber).toBe(1_000_000_000);
      expect((await reserve(key(companyA, 1, "07", "PRODUCTION"))).sequential).toBe(1);
    });
  });
});
