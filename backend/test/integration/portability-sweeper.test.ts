// Barrido y recuperación de la portabilidad (add-data-portability, design D14 y D15; tarea 4.6):
// caducidad por vencimiento, paquete listo perdido o alterado a FAILED (nunca EXPIRED), huérfanos y
// trabajos de intentos obsoletos borrados, sin seguir enlaces y sin tocar los datos de la empresa.
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Registry } from "@prometheus-io/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuditLog } from "../../src/modules/audit/infrastructure/prisma-audit-log.ts";
import { registerPortabilityMetrics } from "../../src/modules/data-portability/infrastructure/metrics.ts";
import { createPackageFiles } from "../../src/modules/data-portability/infrastructure/package-files.ts";
import { createDataExportStore } from "../../src/modules/data-portability/infrastructure/prisma-data-exports.ts";
import { createPortabilityDatabase } from "../../src/modules/data-portability/infrastructure/prisma-portability-database.ts";
import { createPackageSweeper } from "../../src/modules/data-portability/infrastructure/sweeper.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertFiscalCompany, type FiscalCompany } from "./fiscal-harness.ts";
import { insertDocument } from "./transmission-harness.ts";

const silent = { info: () => {}, warn: () => {}, error: () => {} };
const T = new Date("2026-10-08T12:00:00Z");
const HOUR = 3_600_000;

describe("barrido de la portabilidad", () => {
  let db: MigratedSchema;
  let root: string;
  let outside: string;
  const store = createDataExportStore();

  async function readyRow(company: FiscalCompany, expiresAt: Date, content: string | null) {
    const prisma = db.database.prisma;
    const row = await prisma.dataExport.create({
      data: {
        companyId: company.companyId,
        requestedBy: company.adminId,
        status: "QUEUED",
        activeCompanyId: company.companyId,
      },
    });
    await prisma.dataExport.update({
      where: { id: row.id },
      data: { status: "GENERATING", attempt: 1, startedAt: T },
    });
    const fileName = `${row.id}-1.zip`;
    if (content !== null) await writeFile(join(root, fileName), content, { mode: 0o400 });
    await prisma.dataExport.update({
      where: { id: row.id },
      data: {
        status: "READY",
        activeCompanyId: null,
        readyCompanyId: company.companyId,
        snapshotAt: T,
        generatedAt: new Date(expiresAt.getTime() - 24 * HOUR),
        expiresAt,
        fileName,
        sizeBytes: 7n,
        sha256: "a".repeat(64),
        counts: { documentsTest: 1 },
      },
    });
    return { id: row.id, fileName };
  }

  const sweeper = (now: Date) =>
    createPackageSweeper({
      database: createPortabilityDatabase(db.database.prisma),
      store,
      files: createPackageFiles(root),
      audit: createAuditLog,
      metrics: registerPortabilityMetrics(new Registry()),
      logger: silent,
      now: () => now,
    });

  /** Huella de los datos de la empresa que el barrido nunca toca. */
  const fingerprint = async () =>
    JSON.stringify(
      await db.database.prisma.$queryRawUnsafe(
        `SELECT (SELECT md5(string_agg(t::text, '|' ORDER BY t::text)) FROM "${db.name}"."electronic_document" t) AS documents,
                (SELECT md5(string_agg(t::text, '|' ORDER BY t::text)) FROM "${db.name}"."document_artifact" t) AS artifacts`,
      ),
    );

  beforeAll(async () => {
    db = await createMigratedSchema("portability_sweeper");
    root = await mkdtemp(join(tmpdir(), "portabilidad-barrido-"));
    outside = await mkdtemp(join(tmpdir(), "portabilidad-fuera-"));
    await createPackageFiles(root).init();
  }, 300_000);

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
    await db?.drop();
  });

  it("caduca por vencimiento, falla lo perdido o alterado y borra huérfanos sin seguir enlaces", async () => {
    const prisma = db.database.prisma;
    const companies = await Promise.all(
      ["Vencida", "Perdida", "Alterada", "Intacta", "Generando"].map((name) =>
        insertFiscalCompany(prisma, `Empresa ${name}`, 1),
      ),
    );
    const [expired, lost, altered, intact, generating] = companies as [
      FiscalCompany,
      FiscalCompany,
      FiscalCompany,
      FiscalCompany,
      FiscalCompany,
    ];
    await insertDocument(prisma, intact, "SIGNED");
    const now = new Date(T.getTime() + HOUR);
    const rows = {
      expired: await readyRow(expired, new Date(now.getTime() - 1_000), "1234567"),
      lost: await readyRow(lost, new Date(now.getTime() + HOUR), null),
      altered: await readyRow(altered, new Date(now.getTime() + HOUR), "corto"),
      intact: await readyRow(intact, new Date(now.getTime() + HOUR), "1234567"),
    };
    // Una generación en curso en su intento 2: su trabajo, su parcial y su paquete se conservan;
    // los de su intento 1, obsoleto, no.
    const running = await prisma.dataExport.create({
      data: {
        companyId: generating.companyId,
        requestedBy: generating.adminId,
        status: "QUEUED",
        activeCompanyId: generating.companyId,
      },
    });
    await prisma.dataExport.update({
      where: { id: running.id },
      data: { status: "GENERATING", attempt: 2, startedAt: T },
    });
    for (const name of [
      `${running.id}-2.partial`,
      `${running.id}-2.zip`,
      `${running.id}-1.partial`,
    ])
      await writeFile(join(root, name), "x");
    await mkdir(join(root, "work", `${running.id}-2`));
    await mkdir(join(root, "work", `${running.id}-1`));
    // Huérfanos sin fila, un enlace con un nombre válido hacia afuera y un archivo ajeno.
    const orphan = randomUUID();
    await writeFile(join(root, `${orphan}-1.partial`), "x");
    await writeFile(join(root, `${orphan}-3.zip`), "x");
    await mkdir(join(root, "work", `${orphan}-1`));
    const target = join(outside, "no-borrar.txt");
    await writeFile(target, "dato ajeno");
    await symlink(target, join(root, `${randomUUID()}-9.zip`));
    await writeFile(join(root, "ajeno.txt"), "no es de la portabilidad");
    const before = await fingerprint();

    const result = await sweeper(now).sweep();
    // El vencido, el alterado, el intento 1 (parcial y trabajo), los tres huérfanos y el enlace.
    expect(result).toEqual({ expired: 1, failed: 2, removed: 8 });

    const row = (id: string) => prisma.dataExport.findUniqueOrThrow({ where: { id } });
    expect(await row(rows.expired.id)).toMatchObject({ status: "EXPIRED", expiredReason: "TTL" });
    expect(await row(rows.lost.id)).toMatchObject({
      status: "FAILED",
      errorCode: "DATA_EXPORT_PACKAGE_MISSING",
    });
    expect(await row(rows.altered.id)).toMatchObject({
      status: "FAILED",
      errorCode: "DATA_EXPORT_PACKAGE_INTEGRITY",
    });
    expect(await row(rows.intact.id)).toMatchObject({ status: "READY" });
    const failed = await prisma.auditEvent.findMany({ where: { action: "data_export.failed" } });
    expect(failed.map((event) => event.changes)).toEqual(
      expect.arrayContaining([
        { exportId: rows.lost.id, code: "DATA_EXPORT_PACKAGE_MISSING" },
        { exportId: rows.altered.id, code: "DATA_EXPORT_PACKAGE_INTEGRITY" },
      ]),
    );
    expect((await readdir(root)).sort()).toEqual(
      [
        rows.intact.fileName,
        `${running.id}-2.partial`,
        `${running.id}-2.zip`,
        "ajeno.txt",
        "work",
      ].sort(),
    );
    expect(await readdir(join(root, "work"))).toEqual([`${running.id}-2`]);
    // El enlace se borró sin seguirlo: su destino sigue intacto.
    expect(await readFile(target, "utf8")).toBe("dato ajeno");
    expect(await fingerprint()).toBe(before);
    // Un segundo barrido no cambia nada.
    expect(await sweeper(now).sweep()).toEqual({ expired: 0, failed: 0, removed: 0 });
  });
});
