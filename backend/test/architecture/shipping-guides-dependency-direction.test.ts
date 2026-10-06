// Dirección de las dependencias de la guía de remisión (add-shipping-guides, design D1): la guía usa
// las operaciones exportadas de `fiscal`, `taxpayer`, `catalogs`, `sri-engine` y `signing`, y lee
// terceros, productos y facturas por los puertos `ShippingPartyReader`, `ShippingProductReader` y
// `ShippingInvoiceReader` que compone el arranque. Ningún módulo importa `shipping-guides` (solo el
// arranque), y la guía no importa `inventory`, `invoices`, `parties`, `products` ni otro comprobante:
// no mueve stock, no cambia facturas ni capacidades y no asigna roles.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));

type SourceFile = { path: string; content: string };

const SHIPPING = /^modules\/shipping-guides\//;
const IMPORTS_SHIPPING = /(?:from|import)\s*\(?\s*["'][^"']*\/shipping-guides\/[^"']*["']/;
/** Lo que la guía no puede importar: el inventario, los catálogos de terceros y productos y los demás comprobantes. */
const IMPORTS_FORBIDDEN =
  /(?:from|import)\s*\(?\s*["'][^"']*\/(?:inventory|invoices|parties|products|credit-notes|debit-notes|withholding-receipts)\/[^"']*["']/;

export function shippingGuideOffenders(files: readonly SourceFile[]): string[] {
  return files.flatMap(({ path, content }) => [
    ...(path !== "main.ts" && !SHIPPING.test(path) && IMPORTS_SHIPPING.test(content)
      ? [`${path}: importa la guía de remisión`]
      : []),
    ...(SHIPPING.test(path) && IMPORTS_FORBIDDEN.test(content)
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

describe("dirección de las dependencias de la guía de remisión", () => {
  it("nadie depende de la guía, salvo el arranque, ni ella del inventario, terceros, productos u otros comprobantes", () => {
    expect(shippingGuideOffenders(sourceFiles(SRC))).toEqual([]);
  });

  it("el arranque compone terceros, productos, facturas y la firma con el perfil de la guía", () => {
    const main = readFileSync(join(SRC, "main.ts"), "utf8");
    const module = main.slice(main.indexOf("...shippingGuidesModule("));
    const options = module.slice(0, module.indexOf(").routers"));
    expect(options).toContain("parties: shippingPartyReader");
    expect(options).toContain("products: productReader");
    expect(options).toContain("invoices: invoiceCreditSource");
    expect(options).toContain("documentSigning.pipeline(shippingGuideSigningProfile())");
    // La guía no recibe capacidades, devoluciones ni el inventario.
    expect(options).not.toMatch(/returns:|capacity|stock|inventory/i);
  });

  it("detecta cada violación en archivos de ejemplo", () => {
    expect(
      shippingGuideOffenders([
        {
          path: "modules/fiscal/application/transmission-step.ts",
          content: 'import { x } from "../../shipping-guides/application/emission.ts";',
        },
        {
          path: "modules/invoices/application/invoices.ts",
          content: 'export { x } from "../../shipping-guides/infrastructure/index.ts";',
        },
        {
          path: "modules/inventory/application/invoice-outflow.ts",
          content: 'const lazy = await import("../../shipping-guides/domain/snapshot.ts");',
        },
        {
          path: "modules/parties/infrastructure/index.ts",
          content: 'import type { X } from "../../shipping-guides/application/ports.ts";',
        },
        {
          path: "modules/sri-engine/infrastructure/ride/ride-source.ts",
          content: 'import type { Y } from "../../../shipping-guides/domain/snapshot.ts";',
        },
        {
          path: "modules/shipping-guides/application/emission.ts",
          content: 'import { x } from "../../invoices/application/diagnostics.ts";',
        },
        {
          path: "modules/shipping-guides/infrastructure/index.ts",
          content: 'import { y } from "../../inventory/infrastructure/index.ts";',
        },
        {
          path: "modules/shipping-guides/application/context.ts",
          content: 'import type { Z } from "../../parties/application/ports.ts";',
        },
        {
          path: "modules/shipping-guides/domain/evaluation.ts",
          content: 'import { w } from "../../products/domain/product.ts";',
        },
        {
          path: "modules/shipping-guides/infrastructure/reads.ts",
          content: 'import { v } from "../../withholding-receipts/infrastructure/index.ts";',
        },
        // Permitidos: la propia guía, sus lecturas de `fiscal` y `catalogs` y el arranque.
        {
          path: "modules/shipping-guides/application/context.ts",
          content: 'import { x } from "../../fiscal/application/ports.ts";',
        },
        {
          path: "modules/shipping-guides/infrastructure/index.ts",
          content: 'import { ecuadorDate } from "../../catalogs/infrastructure/index.ts";',
        },
        {
          path: "main.ts",
          content:
            'import { shippingGuidesModule } from "./modules/shipping-guides/infrastructure/index.ts";',
        },
      ]),
    ).toEqual([
      "modules/fiscal/application/transmission-step.ts: importa la guía de remisión",
      "modules/invoices/application/invoices.ts: importa la guía de remisión",
      "modules/inventory/application/invoice-outflow.ts: importa la guía de remisión",
      "modules/parties/infrastructure/index.ts: importa la guía de remisión",
      "modules/sri-engine/infrastructure/ride/ride-source.ts: importa la guía de remisión",
      "modules/shipping-guides/application/emission.ts: importa el inventario, terceros, productos u otro comprobante",
      "modules/shipping-guides/infrastructure/index.ts: importa el inventario, terceros, productos u otro comprobante",
      "modules/shipping-guides/application/context.ts: importa el inventario, terceros, productos u otro comprobante",
      "modules/shipping-guides/domain/evaluation.ts: importa el inventario, terceros, productos u otro comprobante",
      "modules/shipping-guides/infrastructure/reads.ts: importa el inventario, terceros, productos u otro comprobante",
    ]);
  });
});
