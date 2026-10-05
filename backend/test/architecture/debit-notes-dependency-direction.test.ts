// Dirección de las dependencias de las notas de débito (add-debit-notes, design D1 y D12): la nota
// lee la factura y usa las operaciones de `fiscal`, nunca al revés. `fiscal`, `invoices`, `inventory`
// y `credit-notes` no importan `debit-notes`; y `debit-notes` no importa `inventory` ni
// `credit-notes`, porque no toca la capacidad acreditable ni el inventario. La lectura de la factura
// la compone el arranque.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));

type SourceFile = { path: string; content: string };

/** Módulos que la nota de débito lee o junto a los que vive: ninguno puede depender de ella. */
const UPSTREAM = /^modules\/(?:fiscal|invoices|inventory|credit-notes)\//;
const IMPORTS_DEBIT_NOTES = /(?:from|import)\s*\(?\s*["'][^"']*\/debit-notes\/[^"']*["']/;
/** Lo que la nota de débito no puede importar: sin capacidades ni inventario. */
const DEBIT_NOTES = /^modules\/debit-notes\//;
const IMPORTS_FORBIDDEN =
  /(?:from|import)\s*\(?\s*["'][^"']*\/(?:inventory|credit-notes)\/[^"']*["']/;

export function debitNotesOffenders(files: readonly SourceFile[]): string[] {
  return files.flatMap(({ path, content }) => [
    ...(UPSTREAM.test(path) && IMPORTS_DEBIT_NOTES.test(content)
      ? [`${path}: importa las notas de débito`]
      : []),
    ...(DEBIT_NOTES.test(path) && IMPORTS_FORBIDDEN.test(content)
      ? [`${path}: importa el inventario o las notas de crédito`]
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

describe("dirección de las dependencias de las notas de débito", () => {
  it("fiscal, invoices, inventory y credit-notes no dependen de las notas de débito, ni ellas del inventario o de la nota de crédito", () => {
    expect(debitNotesOffenders(sourceFiles(SRC))).toEqual([]);
  });

  it("el arranque compone la lectura de la factura y la firma con el perfil de la nota de débito", () => {
    const main = readFileSync(join(SRC, "main.ts"), "utf8");
    const module = main.slice(main.indexOf("...debitNotesModule("));
    expect(module).toContain("invoices: invoiceCreditSource");
    expect(module).toContain("documentSigning.pipeline(debitNoteSigningProfile())");
    // La nota de débito no recibe ni la capacidad devolvible ni la acreditable.
    expect(module.slice(0, module.indexOf(").routers"))).not.toMatch(/returns:|capacity/);
  });

  it("detecta cada violación en archivos de ejemplo", () => {
    expect(
      debitNotesOffenders([
        {
          path: "modules/fiscal/application/transmission-step.ts",
          content: 'import { x } from "../../debit-notes/application/emission.ts";',
        },
        {
          path: "modules/invoices/application/invoices.ts",
          content: 'export { x } from "../../debit-notes/infrastructure/index.ts";',
        },
        {
          path: "modules/inventory/application/invoice-outflow.ts",
          content: 'const lazy = await import("../../debit-notes/domain/snapshot.ts");',
        },
        {
          path: "modules/credit-notes/application/followers.ts",
          content: 'import type { X } from "../../debit-notes/application/ports.ts";',
        },
        {
          path: "modules/debit-notes/application/emission.ts",
          content: 'import { x } from "../../inventory/infrastructure/index.ts";',
        },
        {
          path: "modules/debit-notes/infrastructure/index.ts",
          content: 'import { y } from "../../credit-notes/infrastructure/index.ts";',
        },
        // Permitidos: la propia nota de débito, sus lecturas de `fiscal` y el arranque.
        {
          path: "modules/debit-notes/application/context.ts",
          content: 'import { x } from "../../fiscal/application/ports.ts";',
        },
        {
          path: "main.ts",
          content:
            'import { debitNotesModule } from "./modules/debit-notes/infrastructure/index.ts";',
        },
      ]),
    ).toEqual([
      "modules/fiscal/application/transmission-step.ts: importa las notas de débito",
      "modules/invoices/application/invoices.ts: importa las notas de débito",
      "modules/inventory/application/invoice-outflow.ts: importa las notas de débito",
      "modules/credit-notes/application/followers.ts: importa las notas de débito",
      "modules/debit-notes/application/emission.ts: importa el inventario o las notas de crédito",
      "modules/debit-notes/infrastructure/index.ts: importa el inventario o las notas de crédito",
    ]);
  });
});
