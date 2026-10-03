// Invariantes de la migración add_fiscal_numbering en PostgreSQL con dos empresas (design D2 y D6):
// unicidad del secuencial con el ambiente, siguiente por encima del último reservado, rangos, clave
// inmutable, contadores sin borrado, último reservado monótono, reservas de solo agregado y claves
// compuestas por empresa y establecimiento. Escribe directamente en las tablas.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/platform/db/database.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertCompany } from "./fixtures.ts";

type Point = { companyId: string; establishmentId: string; emissionPointId: string };

async function insertPoint(db: DbClient, companyId: string, code: string): Promise<Point> {
  const establishment = await db.establishment.create({
    data: { companyId, code, address: `Dirección ${code}` },
  });
  const point = await db.emissionPoint.create({
    data: { companyId, establishmentId: establishment.id, code: "001" },
  });
  return { companyId, establishmentId: establishment.id, emissionPointId: point.id };
}

describe("invariantes de la numeración fiscal en la base de datos", () => {
  let db: MigratedSchema;
  let prisma: DbClient;
  let pointA: Point;
  let pointA2: Point;
  let pointB: Point;
  const table = (name: string) => `"${db.name}"."${name}"`;
  const counter = (point: Point, documentType = "01", environment = "TEST") => ({
    ...point,
    environment,
    documentType,
  });

  beforeAll(async () => {
    db = await createMigratedSchema("fiscal_schema");
    prisma = db.database.prisma;
    const companyA = await insertCompany(prisma, "Empresa A");
    const companyB = await insertCompany(prisma, "Empresa B");
    pointA = await insertPoint(prisma, companyA, "001");
    pointA2 = await insertPoint(prisma, companyA, "002");
    pointB = await insertPoint(prisma, companyB, "001");
  });

  afterAll(async () => {
    await db.drop();
  });

  it("acepta un contador y sus reservas, y el valor interno de agotado", async () => {
    await prisma.fiscalSequence.create({
      data: { ...counter(pointA), nextNumber: 3, lastReserved: 2 },
    });
    await prisma.fiscalSequenceReservation.createMany({
      data: [1, 2].map((sequential) => ({ ...counter(pointA), sequential, correlationId: "c" })),
    });
    const exhausted = await prisma.fiscalSequence.create({
      data: { ...counter(pointA, "07"), nextNumber: 1_000_000_000, lastReserved: 999_999_999 },
    });
    expect(exhausted.nextNumber).toBe(1_000_000_000);
  });

  it("rechaza un secuencial reservado dos veces en la misma clave", async () => {
    await expect(
      prisma.fiscalSequenceReservation.create({
        data: { ...counter(pointA), sequential: 2, correlationId: "c" },
      }),
    ).rejects.toThrow(
      /Unique constraint|fiscal_sequence_reservation_company_id_environment_establis_key/,
    );
  });

  it("el mismo secuencial en otro ambiente es otra reserva", async () => {
    await prisma.fiscalSequence.create({
      data: { ...counter(pointA, "01", "PRODUCTION"), nextNumber: 3, lastReserved: 2 },
    });
    await expect(
      prisma.fiscalSequenceReservation.create({
        data: { ...counter(pointA, "01", "PRODUCTION"), sequential: 2, correlationId: "c" },
      }),
    ).resolves.toBeDefined();
  });

  it("rechaza un siguiente igual o menor que el último reservado y valores fuera de rango", async () => {
    for (const [data, constraint] of [
      [{ nextNumber: 2 }, "fiscal_sequence_next_above_reserved_check"],
      [{ nextNumber: 1 }, "fiscal_sequence_next_above_reserved_check"],
      [{ nextNumber: 1_000_000_001 }, "fiscal_sequence_next_number_check"],
    ] as const) {
      await expect(
        prisma.fiscalSequence.update({
          where: {
            companyId_environment_establishmentId_emissionPointId_documentType: counter(pointA),
          },
          data,
        }),
        constraint,
      ).rejects.toThrow(new RegExp(constraint));
    }
    await expect(
      prisma.fiscalSequence.create({
        data: { ...counter(pointA, "03"), nextNumber: 0 },
      }),
      // 0 viola el rango y también "siguiente por encima del reservado"; PostgreSQL informa uno.
    ).rejects.toThrow(/fiscal_sequence_next_(number|above_reserved)_check/);
    await expect(
      prisma.fiscalSequence.create({
        data: { ...counter(pointA, "04"), nextNumber: 5, lastReserved: 0 },
      }),
    ).rejects.toThrow(/fiscal_sequence_last_reserved_check/);
    await expect(
      prisma.fiscalSequence.create({
        data: { ...counter(pointA, "05", "STAGING"), nextNumber: 1 },
      }),
    ).rejects.toThrow(/fiscal_sequence_environment_check/);
    await expect(
      prisma.fiscalSequence.create({ data: { ...counter(pointA, "02"), nextNumber: 1 } }),
    ).rejects.toThrow(/fiscal_sequence_document_type_check/);
    await expect(
      prisma.fiscalSequenceReservation.create({
        data: { ...counter(pointA), sequential: 1_000_000_000, correlationId: "c" },
      }),
    ).rejects.toThrow(/fiscal_sequence_reservation_sequential_check/);
  });

  it("no permite cambiar la clave, bajar o anular el último reservado, ni borrar contadores", async () => {
    const where = {
      companyId_environment_establishmentId_emissionPointId_documentType: counter(pointA),
    };
    await expect(
      prisma.fiscalSequence.update({ where, data: { documentType: "04" } }),
    ).rejects.toThrow(/la clave del contador no cambia/);
    await expect(
      prisma.fiscalSequence.update({ where, data: { lastReserved: 1 } }),
    ).rejects.toThrow(/no disminuye/);
    await expect(
      prisma.fiscalSequence.update({ where, data: { lastReserved: null } }),
    ).rejects.toThrow(/no disminuye/);
    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM ${table("fiscal_sequence")}`),
    ).rejects.toThrow(/no admite DELETE/);
    await expect(
      prisma.$executeRawUnsafe(`TRUNCATE ${table("fiscal_sequence")} CASCADE`),
    ).rejects.toThrow(/no admite TRUNCATE/);
  });

  it("las reservas son de solo agregado", async () => {
    for (const statement of [
      `UPDATE ${table("fiscal_sequence_reservation")} SET "sequential" = 9`,
      `DELETE FROM ${table("fiscal_sequence_reservation")}`,
      `TRUNCATE ${table("fiscal_sequence_reservation")} CASCADE`,
    ]) {
      await expect(prisma.$executeRawUnsafe(statement), statement).rejects.toThrow(/no admite/);
    }
  });

  it("las claves compuestas rechazan un punto de otra empresa o de otro establecimiento", async () => {
    await expect(
      prisma.fiscalSequence.create({
        data: { ...counter({ ...pointB, companyId: pointA.companyId }), nextNumber: 1 },
      }),
    ).rejects.toThrow(/fiscal_sequence_company_id_establishment_id_emission_point_fkey/);
    await expect(
      prisma.fiscalSequence.create({
        data: {
          ...counter({ ...pointA2, emissionPointId: pointA.emissionPointId }),
          nextNumber: 1,
        },
      }),
    ).rejects.toThrow(/fiscal_sequence_company_id_establishment_id_emission_point_fkey/);
    await expect(
      prisma.fiscalSequenceReservation.create({
        data: { ...counter(pointA2, "06"), sequential: 1, correlationId: "c" },
      }),
    ).rejects.toThrow(/fiscal_sequence_reservation_company_id_environment_establi_fkey/);
  });

  it("cada empresa numera por su cuenta con los mismos códigos", async () => {
    await prisma.fiscalSequence.create({
      data: { ...counter(pointB), nextNumber: 2, lastReserved: 1 },
    });
    await expect(
      prisma.fiscalSequenceReservation.create({
        data: { ...counter(pointB), sequential: 1, correlationId: randomUUID() },
      }),
    ).resolves.toBeDefined();
  });
});
