// Dirección de las dependencias del tablero de Inicio: nadie importa `dashboard`, salvo el arranque
// que lo compone, y `dashboard` no lee tablas ni escribe SQL. Lee los datos solo por las lecturas que
// exportan sus dueños y que `main.ts` le pasa como puertos, y no importa otros módulos salvo la
// autorización (`identity`) y la fecha de Ecuador (`catalogs`).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const SCHEMA = fileURLToPath(new URL("../../prisma/schema.prisma", import.meta.url));

type SourceFile = { path: string; content: string };

const COMPOSITION = new Set(["main.ts"]);
const ALLOWED_MODULES = new Set(["dashboard", "identity", "catalogs"]);
const IMPORT = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;

function tablesOf(schema: string): { delegates: string[]; tables: string[] } {
  const delegates: string[] = [];
  const tables: string[] = [];
  for (const [, model = "", body = ""] of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    delegates.push(model.charAt(0).toLowerCase() + model.slice(1));
    tables.push(/@@map\("([^"]+)"\)/.exec(body)?.[1] ?? model);
  }
  return { delegates, tables };
}

function importedModule(path: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const target = posix.normalize(posix.join(posix.dirname(path), specifier));
  return /^modules\/([^/]+)\//.exec(target)?.[1] ?? null;
}

function dashboardOffenders(files: readonly SourceFile[], schema: string): string[] {
  const { delegates, tables } = tablesOf(schema);
  const delegateAccess = new RegExp(`\\.(?:${delegates.join("|")})\\.`);
  const tableAccess = new RegExp(
    `"(?:${tables.join("|")})"|\\b(?:from|FROM|join|JOIN|into|INTO|update|UPDATE)\\s+(?:${tables.join("|")})\\b`,
  );
  const offenders: string[] = [];
  for (const { path, content } of files) {
    if (path.startsWith("generated/")) continue;
    const modules = [...content.matchAll(IMPORT)].map(([, specifier = ""]) =>
      importedModule(path, specifier),
    );
    if (!path.startsWith("modules/dashboard/")) {
      if (!COMPOSITION.has(path) && modules.includes("dashboard")) {
        offenders.push(`${path}: importa dashboard`);
      }
      continue;
    }
    if (modules.some((module) => module !== null && !ALLOWED_MODULES.has(module))) {
      offenders.push(`${path}: importa otro módulo`);
    }
    if (delegateAccess.test(content) || tableAccess.test(content)) {
      offenders.push(`${path}: lee tablas`);
    }
    if (/\$queryRaw|\$executeRawUnsafe|Prisma\.(?:sql|raw)\b/.test(content)) {
      offenders.push(`${path}: escribe SQL`);
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

describe("dirección de las dependencias del tablero", () => {
  it("nadie importa dashboard, y dashboard no lee tablas ni importa otros módulos", () => {
    expect(dashboardOffenders(sourceFiles(SRC), readFileSync(SCHEMA, "utf8"))).toEqual([]);
  });

  it("detecta un acceso a tablas desde dashboard", () => {
    const schema = 'model Party {\n  id String\n  @@map("party")\n}\n';
    expect(
      dashboardOffenders(
        [{ path: "modules/dashboard/x.ts", content: 'await db.$queryRaw`SELECT 1 FROM "party"`' }],
        schema,
      ),
    ).toEqual(["modules/dashboard/x.ts: lee tablas", "modules/dashboard/x.ts: escribe SQL"]);
  });
});
