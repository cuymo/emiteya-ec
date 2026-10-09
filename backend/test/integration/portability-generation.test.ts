// Generación del paquete (add-data-portability, design D2 a D9, D12 y D13; tareas 4.2 y 4.3) contra
// PostgreSQL, leído con zipfile de Python, `sha256sum -c` y el lector XLSX de las pruebas.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  generatePackage,
  type GeneratorDeps,
} from "../../src/modules/data-portability/application/generate.ts";
import { ExportFailure } from "../../src/modules/data-portability/application/errors.ts";
import { corruptArtifact } from "./archive-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertFiscalCompany, type FiscalCompany } from "./fiscal-harness.ts";
import {
  completeAuthorizedArtifacts,
  generatorDeps,
  seedPortabilityExtras,
  type PortabilityIds,
} from "./portability-harness.ts";
import { seedReportData } from "./reports-api-harness.ts";
import { insertDocument } from "./transmission-harness.ts";
import { readXlsx, serialToWallClock } from "../support/xlsx-reader.ts";
import { extractZip } from "../support/zip-inspect.ts";

const run = promisify(execFile);
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

describe("generación del paquete de portabilidad", () => {
  let db: MigratedSchema;
  let a: FiscalCompany;
  let b: FiscalCompany;
  let ids: Record<string, string>;
  let extras: PortabilityIds;
  let root: string;
  let counter = 0;

  /** Genera el paquete de A y lo extrae con Python. */
  async function generate(overrides: Partial<GeneratorDeps> = {}, company = a) {
    counter += 1;
    const deps = generatorDeps(db, root, overrides);
    await deps.packages.init();
    const workDir = await deps.packages.workDir("00000000-0000-4000-8000-000000000000", counter);
    const packagePath = join(root, `paquete-${counter}.zip`);
    const progress: [string, number | undefined, number | undefined][] = [];
    const result = await generatePackage(deps, {
      companyId: company.companyId,
      workDir,
      packagePath,
      signal: new AbortController().signal,
      progress: (phase, done, total) => {
        progress.push([phase, done, total]);
        return Promise.resolve();
      },
    });
    const out = join(root, `extraido-${counter}`);
    const entries = await extractZip(packagePath, out);
    return { result, packagePath, out, entries, progress };
  }

  beforeAll(async () => {
    db = await createMigratedSchema("portability_generation");
    const prisma = db.database.prisma;
    a = await insertFiscalCompany(prisma, "Empresa A", 2);
    b = await insertFiscalCompany(prisma, "Empresa B", 1);
    ids = await seedReportData(prisma, a);
    extras = await seedPortabilityExtras(prisma, a, ids.invoice!);
    await completeAuthorizedArtifacts(prisma, a.companyId);
    ids.other = (await insertDocument(prisma, b, "SIGNED")).id;
    root = await mkdtemp(join(tmpdir(), "portabilidad-"));
  }, 300_000);

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
    await db?.drop();
  });

  describe("fase 1: los libros y el inventario en un solo momento (tarea 4.2)", () => {
    it("escribe los seis libros con los tipos de celda exactos y sin fórmulas", async () => {
      const { out, entries } = await generate();
      expect(entries.slice(0, 8)).toEqual([
        "manifest.json",
        "LEEME.txt",
        "data/empresa.xlsx",
        "data/terceros.xlsx",
        "data/productos.xlsx",
        "data/comprobantes.xlsx",
        "data/inventario.xlsx",
        "data/auditoria.xlsx",
      ]);
      const parties = readXlsx(join(out, "data/terceros.xlsx"));
      const sheet = parties.sheets[0]!;
      const rows = [...sheet.rows.values()];
      // Identificación con su cero, como texto; la razón social que parece fórmula, como texto.
      const customer = rows.find((row) => row.get("B")?.text === ids.customer);
      expect(customer?.get("B")).toMatchObject({ type: "string" });
      const hostile = rows.find((row) => row.get("C")?.text.startsWith("=HYPERLINK"));
      expect(hostile?.get("C")).toMatchObject({ type: "string", quotePrefix: true });
      for (const [name, xml] of parties.parts) expect(xml, name).not.toMatch(/<f[\s>/]/);
      // Importes como números con formato monetario y la fecha de emisión sin desplazarse.
      const book = readXlsx(join(out, "data/comprobantes.xlsx"));
      const documents = book.sheets.find((s) => s.name === "Comprobantes")!;
      const invoice = [...documents.rows.values()].find((row) => row.get("L")?.type === "number");
      expect(invoice?.get("L")).toMatchObject({ type: "number", numFmt: "#,##0.00" });
      // El total vale exactamente el del comprobante.
      const stored = await db.database.prisma.electronicDocument.findFirstOrThrow({
        where: { accessKey: invoice!.get("D")!.text },
      });
      expect(Number(invoice!.get("L")!.text).toFixed(2)).toBe(Number(stored.total).toFixed(2));
      // Un saldo que excede la precisión segura de la hoja, como su texto exacto.
      const stock = readXlsx(join(out, "data/inventario.xlsx")).sheets.find(
        (s) => s.name === "Existencias",
      )!;
      const huge = [...stock.rows.values()].find(
        (row) => row.get("C")?.text === "999999999999.999999",
      );
      expect(huge?.get("C")).toMatchObject({ type: "string" });
      expect(serialToWallClock(invoice!.get("E")!.text)).toMatch(
        /^2026-\d{2}-\d{2}T00:00:00\.000$/,
      );
      expect(book.sheets.map((s) => s.name)).toEqual([
        "Comprobantes",
        "Transiciones",
        "Intentos SRI",
        "Retenciones",
        "Destinatarios",
        "Entregas",
      ]);
    });

    it("divide una hoja en el máximo menos uno, el máximo y el máximo más uno, sin perder filas", async () => {
      const total = await db.database.prisma.party.count({ where: { companyId: a.companyId } });
      for (const [max, sheets] of [
        [total - 1, [total - 1, 1]],
        [total, [total]],
        [total + 1, [total]],
      ] as const) {
        const { out } = await generate({ maxSheetRows: max });
        const book = readXlsx(join(out, "data/terceros.xlsx"));
        // El manifiesto nombra las hojas del conjunto.
        const manifest = JSON.parse(await readFile(join(out, "manifest.json"), "utf8")) as {
          datasets: { workbook: string; sheets: string[] }[];
        };
        expect(
          manifest.datasets
            .filter((d) => d.workbook.endsWith("terceros.xlsx"))
            .flatMap((d) => d.sheets),
        ).toEqual(book.sheets.map((s) => s.name));
        expect([max, book.sheets.map((s) => s.name)]).toEqual([
          max,
          sheets.length === 1 ? ["Terceros"] : ["Terceros", "Terceros (2)"],
        ]);
        // Cada hoja repite el encabezado; las filas de datos suman el total, sin repetir ninguna.
        const data = book.sheets.map((s) => s.rows.size - 1);
        expect(data).toEqual(sheets);
        for (const s of book.sheets)
          expect(s.rows.get(1)?.get("A")?.text).toBe("Tipo de identificación");
        const keys = book.sheets.flatMap((s) =>
          [...s.rows.entries()]
            .filter(([r]) => r > 1)
            .map(([, row]) => `${row.get("A")?.text}:${row.get("B")?.text}:${row.get("C")?.text}`),
        );
        expect(keys).toHaveLength(total);
        expect(new Set(keys).size).toBe(total);
      }
    });

    it("lo creado o cambiado después de snapshotAt no entra en el paquete", async () => {
      const prisma = db.database.prisma;
      const signed = await insertDocument(prisma, a, "RECEIVED", { issueDate: "2026-10-02" });
      let late: string | undefined;
      // Las mutaciones ocurren entre las fases: en el primer aviso de la fase 2.
      counter += 1;
      const deps = generatorDeps(db, root);
      await deps.packages.init();
      const workDir = await deps.packages.workDir("00000000-0000-4000-8000-000000000001", counter);
      const packagePath = join(root, `paquete-${counter}.zip`);
      const result = await generatePackage(deps, {
        companyId: a.companyId,
        workDir,
        packagePath,
        signal: new AbortController().signal,
        progress: async (phase) => {
          if (phase !== "ARTIFACTS" || late !== undefined) return;
          late = (await insertDocument(prisma, a, "SIGNED", { issueDate: "2026-10-03" })).accessKey;
          await prisma.party.update({
            where: { id: ids.party! },
            data: { email: "tarde@ejemplo.invalid" },
          });
          // El recibido se autoriza durante la generación: entra recibido, sin su XML autorizado.
          await prisma.electronicDocument.update({
            where: { id: signed.id },
            data: {
              state: "AUTHORIZED",
              authorizationNumber: signed.accessKey,
              authorizationDate: new Date(),
              authorizationEnvironment: "TEST",
            },
          });
          await completeAuthorizedArtifacts(prisma, a.companyId);
        },
      });
      const extracted = join(root, `extraido-${counter}`);
      const names = await extractZip(packagePath, extracted);
      const manifest = JSON.parse(await readFile(join(extracted, "manifest.json"), "utf8")) as {
        snapshotAt: string;
      };
      expect(new Date(manifest.snapshotAt)).toEqual(result.snapshotAt);
      const documents = readXlsx(join(extracted, "data/comprobantes.xlsx")).sheets[0]!;
      const rows = [...documents.rows.values()];
      expect(rows.map((row) => row.get("D")?.text)).not.toContain(late);
      expect(names.some((name) => name.includes(late!))).toBe(false);
      const row = rows.find((r) => r.get("D")?.text === signed.accessKey);
      expect(row?.get("G")?.text).toBe("RECEIVED");
      expect(names.some((name) => name.endsWith(`${signed.documentNumber}/firmado.xml`))).toBe(
        true,
      );
      expect(names.some((name) => name.endsWith(`${signed.documentNumber}/autorizado.xml`))).toBe(
        false,
      );
      const parties = readXlsx(join(extracted, "data/terceros.xlsx")).sheets[0]!;
      expect(
        [...parties.rows.values()].some((r) => r.get("E")?.text === "tarde@ejemplo.invalid"),
      ).toBe(false);
    });
  });

  describe("fase 2: los artefactos verificados y el inventario (tarea 4.3)", () => {
    it("copia los bytes exactos, cubre cada archivo en SHA256SUMS y sha256sum -c pasa", async () => {
      const { out, entries, result } = await generate();
      // El XML autorizado del paquete es el de la bandeja, byte a byte.
      const invoice = await db.database.prisma.electronicDocument.findUniqueOrThrow({
        where: { id: ids.invoice! },
        include: { artifacts: true },
      });
      const authorized = invoice.artifacts.find((x) => x.kind === "AUTHORIZED_XML")!;
      const path = entries.find((name) =>
        name.endsWith(`${invoice.documentNumber}/autorizado.xml`),
      )!;
      expect(sha256(await readFile(join(out, path)))).toBe(authorized.sha256);
      expect(Buffer.from(await readFile(join(out, path)))).toEqual(Buffer.from(authorized.content));
      // SHA256SUMS: el orden de las entradas, todas salvo él mismo, verificable con sha256sum.
      const sums = (await readFile(join(out, "SHA256SUMS"), "utf8")).trim().split("\n");
      expect(entries.at(-1)).toBe("SHA256SUMS");
      expect(sums.map((line) => line.slice(66))).toEqual(entries.slice(0, -1));
      const { stdout } = await run("sha256sum", ["-c", "SHA256SUMS"], {
        env: { ...process.env, LC_ALL: "C" },
        cwd: out,
        maxBuffer: 64 * 2 ** 20,
      });
      expect(
        stdout
          .trim()
          .split("\n")
          .every((line) => line.endsWith(": OK")),
      ).toBe(true);
      expect(result.counts.files).toBe(entries.length);
      // Las respuestas del SRI con su orden, y la truncada tal cual.
      expect(entries.filter((name) => name.includes(`${invoice.documentNumber}/sri/`))).toEqual([
        expect.stringMatching(/\/sri\/001-recepcion\.xml$/),
        expect.stringMatching(/\/sri\/002-autorizacion\.xml$/),
      ]);
      expect(entries.some((name) => name.startsWith("assets/logos/"))).toBe(true);
      // Solo la empresa: ningún comprobante de la otra.
      const other = await db.database.prisma.electronicDocument.findUniqueOrThrow({
        where: { id: ids.other! },
      });
      expect(entries.some((name) => name.includes(other.accessKey))).toBe(false);
      void extras;
    });

    it("falla cerrado ante un artefacto, una respuesta o un logo alterados, sin paquete", async () => {
      const prisma = db.database.prisma;
      const corrupt = async (table: string, trigger: string, where: string, value: string) =>
        prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(
            `ALTER TABLE "${db.name}"."${table}" DISABLE TRIGGER ${trigger}`,
          );
          await tx.$executeRawUnsafe(
            `UPDATE "${db.name}"."${table}" SET ${where === "body" ? "body" : "content"} = set_byte(${where === "body" ? "body" : "content"}, 1, 0) WHERE ${value}`,
          );
          await tx.$executeRawUnsafe(
            `ALTER TABLE "${db.name}"."${table}" ENABLE TRIGGER ${trigger}`,
          );
        });
      // Una respuesta del SRI alterada.
      const triggers = async (table: string) =>
        (
          await prisma.$queryRawUnsafe<{ tgname: string }[]>(
            `SELECT tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
             JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = $1 AND c.relname = $2 AND NOT t.tgisinternal`,
            db.name,
            table,
          )
        ).map((row) => row.tgname);
      const response = (await triggers("sri_response")).find((name) =>
        /append|immutable|update/i.test(name),
      )!;
      await corrupt("sri_response", response, "body", `attempt_id = '${extras.receptionAttempt}'`);
      await expect(generate()).rejects.toEqual(new ExportFailure("DATA_EXPORT_ARTIFACT_INTEGRITY"));
      // Un XML firmado alterado, en una empresa propia.
      const c = await insertFiscalCompany(prisma, "Empresa C", 1);
      const signed = await insertDocument(prisma, c, "SIGNED");
      await corruptArtifact(prisma, db.name, signed.id, "SIGNED_XML");
      await expect(generate({}, c)).rejects.toEqual(
        new ExportFailure("DATA_EXPORT_ARTIFACT_INTEGRITY"),
      );
      // Un logo alterado, en otra.
      const d = await insertFiscalCompany(prisma, "Empresa D", 2);
      await seedPortabilityExtras(prisma, d, (await insertDocument(prisma, d, "AUTHORIZED")).id);
      await completeAuthorizedArtifacts(prisma, d.companyId);
      const asset = (await triggers("configuration_asset")).find((name) =>
        /append|immutable|update/i.test(name),
      )!;
      await corrupt("configuration_asset", asset, "content", `company_id = '${d.companyId}'`);
      await expect(generate({}, d)).rejects.toEqual(
        new ExportFailure("DATA_EXPORT_ARTIFACT_INTEGRITY"),
      );
      // La generación nunca deja paquetes completos de una exportación fallida: el contenedor
      // aborta y el job borra su parcial.
    });

    it("falla con ARTIFACT_MISSING si un autorizado no tiene su XML autorizado", async () => {
      const prisma = db.database.prisma;
      const lone = await insertDocument(prisma, b, "AUTHORIZED");
      await expect(generate({}, b)).rejects.toEqual(
        new ExportFailure("DATA_EXPORT_ARTIFACT_MISSING"),
      );
      await completeAuthorizedArtifacts(prisma, b.companyId);
      void lone;
    });

    it("sin la reserva de disco falla antes de copiar los artefactos, sin parcial", async () => {
      let calls = 0;
      await expect(
        generate({
          files: {
            ...generatorDeps(db, root).files,
            freeBytes: () => Promise.resolve((calls += 1) === 1 ? 10 * 2 ** 30 : 1024),
          },
        }),
      ).rejects.toEqual(new ExportFailure("DATA_EXPORT_INSUFFICIENT_SPACE"));
      expect(calls).toBe(2);
    });
  });
});
