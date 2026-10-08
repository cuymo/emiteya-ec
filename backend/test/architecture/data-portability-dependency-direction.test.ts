// Dirección de las dependencias de la portabilidad (add-data-portability, design D1): nadie importa
// `data-portability`, salvo el arranque que lo compone, y `data-portability` no importa `reports` ni
// lee tablas de otros módulos. Lee los datos de la empresa solo por las fuentes que exportan sus
// dueños y que `main.ts` le pasa como puertos; su única tabla es `data_export`. Solo importa la
// autorización (`identity`) y la auditoría (`audit`).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const SCHEMA = fileURLToPath(new URL("../../prisma/schema.prisma", import.meta.url));
const MODULE = "data-portability";

type SourceFile = { path: string; content: string };

/** El único archivo fuera del módulo que lo compone: el arranque. */
const COMPOSITION = new Set(["main.ts"]);
/** Los módulos que la portabilidad puede importar. */
const ALLOWED_MODULES = new Set([MODULE, "identity", "audit"]);
/** Su propia tabla y su delegado de Prisma. */
const OWN = { delegate: "dataExport", table: "data_export" };
const IMPORT = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;

function tablesOf(schema: string): { delegates: string[]; tables: string[] } {
  const delegates: string[] = [];
  const tables: string[] = [];
  for (const [, model = "", body = ""] of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    const delegate = model.charAt(0).toLowerCase() + model.slice(1);
    const table = /@@map\("([^"]+)"\)/.exec(body)?.[1] ?? model;
    if (delegate === OWN.delegate) continue;
    delegates.push(delegate);
    tables.push(table);
  }
  return { delegates, tables };
}

function importedModule(path: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const target = posix.normalize(posix.join(posix.dirname(path), specifier));
  return /^modules\/([^/]+)\//.exec(target)?.[1] ?? null;
}

export function portabilityOffenders(files: readonly SourceFile[], schema: string): string[] {
  const { delegates, tables } = tablesOf(schema);
  const delegateAccess = new RegExp(`\\.(?:${delegates.join("|")})\\.`);
  const tableAccess = new RegExp(
    `"(?:${tables.join("|")})"|\\b(?:from|FROM|join|JOIN|into|INTO|update|UPDATE)\\s+(?:${tables.join("|")})\\b`,
  );
  const offenders: string[] = [];
  for (const { path, content } of files) {
    if (path.startsWith("generated/")) continue;
    const isPortability = path.startsWith(`modules/${MODULE}/`);
    const modules = [...content.matchAll(IMPORT)].map(([, specifier = ""]) =>
      importedModule(path, specifier),
    );
    if (!isPortability) {
      if (!COMPOSITION.has(path) && modules.includes(MODULE)) {
        offenders.push(`${path}: importa ${MODULE}`);
      }
      continue;
    }
    if (modules.includes("reports")) offenders.push(`${path}: importa reports`);
    else if (modules.some((module) => module !== null && !ALLOWED_MODULES.has(module))) {
      offenders.push(`${path}: importa otro módulo`);
    }
    if (delegateAccess.test(content) || tableAccess.test(content)) {
      offenders.push(`${path}: lee tablas de otros módulos`);
    }
  }
  return offenders;
}

function sourceFiles(dir: string): SourceFile[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts")
      ? [{ path: relative(SRC, path).split("\\").join("/"), content: readFileSync(path, "utf8") }]
      : [];
  });
}

describe("dirección de las dependencias de la portabilidad", () => {
  const schema = readFileSync(SCHEMA, "utf8");

  it("nadie importa data-portability, y data-portability no importa reports ni lee tablas ajenas", () => {
    expect(portabilityOffenders(sourceFiles(SRC), schema)).toEqual([]);
  });

  it("las fuentes de la portabilidad viven en sus módulos dueños", () => {
    for (const owner of [
      "modules/taxpayer/infrastructure/portability-sources.ts",
      "modules/fiscal/infrastructure/portability/portability-sources.ts",
      "modules/catalogs/infrastructure/portability-sources.ts",
      "modules/signing/infrastructure/portability-sources.ts",
      "modules/identity/infrastructure/portability-sources.ts",
      "modules/parties/infrastructure/portability-sources.ts",
      "modules/products/infrastructure/portability-sources.ts",
      "modules/inventory/infrastructure/portability-sources.ts",
      "modules/audit/infrastructure/portability-sources.ts",
      "modules/withholding-receipts/infrastructure/portability-sources.ts",
    ]) {
      expect(statSync(join(SRC, owner)).isFile(), owner).toBe(true);
    }
  });

  it("detecta cada violación en archivos de ejemplo", () => {
    expect(
      portabilityOffenders(
        [
          {
            path: "modules/fiscal/application/x.ts",
            content: 'import { p } from "../../data-portability/application/ports.ts";',
          },
          {
            path: "modules/data-portability/application/x.ts",
            content: 'import { REPORT_DEFINITIONS } from "../../reports/domain/definitions.ts";',
          },
          {
            path: "modules/data-portability/application/y.ts",
            content: 'import type { D } from "../../fiscal/domain/document.ts";',
          },
          {
            path: "modules/data-portability/infrastructure/x.ts",
            content: "await db.signingCertificateSecret.findMany();",
          },
          {
            path: "modules/data-portability/infrastructure/y.ts",
            content: 'await db.$queryRaw`SELECT 1 FROM "electronic_document"`;',
          },
          // Permitidos: el arranque, su propia tabla, la autorización, la auditoría y la plataforma.
          {
            path: "main.ts",
            content:
              'import { dataPortabilityModule } from "./modules/data-portability/infrastructure/index.ts";',
          },
          {
            path: "modules/data-portability/infrastructure/ok.ts",
            content: [
              'import type { Authorizer } from "../../identity/application/authorization.ts";',
              'import { createAuditLog } from "../../audit/infrastructure/prisma-audit-log.ts";',
              'import { writeXlsx } from "../../../platform/xlsx/xlsx-writer.ts";',
              "await db.dataExport.update({ where: { id }, data });",
              "for await (const rows of sources.documents(db, companyId, 1000)) void rows;",
            ].join("\n"),
          },
        ],
        schema,
      ),
    ).toEqual([
      "modules/fiscal/application/x.ts: importa data-portability",
      "modules/data-portability/application/x.ts: importa reports",
      "modules/data-portability/application/y.ts: importa otro módulo",
      "modules/data-portability/infrastructure/x.ts: lee tablas de otros módulos",
      "modules/data-portability/infrastructure/y.ts: lee tablas de otros módulos",
    ]);
  });
});
