// Dirección de las dependencias del comprobante de retención (add-withholding-receipts, design D1):
// la retención usa las operaciones exportadas de `fiscal`, `taxpayer`, `catalogs` y `signing`, y lee
// los terceros por el puerto `WithheldPartyReader` que compone el arranque. `fiscal`, `invoices`,
// `inventory`, `credit-notes` y `debit-notes` no importan `withholding-receipts`, y la retención no
// importa ninguno de ellos ni `parties`: no modifica comprobantes propios, capacidades ni inventario.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));

type SourceFile = { path: string; content: string };

/** Módulos junto a los que vive la retención: ninguno puede depender de ella. */
const NEIGHBOURS = /^modules\/(?:fiscal|invoices|inventory|credit-notes|debit-notes)\//;
const IMPORTS_WITHHOLDING = /(?:from|import)\s*\(?\s*["'][^"']*\/withholding-receipts\/[^"']*["']/;
/** Lo que la retención no puede importar: los demás comprobantes, el inventario ni `parties`. */
const WITHHOLDING = /^modules\/withholding-receipts\//;
const IMPORTS_FORBIDDEN =
  /(?:from|import)\s*\(?\s*["'][^"']*\/(?:invoices|inventory|credit-notes|debit-notes|parties)\/[^"']*["']/;

export function withholdingOffenders(files: readonly SourceFile[]): string[] {
  return files.flatMap(({ path, content }) => [
    ...(NEIGHBOURS.test(path) && IMPORTS_WITHHOLDING.test(content)
      ? [`${path}: importa el comprobante de retención`]
      : []),
    ...(WITHHOLDING.test(path) && IMPORTS_FORBIDDEN.test(content)
      ? [`${path}: importa otro comprobante, el inventario o parties`]
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

describe("dirección de las dependencias del comprobante de retención", () => {
  it("fiscal, invoices, inventory y las notas no dependen de la retención, ni ella de ellos", () => {
    expect(withholdingOffenders(sourceFiles(SRC))).toEqual([]);
  });

  it("el arranque compone la lectura de terceros y la firma con el perfil de la retención", () => {
    const main = readFileSync(join(SRC, "main.ts"), "utf8");
    const module = main.slice(main.indexOf("...withholdingReceiptsModule("));
    const options = module.slice(0, module.indexOf(").routers"));
    expect(options).toContain("parties: supplierReader");
    expect(options).toContain("documentSigning.pipeline(withholdingReceiptSigningProfile())");
    // La retención no recibe capacidades, inventario ni la lectura de facturas.
    expect(options).not.toMatch(/returns:|capacity|invoices:|inventory/);
  });

  it("detecta cada violación en archivos de ejemplo", () => {
    expect(
      withholdingOffenders([
        {
          path: "modules/fiscal/application/transmission-step.ts",
          content: 'import { x } from "../../withholding-receipts/application/emission.ts";',
        },
        {
          path: "modules/invoices/application/invoices.ts",
          content: 'export { x } from "../../withholding-receipts/infrastructure/index.ts";',
        },
        {
          path: "modules/inventory/application/invoice-outflow.ts",
          content: 'const lazy = await import("../../withholding-receipts/domain/snapshot.ts");',
        },
        {
          path: "modules/credit-notes/application/followers.ts",
          content: 'import type { X } from "../../withholding-receipts/application/ports.ts";',
        },
        {
          path: "modules/debit-notes/application/context.ts",
          content: 'import { y } from "../../withholding-receipts/domain/amounts.ts";',
        },
        {
          path: "modules/withholding-receipts/application/emission.ts",
          content: 'import { x } from "../../invoices/application/diagnostics.ts";',
        },
        {
          path: "modules/withholding-receipts/infrastructure/index.ts",
          content: 'import { y } from "../../inventory/infrastructure/index.ts";',
        },
        {
          path: "modules/withholding-receipts/application/context.ts",
          content: 'import type { Z } from "../../credit-notes/application/ports.ts";',
        },
        {
          path: "modules/withholding-receipts/domain/evaluation.ts",
          content: 'import { w } from "../../debit-notes/domain/amounts.ts";',
        },
        {
          path: "modules/withholding-receipts/infrastructure/reads.ts",
          content: 'import { v } from "../../parties/infrastructure/index.ts";',
        },
        // Permitidos: la propia retención, sus lecturas de `fiscal` y `catalogs` y el arranque.
        {
          path: "modules/withholding-receipts/application/context.ts",
          content: 'import { x } from "../../fiscal/application/ports.ts";',
        },
        {
          path: "modules/withholding-receipts/infrastructure/index.ts",
          content: 'import { ecuadorDate } from "../../catalogs/infrastructure/index.ts";',
        },
        {
          path: "main.ts",
          content:
            'import { withholdingReceiptsModule } from "./modules/withholding-receipts/infrastructure/index.ts";',
        },
      ]),
    ).toEqual([
      "modules/fiscal/application/transmission-step.ts: importa el comprobante de retención",
      "modules/invoices/application/invoices.ts: importa el comprobante de retención",
      "modules/inventory/application/invoice-outflow.ts: importa el comprobante de retención",
      "modules/credit-notes/application/followers.ts: importa el comprobante de retención",
      "modules/debit-notes/application/context.ts: importa el comprobante de retención",
      "modules/withholding-receipts/application/emission.ts: importa otro comprobante, el inventario o parties",
      "modules/withholding-receipts/infrastructure/index.ts: importa otro comprobante, el inventario o parties",
      "modules/withholding-receipts/application/context.ts: importa otro comprobante, el inventario o parties",
      "modules/withholding-receipts/domain/evaluation.ts: importa otro comprobante, el inventario o parties",
      "modules/withholding-receipts/infrastructure/reads.ts: importa otro comprobante, el inventario o parties",
    ]);
  });
});
