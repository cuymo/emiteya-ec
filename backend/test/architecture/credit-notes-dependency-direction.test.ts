// Dirección de las dependencias de las notas de crédito (add-credit-notes, design D1): la nota lee la
// factura y usa las operaciones de `fiscal` y del inventario, nunca al revés. `fiscal`, `invoices` e
// `inventory` no importan `credit-notes`: sus puertos, sus seguidores y la lectura de la factura los
// compone el arranque. Y solo la conclusión de la nota aplica o libera su capacidad (design D7): no
// hay un job ni un barrido que la libere por antigüedad.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));

type SourceFile = { path: string; content: string };

/** Módulos que la nota de crédito lee o usa: ninguno puede depender de ella. */
const UPSTREAM = /^modules\/(?:fiscal|invoices|inventory)\//;
const IMPORTS_CREDIT_NOTES = /(?:from|import)\s*\(?\s*["'][^"']*\/credit-notes\/[^"']*["']/;

export function creditNotesOffenders(files: readonly SourceFile[]): string[] {
  return files
    .filter(({ path, content }) => UPSTREAM.test(path) && IMPORTS_CREDIT_NOTES.test(content))
    .map(({ path }) => `${path}: importa las notas de crédito`);
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

describe("dirección de las dependencias de las notas de crédito", () => {
  it("fiscal, invoices e inventory no dependen de las notas de crédito", () => {
    expect(creditNotesOffenders(sourceFiles(SRC))).toEqual([]);
  });

  it("el arranque compone los puertos y los seguidores, la capacidad acreditable antes que la devolución", () => {
    const main = readFileSync(join(SRC, "main.ts"), "utf8");
    expect(main).toContain("invoices: invoiceCreditSource");
    expect(main).toContain("returns: stockReturnCapacity");
    const capacity = main.indexOf("creditCapacityFollower(");
    const returns = main.indexOf("creditNoteReturnFollower(");
    expect(capacity).toBeGreaterThan(0);
    expect(returns).toBeGreaterThan(capacity);
  });

  it("solo la conclusión de una nota aplica o libera su capacidad: ningún job ni barrido la libera", () => {
    const files = sourceFiles(SRC);
    // Los únicos que concluyen una reserva son los seguidores de la transición de la nota.
    expect(
      files
        .filter(({ content }) => /\.conclude\(/.test(content))
        .map(({ path }) => path)
        .sort(),
    ).toEqual([
      "modules/credit-notes/application/followers.ts",
      "modules/inventory/application/credit-note-return.ts",
    ]);
    // Ningún job, runner ni barrido toca las reservas, por antigua que sea una nota sin conclusión.
    expect(
      files
        .filter(({ path }) => /jobs|runner|sweeper/.test(path))
        .filter(({ content }) =>
          /creditReservation|credit_reservation|stockReturnReservation|stock_return_reservation/.test(
            content,
          ),
        )
        .map(({ path }) => path),
    ).toEqual([]);
  });

  it("detecta cada violación en archivos de ejemplo", () => {
    expect(
      creditNotesOffenders([
        {
          path: "modules/fiscal/application/transmission-step.ts",
          content: 'import { follower } from "../../credit-notes/application/followers.ts";',
        },
        {
          path: "modules/invoices/application/invoices.ts",
          content: 'export { x } from "../../credit-notes/infrastructure/index.ts";',
        },
        {
          path: "modules/inventory/infrastructure/prisma-return-capacity.ts",
          content: 'const lazy = await import("../../credit-notes/application/ports.ts");',
        },
        // Permitidos: la propia nota de crédito y el arranque que la compone.
        {
          path: "modules/credit-notes/application/emission.ts",
          content: 'import { x } from "../../credit-notes/domain/amounts.ts";',
        },
        {
          path: "main.ts",
          content:
            'import { creditNotesModule } from "./modules/credit-notes/infrastructure/index.ts";',
        },
      ]),
    ).toEqual([
      "modules/fiscal/application/transmission-step.ts: importa las notas de crédito",
      "modules/invoices/application/invoices.ts: importa las notas de crédito",
      "modules/inventory/infrastructure/prisma-return-capacity.ts: importa las notas de crédito",
    ]);
  });
});
