// Fronteras de los módulos de terceros y productos (add-parties-and-products, design D1): cada
// módulo es el único que lee y escribe sus tablas, `catalogs` no importa `parties` ni `products`, y
// estos no se importan entre sí. La frontera de las tablas de `catalogs` la fija
// test/catalogs/architecture.test.ts.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));

type SourceFile = { path: string; content: string };

/**
 * Acceso a las tablas de un módulo: delegados de Prisma o SQL con el nombre de la tabla. Las palabras
 * de SQL valen en mayúsculas o minúsculas; el nombre de la tabla, como lo escribe la base (en
 * minúsculas), para no confundirlo con un valor como `"PARTY"` o `"PRODUCT"` (add-shipping-guides).
 */
const SQL = "(?:from|FROM|join|JOIN|into|INTO|update|UPDATE)";
const TABLES: Record<string, RegExp> = {
  parties: new RegExp(`\\.party\\.|\\b${SQL}\\s+"?party"?\\b|"party"`),
  products: new RegExp(
    `\\.(?:product|productTax)\\.|\\b${SQL}\\s+"?(?:product|product_tax)"?\\b|"product(?:_tax)?"`,
  ),
  // add-minimal-inventory, design D1: el saldo y el kárdex son del inventario.
  inventory: new RegExp(
    `\\.(?:stockBalance|stockMovement)\\.|\\b${SQL}\\s+"?stock_(?:balance|movement)"?\\b|"stock_(?:balance|movement)"`,
  ),
};

/** Importaciones prohibidas por módulo de origen. */
const FORBIDDEN_IMPORTS: Record<string, RegExp> = {
  catalogs: /from\s+["'][^"']*\/(?:parties|products)\//,
  parties: /from\s+["'][^"']*\/products\//,
  products: /from\s+["'][^"']*\/parties\//,
};

export function boundaryOffenders(files: readonly SourceFile[]): string[] {
  const offenders: string[] = [];
  for (const { path, content } of files) {
    if (path.startsWith("generated/")) continue;
    const owner = /^modules\/([^/]+)\//.exec(path)?.[1];
    for (const [module, pattern] of Object.entries(TABLES)) {
      if (owner !== module && pattern.test(content)) offenders.push(`${path}: tablas de ${module}`);
    }
    const forbidden = owner ? FORBIDDEN_IMPORTS[owner] : undefined;
    if (forbidden?.test(content)) offenders.push(`${path}: importación prohibida`);
  }
  return offenders;
}

function sourceFiles(dir: string): SourceFile[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts")
      ? [{ path: relative(SRC, path), content: readFileSync(path, "utf8") }]
      : [];
  });
}

describe("fronteras de parties y products", () => {
  it("el código actual las respeta", () => {
    expect(boundaryOffenders(sourceFiles(SRC))).toEqual([]);
  });

  it("detecta cada violación en archivos de ejemplo", () => {
    expect(
      boundaryOffenders([
        { path: "modules/fiscal/application/x.ts", content: "await db.party.findMany()" },
        {
          path: "modules/catalogs/application/x.ts",
          content: 'await tx.$queryRaw`SELECT 1 FROM "product_tax"`',
        },
        {
          path: "modules/catalogs/application/y.ts",
          content: 'import { a } from "../../parties/application/a.ts";',
        },
        {
          path: "modules/parties/application/x.ts",
          content: 'import { b } from "../../products/domain/b.ts";',
        },
        {
          path: "modules/products/application/x.ts",
          content: 'import { c } from "../../parties/domain/c.ts";',
        },
        { path: "modules/products/application/z.ts", content: "await db.product.count()" },
        { path: "modules/invoices/application/x.ts", content: "await db.stockBalance.findMany()" },
        { path: "modules/inventory/application/x.ts", content: "await db.product.findMany()" },
        {
          path: "modules/inventory/infrastructure/x.ts",
          content: "await db.stockMovement.create()",
        },
        { path: "generated/prisma/x.ts", content: "db.party.findMany()" },
        { path: "modules/fiscal/application/y.ts", content: "SELECT id from party WHERE 1" },
        // Un valor en mayúsculas no es la tabla (add-shipping-guides).
        {
          path: "modules/shipping-guides/domain/x.ts",
          content: 'const kind = "PARTY"; const suggestion = "PRODUCT";',
        },
      ]),
    ).toEqual([
      "modules/fiscal/application/x.ts: tablas de parties",
      "modules/catalogs/application/x.ts: tablas de products",
      "modules/catalogs/application/y.ts: importación prohibida",
      "modules/parties/application/x.ts: importación prohibida",
      "modules/products/application/x.ts: importación prohibida",
      "modules/invoices/application/x.ts: tablas de inventory",
      "modules/inventory/application/x.ts: tablas de products",
      "modules/fiscal/application/y.ts: tablas de parties",
    ]);
  });
});
