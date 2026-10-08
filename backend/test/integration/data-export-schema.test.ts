// Invariantes de la migración add_data_portability en PostgreSQL (design D10 y D24): estados
// explícitos con los campos que exige cada uno, una generación activa y un paquete vigente por
// empresa, las transiciones permitidas, lo publicado de un paquete listo inmutable y filas que no se
// borran.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma } from "../../src/generated/prisma/client.ts";
import type { DbClient } from "../../src/platform/db/database.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertCompany, insertMember } from "./fixtures.ts";

const T0 = new Date("2026-10-08T12:00:00Z");
const SHA = "a".repeat(64);
const ready = (id: string): Prisma.DataExportUncheckedUpdateInput => ({
  status: "READY",
  activeCompanyId: null,
  phase: null,
  progressDone: null,
  progressTotal: null,
  snapshotAt: T0,
  generatedAt: new Date(T0.getTime() + 60_000),
  expiresAt: new Date(T0.getTime() + 86_460_000),
  fileName: `${id}-1.zip`,
  sizeBytes: 1024n,
  sha256: SHA,
  counts: { documents: 3 },
});

describe("exportaciones de portabilidad en la base de datos", () => {
  let db: MigratedSchema;
  let prisma: DbClient;
  let companyA: string;
  let companyB: string;
  let adminA: string;
  let adminB: string;

  const fails = (promise: Promise<unknown>) =>
    promise.then(
      () => null,
      (error: unknown) => String(error),
    );
  const queued = (companyId: string, requestedBy: string) =>
    prisma.dataExport.create({
      data: { companyId, requestedBy, status: "QUEUED", activeCompanyId: companyId },
    });
  const generating = (id: string, companyId: string) =>
    prisma.dataExport.update({
      where: { id },
      data: {
        status: "GENERATING",
        activeCompanyId: companyId,
        attempt: 1,
        startedAt: T0,
        phase: "SNAPSHOT",
      },
    });
  const readyExport = async (companyId: string, requestedBy: string) => {
    const row = await queued(companyId, requestedBy);
    await generating(row.id, companyId);
    return prisma.dataExport.update({
      where: { id: row.id },
      data: { ...ready(row.id), readyCompanyId: companyId },
    });
  };

  beforeAll(async () => {
    db = await createMigratedSchema("data_export_schema");
    prisma = db.database.prisma;
    companyA = await insertCompany(prisma, "Empresa A");
    companyB = await insertCompany(prisma, "Empresa B");
    adminA = (await insertMember(prisma, companyA, { name: "Ana", role: "ADMIN" })).userId;
    adminB = (await insertMember(prisma, companyB, { name: "Beto", role: "ADMIN" })).userId;
  });
  afterAll(async () => {
    await db.drop();
  });

  it("admite una sola generación activa por empresa", async () => {
    const first = await queued(companyA, adminA);
    expect(await fails(queued(companyA, adminA))).toMatch(/active_company_id/);
    const other = await queued(companyB, adminB);
    // Al fallar, la empresa vuelve a admitir otra generación.
    for (const row of [first, other])
      await prisma.dataExport.update({
        where: { id: row.id },
        data: {
          status: "FAILED",
          activeCompanyId: null,
          errorCode: "DATA_EXPORT_FAILED",
          finishedAt: T0,
        },
      });
    expect((await queued(companyA, adminA)).status).toBe("QUEUED");
  });

  it("rechaza un paquete listo incompleto y los valores fuera de su estado", async () => {
    const row = await prisma.dataExport.findFirstOrThrow({
      where: { companyId: companyA, status: "QUEUED" },
    });
    await generating(row.id, companyA);
    const incomplete = { ...ready(row.id), readyCompanyId: companyA, sha256: null };
    expect(
      await fails(prisma.dataExport.update({ where: { id: row.id }, data: incomplete })),
    ).toMatch(/data_export_values_check/);
    for (const data of [
      { phase: "PUBLICADO" },
      { errorCode: "DATA_EXPORT_FAILED" },
      { progressDone: 5, progressTotal: 3 },
      { formatVersion: "2" },
    ] as Prisma.DataExportUncheckedUpdateInput[])
      expect(await fails(prisma.dataExport.update({ where: { id: row.id }, data }))).toMatch(
        /data_export_values_check/,
      );
    await prisma.dataExport.update({
      where: { id: row.id },
      data: {
        status: "FAILED",
        activeCompanyId: null,
        phase: null,
        errorCode: "DATA_EXPORT_INSUFFICIENT_SPACE",
        finishedAt: T0,
      },
    });
  });

  it("deja un paquete vigente por empresa: el nuevo reemplaza al anterior en una transacción", async () => {
    const old = await readyExport(companyA, adminA);
    const next = await queued(companyA, adminA);
    await generating(next.id, companyA);
    // Sin pasar el anterior a EXPIRED, el nuevo no puede quedar listo.
    expect(
      await fails(
        prisma.dataExport.update({
          where: { id: next.id },
          data: { ...ready(next.id), readyCompanyId: companyA },
        }),
      ),
    ).toMatch(/ready_company_id/);
    await db.database.prisma.$transaction(async (tx) => {
      await tx.dataExport.update({
        where: { id: old.id },
        data: {
          status: "EXPIRED",
          readyCompanyId: null,
          expiredReason: "REPLACED",
          finishedAt: T0,
        },
      });
      await tx.dataExport.update({
        where: { id: next.id },
        data: { ...ready(next.id), readyCompanyId: companyA },
      });
    });
    expect(
      (await prisma.dataExport.findMany({ where: { companyId: companyA, status: "READY" } })).map(
        (row) => row.id,
      ),
    ).toEqual([next.id]);
  });

  it("solo permite las transiciones del design y no cambia lo publicado", async () => {
    const row = await prisma.dataExport.findFirstOrThrow({
      where: { companyId: companyA, status: "READY" },
    });
    // Un paquete listo no cambia en sí mismo, y al caducar conserva lo publicado.
    expect(
      await fails(
        prisma.dataExport.update({ where: { id: row.id }, data: { sha256: "b".repeat(64) } }),
      ),
    ).toMatch(/transición/);
    expect(
      await fails(
        prisma.dataExport.update({
          where: { id: row.id },
          data: {
            status: "EXPIRED",
            readyCompanyId: null,
            expiredReason: "TTL",
            finishedAt: T0,
            sha256: "b".repeat(64),
          },
        }),
      ),
    ).toMatch(/lo publicado/);
    expect(
      await fails(
        prisma.dataExport.update({
          where: { id: row.id },
          data: { status: "QUEUED", readyCompanyId: null, activeCompanyId: companyA },
        }),
      ),
    ).toMatch(/transición/);
    expect(
      await fails(
        prisma.dataExport.update({ where: { id: row.id }, data: { companyId: companyB } }),
      ),
    ).toMatch(/no cambian/);
    // Un paquete listo perdido o alterado pasa a FAILED con su código, nunca a EXPIRED.
    expect(
      await fails(
        prisma.dataExport.update({
          where: { id: row.id },
          data: { status: "EXPIRED", readyCompanyId: null, finishedAt: T0 },
        }),
      ),
    ).toMatch(/data_export_values_check/);
    await prisma.dataExport.update({
      where: { id: row.id },
      data: {
        status: "FAILED",
        readyCompanyId: null,
        errorCode: "DATA_EXPORT_PACKAGE_INTEGRITY",
        finishedAt: T0,
      },
    });
    expect(
      await fails(
        prisma.dataExport.update({
          where: { id: row.id },
          data: { errorCode: "DATA_EXPORT_PACKAGE_MISSING" },
        }),
      ),
    ).toMatch(/transición/);
    expect(await fails(prisma.dataExport.delete({ where: { id: row.id } }))).toMatch(
      /no admite DELETE/,
    );
    expect(await fails(prisma.$executeRawUnsafe(`TRUNCATE "${db.name}"."data_export"`))).toMatch(
      /no admite TRUNCATE/,
    );
  });
});
