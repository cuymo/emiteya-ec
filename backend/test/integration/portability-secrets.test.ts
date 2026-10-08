// Exclusión de los secretos y de los datos excluidos (add-data-portability, design D6; tarea 4.4),
// en dos capas: las proyecciones de las fuentes no tienen ninguna columna excluida, y el paquete
// completo no contiene ninguno de los marcadores sembrados, ni en claro ni en base64. Nunca se
// descifra un secreto para probar su ausencia.
import { readFile, readdir, stat } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generatePackage } from "../../src/modules/data-portability/application/generate.ts";
import type { PortabilitySources } from "../../src/modules/data-portability/application/ports.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertFiscalCompany, type FiscalCompany } from "./fiscal-harness.ts";
import {
  SECRET_MARKERS,
  collect,
  completeAuthorizedArtifacts,
  generatorDeps,
  portabilitySources,
  seedPortabilityExtras,
} from "./portability-harness.ts";
import { seedReportData } from "./reports-api-harness.ts";
import { extractZip } from "../support/zip-inspect.ts";

const SRC = fileURLToPath(new URL("../../src/modules/", import.meta.url));
const DRAFT_MARKER = "MARCADOR-BORRADOR-SIN-EMITIR";
/** Tablas y columnas que ninguna fuente de portabilidad puede leer. */
const FORBIDDEN_SQL =
  /signing_certificate_secret|p12_ciphertext|password_ciphertext|wrapped_key|key_check|"account"|"session"|"verification"|"invitation"|"ipAddress"|"userAgent"|u\.password|_draft\b/;
const FORBIDDEN_KEYS = new Set([
  "p12Ciphertext",
  "passwordCiphertext",
  "wrappedKey",
  "wrappedKeyNonce",
  "keyCheck",
  "keyVersion",
  "password",
  "token",
  "ipAddress",
  "userAgent",
  "value",
]);

async function walk(dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const name of await readdir(dir)) {
    const path = join(dir, name);
    if ((await stat(path)).isDirectory()) files.push(...(await walk(path)));
    else files.push(path);
  }
  return files;
}

describe("exclusión de los secretos de la portabilidad", () => {
  let db: MigratedSchema;
  let a: FiscalCompany;
  let root: string;

  beforeAll(async () => {
    db = await createMigratedSchema("portability_secrets");
    const prisma = db.database.prisma;
    a = await insertFiscalCompany(prisma, "Empresa A", 2);
    const ids = await seedReportData(prisma, a);
    await seedPortabilityExtras(prisma, a, ids.invoice!);
    await completeAuthorizedArtifacts(prisma, a.companyId);
    await prisma.purchaseSettlementDraft.create({
      data: {
        companyId: a.companyId,
        lines: [{ description: DRAFT_MARKER, quantity: "1", unitPrice: "1.00" }],
        payments: [],
        createdBy: a.adminId,
        updatedBy: a.adminId,
      },
    });
    root = await mkdtemp(join(tmpdir(), "portabilidad-secretos-"));
  }, 300_000);

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
    await db?.drop();
  });

  it("capa A: ninguna fuente lee una tabla o una columna excluida", async () => {
    // El SQL de cada fuente de portabilidad, en su módulo dueño.
    const owners = (await walk(SRC)).filter((path) => /portability-sources\.ts$/.test(path));
    expect(owners.length).toBe(10);
    for (const owner of owners) {
      // Solo el código: los comentarios pueden nombrar lo que la fuente nunca lee.
      const code = (await readFile(owner, "utf8"))
        .split("\n")
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join("\n");
      expect([owner, FORBIDDEN_SQL.exec(code)?.[0]]).toEqual([owner, undefined]);
    }
    // Las filas de cada conjunto: ninguna clave excluida y ningún marcador en sus valores.
    const sources = portabilitySources(db.name);
    const datasets = Object.entries(sources).filter(
      ([, value]) => typeof value === "object" && value !== null && "batches" in value,
    ) as [string, PortabilitySources["users"]][];
    expect(datasets.length).toBe(21);
    const markers = Object.values(SECRET_MARKERS);
    for (const [name, dataset] of datasets) {
      const rows = await collect(db.database.prisma, dataset, a.companyId);
      for (const row of rows as Record<string, unknown>[]) {
        expect([name, Object.keys(row).filter((key) => FORBIDDEN_KEYS.has(key))]).toEqual([
          name,
          [],
        ]);
        const text = JSON.stringify(row);
        for (const marker of [...markers, DRAFT_MARKER]) {
          expect([name, marker, text.includes(marker)]).toEqual([name, marker, false]);
        }
      }
    }
  });

  it("capa B: el paquete completo no contiene ningún marcador, en claro ni en base64", async () => {
    const deps = generatorDeps(db, root);
    await deps.packages.init();
    const workDir = await deps.packages.workDir("00000000-0000-4000-8000-000000000009", 1);
    const packagePath = join(root, "paquete.zip");
    await generatePackage(deps, {
      companyId: a.companyId,
      workDir,
      packagePath,
      signal: new AbortController().signal,
      progress: async () => {},
    });
    const out = join(root, "extraido");
    await extractZip(packagePath, out);
    // Los libros XLSX son ZIP: se buscan también dentro, ya descomprimidos.
    const { readXlsx } = await import("../support/xlsx-reader.ts");
    const markers = [...Object.values(SECRET_MARKERS), DRAFT_MARKER];
    const needles = markers.flatMap((marker) => [
      Buffer.from(marker),
      Buffer.from(Buffer.from(marker).toString("base64").slice(0, 16)),
    ]);
    const files = await walk(out);
    expect(files.length).toBeGreaterThan(20);
    for (const file of files) {
      const contents = [await readFile(file)];
      if (file.endsWith(".xlsx")) {
        const book = readXlsx(file);
        contents.push(...[...book.parts.values()].map((xml) => Buffer.from(xml)));
      }
      for (const content of contents)
        for (const needle of needles)
          expect([file, needle.toString(), content.includes(needle)]).toEqual([
            file,
            needle.toString(),
            false,
          ]);
    }
    // Las exclusiones están declaradas en el manifiesto y en LEEME.txt.
    const manifest = JSON.parse(await readFile(join(out, "manifest.json"), "utf8")) as {
      exclusions: { data: string }[];
    };
    const excluded = manifest.exclusions.map((e) => e.data).join("\n");
    expect(excluded).toMatch(/firma electrónica/);
    expect(excluded).toMatch(/autenticación/);
    expect(excluded).toMatch(/borradores/);
    const readme = await readFile(join(out, "LEEME.txt"), "utf8");
    expect(readme).toMatch(/NO es un respaldo/);
    expect(readme).toMatch(/borradores/);
  });
});
