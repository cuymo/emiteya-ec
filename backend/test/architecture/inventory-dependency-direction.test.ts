// Dirección de las dependencias del inventario (add-minimal-inventory, design D1 y D5): el inventario
// reacciona a la autorización, nunca al revés. `fiscal`, `invoices` y `products` no lo importan: el
// seguidor de la autorización y las lecturas que reciben los compone el arranque.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));

type SourceFile = { path: string; content: string };

/** El único archivo fuera del inventario que lo compone: el arranque. */
const COMPOSITION = new Set(["main.ts"]);
const isInventory = (path: string) => path.startsWith("modules/inventory/");
/** El código de la transmisión al SRI (add-sri-transmission) y el motor SRI. */
const isTransmission = (path: string) =>
  /^modules\/sri-engine\//.test(path) ||
  /^modules\/fiscal\/(?:application|infrastructure|domain)\/(?:transmission[^/]*|transmit-handler|authorize-handler|reconcile-handler|prisma-sri-evidence|reconciliation-unit-of-work|document-transitions)\.ts$/.test(
    path,
  );
const IMPORTS_INVENTORY = /(?:from|import)\s*\(?\s*["'][^"']*\/inventory\/[^"']*["']/;

export function inventoryOffenders(files: readonly SourceFile[]): string[] {
  const offenders: string[] = [];
  for (const { path, content } of files) {
    if (path.startsWith("generated/") || isInventory(path) || COMPOSITION.has(path)) continue;
    if (IMPORTS_INVENTORY.test(content)) offenders.push(`${path}: importa el inventario`);
    if (isTransmission(path) && content.includes("SALIDA_FACTURA")) {
      offenders.push(`${path}: nombra la salida de inventario`);
    }
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

describe("dirección de las dependencias del inventario", () => {
  it("la emisión, la transmisión y los productos no dependen del inventario", () => {
    expect(inventoryOffenders(sourceFiles(SRC))).toEqual([]);
  });

  it("el paso de la transmisión solo conoce el puerto genérico de seguidores", () => {
    const step = readFileSync(join(SRC, "modules/fiscal/application/transmission-step.ts"), "utf8");
    expect(step).toContain('from "./document-transitions.ts"');
    expect(step).not.toMatch(/inventory|inventario|stock/i);
  });

  it("el arranque compone el seguidor de la autorización y las lecturas del inventario", () => {
    const main = readFileSync(join(SRC, "main.ts"), "utf8");
    expect(main).toContain("inventoryOutflowFollower(");
    expect(main).toContain("stockReads: inventoryStockReads");
  });

  it("detecta cada violación en archivos de ejemplo", () => {
    expect(
      inventoryOffenders([
        {
          path: "modules/fiscal/application/transmission-step.ts",
          content:
            'import { inventoryOutflowFollower } from "../../inventory/application/invoice-outflow.ts";',
        },
        {
          path: "modules/fiscal/application/authorize-handler.ts",
          content: 'const type = "SALIDA_FACTURA";',
        },
        {
          path: "modules/invoices/application/emission.ts",
          content: 'import { inventoryStockReads } from "../../inventory/infrastructure/index.ts";',
        },
        {
          path: "modules/products/application/products.ts",
          content: 'const lazy = await import("../../inventory/infrastructure/index.ts");',
        },
        // Permitidos: el propio inventario y la composición del arranque.
        {
          path: "modules/inventory/application/invoice-outflow.ts",
          content: 'import { x } from "../domain/stock.ts"; const t = "SALIDA_FACTURA";',
        },
        {
          path: "main.ts",
          content:
            'import { inventoryStockReads } from "./modules/inventory/infrastructure/index.ts";',
        },
      ]),
    ).toEqual([
      "modules/fiscal/application/transmission-step.ts: importa el inventario",
      "modules/fiscal/application/authorize-handler.ts: nombra la salida de inventario",
      "modules/invoices/application/emission.ts: importa el inventario",
      "modules/products/application/products.ts: importa el inventario",
    ]);
  });
});
