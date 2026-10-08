// Dirección de las dependencias de la liquidación de compra (add-purchase-settlements, design D1): la
// liquidación usa las operaciones exportadas de `fiscal` (también las primitivas neutrales de los
// importes), `taxpayer`, `catalogs`, `sri-engine` y `signing`, y lee terceros y productos por los
// puertos `PurchaseSupplierReader` y `PurchaseProductReader` que compone el arranque. Ningún módulo
// importa `purchase-settlements` (solo el arranque), y la liquidación no importa `inventory`,
// `invoices`, `parties`, `products` ni otro comprobante: no mueve stock, no crea compras ni
// retenciones y no asigna roles.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));

type SourceFile = { path: string; content: string };

const PURCHASE = /^modules\/purchase-settlements\//;
const IMPORTS_PURCHASE = /(?:from|import)\s*\(?\s*["'][^"']*\/purchase-settlements\/[^"']*["']/;
/** Lo que la liquidación no puede importar: el inventario, terceros, productos y los demás comprobantes. */
const IMPORTS_FORBIDDEN =
  /(?:from|import)\s*\(?\s*["'][^"']*\/(?:inventory|invoices|parties|products|credit-notes|debit-notes|withholding-receipts|shipping-guides)\/[^"']*["']/;

export function purchaseSettlementOffenders(files: readonly SourceFile[]): string[] {
  return files.flatMap(({ path, content }) => [
    ...(path !== "main.ts" && !PURCHASE.test(path) && IMPORTS_PURCHASE.test(content)
      ? [`${path}: importa la liquidación de compra`]
      : []),
    ...(PURCHASE.test(path) && IMPORTS_FORBIDDEN.test(content)
      ? [`${path}: importa el inventario, terceros, productos u otro comprobante`]
      : []),
  ]);
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

describe("dirección de las dependencias de la liquidación de compra", () => {
  it("nadie depende de la liquidación, salvo el arranque, ni ella del inventario, terceros, productos u otros comprobantes", () => {
    expect(purchaseSettlementOffenders(sourceFiles(SRC))).toEqual([]);
  });

  it("el arranque compone los proveedores, los productos y la firma con el perfil de la liquidación", () => {
    const main = readFileSync(join(SRC, "main.ts"), "utf8");
    const module = main.slice(main.indexOf("...purchaseSettlementsModule("));
    const options = module.slice(0, module.indexOf(").routers"));
    expect(options).toContain("suppliers: purchaseSupplierReader");
    expect(options).toContain("products: productReader");
    expect(options).toContain("documentSigning.pipeline(purchaseSettlementSigningProfile())");
    // La liquidación no recibe facturas, capacidades, devoluciones, el inventario ni la retención.
    expect(options).not.toMatch(/invoices:|returns:|capacity|stock|inventory|withholding/i);
  });

  it("la liquidación usa las primitivas neutrales de `fiscal`, nunca los importes de la factura", () => {
    const amounts = readFileSync(
      join(SRC, "modules/purchase-settlements/domain/amounts.ts"),
      "utf8",
    );
    expect(amounts).toContain("../../fiscal/domain/document-amounts.ts");
    expect(amounts).not.toMatch(/invoices\/domain\/amounts/);
  });

  it("detecta cada violación en archivos de ejemplo", () => {
    expect(
      purchaseSettlementOffenders([
        {
          path: "modules/fiscal/application/transmission-step.ts",
          content: 'import { x } from "../../purchase-settlements/application/emission.ts";',
        },
        {
          path: "modules/invoices/application/invoices.ts",
          content: 'export { x } from "../../purchase-settlements/infrastructure/index.ts";',
        },
        {
          path: "modules/inventory/application/invoice-outflow.ts",
          content: 'const lazy = await import("../../purchase-settlements/domain/snapshot.ts");',
        },
        {
          path: "modules/withholding-receipts/application/emission.ts",
          content: 'import type { X } from "../../purchase-settlements/application/ports.ts";',
        },
        {
          path: "modules/purchase-settlements/domain/amounts.ts",
          content: 'import { lineAmounts } from "../../invoices/domain/amounts.ts";',
        },
        {
          path: "modules/purchase-settlements/infrastructure/index.ts",
          content: 'import { y } from "../../inventory/infrastructure/index.ts";',
        },
        {
          path: "modules/purchase-settlements/application/context.ts",
          content: 'import type { Z } from "../../parties/application/ports.ts";',
        },
        {
          path: "modules/purchase-settlements/domain/evaluation.ts",
          content: 'import { w } from "../../products/domain/product.ts";',
        },
        {
          path: "modules/purchase-settlements/application/emission.ts",
          content: 'import { v } from "../../withholding-receipts/application/emission.ts";',
        },
        {
          path: "modules/purchase-settlements/infrastructure/reads.ts",
          content: 'import { u } from "../../shipping-guides/infrastructure/index.ts";',
        },
        // Permitidos: la propia liquidación, sus lecturas de `fiscal` y `catalogs` y el arranque.
        {
          path: "modules/purchase-settlements/domain/amounts.ts",
          content: 'import { lineAmounts } from "../../fiscal/domain/document-amounts.ts";',
        },
        {
          path: "modules/purchase-settlements/infrastructure/index.ts",
          content: 'import { ecuadorDate } from "../../catalogs/infrastructure/index.ts";',
        },
        {
          path: "main.ts",
          content:
            'import { purchaseSettlementsModule } from "./modules/purchase-settlements/infrastructure/index.ts";',
        },
      ]),
    ).toEqual([
      "modules/fiscal/application/transmission-step.ts: importa la liquidación de compra",
      "modules/invoices/application/invoices.ts: importa la liquidación de compra",
      "modules/inventory/application/invoice-outflow.ts: importa la liquidación de compra",
      "modules/withholding-receipts/application/emission.ts: importa la liquidación de compra",
      "modules/purchase-settlements/domain/amounts.ts: importa el inventario, terceros, productos u otro comprobante",
      "modules/purchase-settlements/infrastructure/index.ts: importa el inventario, terceros, productos u otro comprobante",
      "modules/purchase-settlements/application/context.ts: importa el inventario, terceros, productos u otro comprobante",
      "modules/purchase-settlements/domain/evaluation.ts: importa el inventario, terceros, productos u otro comprobante",
      "modules/purchase-settlements/application/emission.ts: importa el inventario, terceros, productos u otro comprobante",
      "modules/purchase-settlements/infrastructure/reads.ts: importa el inventario, terceros, productos u otro comprobante",
    ]);
  });
});
