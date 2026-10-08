// Dirección de las dependencias de los reportes (add-reports-export, design D1): nadie importa
// `reports`, salvo el arranque que lo compone, y `reports` no lee tablas: ni las de otros módulos
// ni las propias, que no tiene. Lee los datos solo por las fuentes que exportan sus dueños y que
// `main.ts` le pasa como puertos, y no importa otros módulos salvo la autorización (`identity`) y la
// auditoría (`audit`).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, posix, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const SCHEMA = fileURLToPath(new URL("../../prisma/schema.prisma", import.meta.url));

type SourceFile = { path: string; content: string };

/** El único archivo fuera de `reports` que lo compone: el arranque. */
const COMPOSITION = new Set(["main.ts"]);
/** Los módulos que `reports` puede importar. */
const ALLOWED_MODULES = new Set(["reports", "identity", "audit"]);
const IMPORT = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;

/** Delegados de Prisma y nombres de tabla de todos los modelos del esquema. */
function tablesOf(schema: string): { delegates: string[]; tables: string[] } {
  const delegates: string[] = [];
  const tables: string[] = [];
  for (const [, model = "", body = ""] of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    delegates.push(model.charAt(0).toLowerCase() + model.slice(1));
    tables.push(/@@map\("([^"]+)"\)/.exec(body)?.[1] ?? model);
  }
  return { delegates, tables };
}

/** El módulo de un import relativo desde `path`, o null si no apunta a `modules/`. */
function importedModule(path: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const target = posix.normalize(posix.join(posix.dirname(path), specifier));
  return /^modules\/([^/]+)\//.exec(target)?.[1] ?? null;
}

export function reportsOffenders(files: readonly SourceFile[], schema: string): string[] {
  const { delegates, tables } = tablesOf(schema);
  const delegateAccess = new RegExp(`\\.(?:${delegates.join("|")})\\.`);
  const tableAccess = new RegExp(
    `"(?:${tables.join("|")})"|\\b(?:from|FROM|join|JOIN|into|INTO|update|UPDATE)\\s+(?:${tables.join("|")})\\b`,
  );
  const offenders: string[] = [];
  for (const { path, content } of files) {
    if (path.startsWith("generated/")) continue;
    const isReports = path.startsWith("modules/reports/");
    const modules = [...content.matchAll(IMPORT)].map(([, specifier = ""]) =>
      importedModule(path, specifier),
    );
    if (!isReports) {
      if (!COMPOSITION.has(path) && modules.includes("reports")) {
        offenders.push(`${path}: importa reports`);
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

describe("dirección de las dependencias de los reportes", () => {
  const schema = readFileSync(SCHEMA, "utf8");

  it("nadie importa reports, y reports no lee tablas ni importa otros módulos", () => {
    expect(reportsOffenders(sourceFiles(SRC), schema)).toEqual([]);
  });

  it("las fuentes de los reportes viven en sus módulos dueños", () => {
    const owners = [
      "modules/fiscal/infrastructure/reports/document-sources.ts",
      "modules/withholding-receipts/infrastructure/report-source.ts",
      "modules/inventory/infrastructure/report-sources.ts",
      "modules/products/infrastructure/report-products.ts",
      "modules/parties/infrastructure/report-source.ts",
      "modules/taxpayer/infrastructure/current-environment.ts",
    ];
    for (const owner of owners) {
      expect(statSync(join(SRC, owner)).isFile(), owner).toBe(true);
    }
    expect(dirname(owners[0]!)).toBe("modules/fiscal/infrastructure/reports");
  });

  it("el arranque compone cada fuente como puerto de reports", () => {
    const main = readFileSync(join(SRC, "main.ts"), "utf8");
    for (const composed of [
      "reportsModule(",
      "createIssuedDocumentsReportSource(",
      "createInvoicesReportSource(",
      "createWithholdingsReportSource(",
      "createInventoryMovementsReportSource(",
      "createReportProductsSource(",
      "reportProductLabels",
      "inventoryBalanceReads.initializedProductIds",
      "inventoryBalanceReads.balances",
      "createPartiesReportSource(",
      "currentEnvironment",
      "reportPointCodes",
      "invoiceReportAmounts",
      "purchaseSettlementReportAmounts",
      "creditNoteReportAmounts",
      "debitNoteReportAmounts",
      "shippingGuideReportAmounts",
      "withholdingReportAmounts",
    ]) {
      expect(main, composed).toContain(composed);
    }
  });

  it("detecta cada violación en archivos de ejemplo", () => {
    expect(
      reportsOffenders(
        [
          {
            path: "modules/fiscal/application/x.ts",
            content: 'import { r } from "../../reports/application/reports.ts";',
          },
          {
            path: "modules/inventory/infrastructure/x.ts",
            content: 'const lazy = await import("../../reports/infrastructure/index.ts");',
          },
          {
            path: "modules/reports/application/x.ts",
            content: 'import type { D } from "../../fiscal/domain/document.ts";',
          },
          {
            path: "modules/reports/infrastructure/x.ts",
            content: "await db.electronicDocument.findMany();",
          },
          {
            path: "modules/reports/infrastructure/y.ts",
            content: 'await db.$queryRaw`SELECT 1 FROM "party"`;',
          },
          {
            path: "modules/reports/infrastructure/z.ts",
            content: "await tx.auditEvent.create({ data });",
          },
          // Permitidos: el arranque, la autorización, la auditoría, la plataforma y los contratos.
          {
            path: "main.ts",
            content: 'import { reportsModule } from "./modules/reports/infrastructure/index.ts";',
          },
          {
            path: "modules/reports/application/ok.ts",
            content: [
              'import type { Authorizer } from "../../identity/application/authorization.ts";',
              'import { createAuditLog } from "../../audit/infrastructure/prisma-audit-log.ts";',
              'import { sqlReportSource } from "../../../platform/db/report-source.ts";',
              'import { REPORT_IDS } from "@facturador/contracts";',
              "const total = await sources.issued.count(db, companyId, filters);",
              "await tx.$executeRaw`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`;",
            ].join("\n"),
          },
        ],
        schema,
      ),
    ).toEqual([
      "modules/fiscal/application/x.ts: importa reports",
      "modules/inventory/infrastructure/x.ts: importa reports",
      "modules/reports/application/x.ts: importa otro módulo",
      "modules/reports/infrastructure/x.ts: lee tablas",
      "modules/reports/infrastructure/y.ts: lee tablas",
      "modules/reports/infrastructure/y.ts: escribe SQL",
      "modules/reports/infrastructure/z.ts: lee tablas",
    ]);
  });
});
