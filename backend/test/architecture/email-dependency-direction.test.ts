// Dirección de las dependencias del correo (add-email-delivery, design D1): `email` solo lee y
// escribe sus tablas (`email_*`), lee los comprobantes y los correos de los terceros por las fuentes
// que exportan `fiscal` y `parties` y que `main.ts` le pasa como puertos, y no importa otros módulos
// salvo la autorización (`identity`) y la auditoría (`audit`). Fuera de `email`, solo el arranque lo
// compone (y `fiscal` conoce al seguidor del RIDE solo por su tipo propio).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const SCHEMA = fileURLToPath(new URL("../../prisma/schema.prisma", import.meta.url));

type SourceFile = { path: string; content: string };

const COMPOSITION = new Set(["main.ts"]);
const ALLOWED_MODULES = new Set(["email", "identity", "audit"]);
const OWN_TABLE = /^email_/;
const IMPORT = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;

function foreignTablesOf(schema: string): { delegates: string[]; tables: string[] } {
  const delegates: string[] = [];
  const tables: string[] = [];
  for (const [, model = "", body = ""] of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    const table = /@@map\("([^"]+)"\)/.exec(body)?.[1] ?? model;
    if (OWN_TABLE.test(table)) continue;
    delegates.push(model.charAt(0).toLowerCase() + model.slice(1));
    tables.push(table);
  }
  return { delegates, tables };
}

function importedModule(path: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const target = posix.normalize(posix.join(posix.dirname(path), specifier));
  return /^modules\/([^/]+)\//.exec(target)?.[1] ?? null;
}

export function emailOffenders(files: readonly SourceFile[], schema: string): string[] {
  const { delegates, tables } = foreignTablesOf(schema);
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
    if (!path.startsWith("modules/email/")) {
      if (!COMPOSITION.has(path) && modules.includes("email")) {
        offenders.push(`${path}: importa email`);
      }
      continue;
    }
    if (modules.some((module) => module !== null && !ALLOWED_MODULES.has(module))) {
      offenders.push(`${path}: importa otro módulo`);
    }
    if (delegateAccess.test(content) || tableAccess.test(content)) {
      offenders.push(`${path}: lee tablas ajenas`);
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

describe("dirección de las dependencias del correo", () => {
  const schema = readFileSync(SCHEMA, "utf8");

  it("email solo lee sus tablas e importa identity y audit; fuera de email, solo el arranque lo compone", () => {
    expect(emailOffenders(sourceFiles(SRC), schema)).toEqual([]);
  });

  it("el arranque compone las fuentes de fiscal y parties como puertos del correo", () => {
    const main = readFileSync(join(SRC, "main.ts"), "utf8");
    for (const composed of [
      "emailModule(",
      "createDeliverableDocumentSource(",
      "createPartyEmailSource(",
      "followers: email.rideFollowers",
      "handlers: email.handlers",
    ]) {
      expect(main, composed).toContain(composed);
    }
  });

  it("detecta cada violación en archivos de ejemplo", () => {
    expect(
      emailOffenders(
        [
          {
            path: "modules/fiscal/application/x.ts",
            content: 'import { e } from "../../email/application/settings.ts";',
          },
          {
            path: "modules/email/application/x.ts",
            content: 'import { p } from "../../parties/application/parties.ts";',
          },
          {
            path: "modules/email/infrastructure/x.ts",
            content: "const party = await db.party.findFirst({});",
          },
          {
            path: "modules/email/infrastructure/y.ts",
            content: 'await db.$queryRaw`SELECT 1 FROM "electronic_document"`;',
          },
          {
            path: "modules/email/infrastructure/ok.ts",
            content: "await db.emailDelivery.findFirst({}); await db.emailSettings.findUnique({});",
          },
        ],
        schema,
      ),
    ).toEqual([
      "modules/fiscal/application/x.ts: importa email",
      "modules/email/application/x.ts: importa otro módulo",
      "modules/email/infrastructure/x.ts: lee tablas ajenas",
      "modules/email/infrastructure/y.ts: lee tablas ajenas",
    ]);
  });
});
