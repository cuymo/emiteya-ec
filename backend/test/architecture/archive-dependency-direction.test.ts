// Dirección de las dependencias del archivo documental (add-document-archive, design D1 y D5): el
// archivo depende de la transmisión, nunca al revés. La transmisión solo conoce el puerto genérico
// de seguidores de las transiciones; el job del RIDE lo compone el arranque.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));

type SourceFile = { path: string; content: string };

/** Los únicos archivos fuera del archivo que lo componen: el arranque y su configuración. */
const COMPOSITION = new Set(["main.ts", "config/archive.ts"]);
const isArchive = (path: string) => /(?:^|\/)archive\//.test(path);
/** El código de la transmisión al SRI (add-sri-transmission) y el motor SRI. */
const isTransmission = (path: string) =>
  /^modules\/sri-engine\//.test(path) ||
  /^modules\/fiscal\/(?:application|infrastructure|domain)\/(?:transmission[^/]*|transmit-handler|authorize-handler|reconcile-handler|prisma-sri-evidence|reconciliation-unit-of-work)\.ts$/.test(
    path,
  );
const IMPORTS_ARCHIVE = /(?:from|import)\s*\(?\s*["'][^"']*\/archive\/[^"']*["']/;

export function dependencyOffenders(files: readonly SourceFile[]): string[] {
  const offenders: string[] = [];
  for (const { path, content } of files) {
    if (path.startsWith("generated/") || isArchive(path) || COMPOSITION.has(path)) continue;
    if (IMPORTS_ARCHIVE.test(content)) offenders.push(`${path}: importa el archivo documental`);
    if (isTransmission(path) && content.includes("document.render_ride")) {
      offenders.push(`${path}: nombra el job del RIDE`);
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

describe("dirección de las dependencias del archivo documental", () => {
  it("la transmisión y el resto del código no dependen del archivo", () => {
    expect(dependencyOffenders(sourceFiles(SRC))).toEqual([]);
  });

  it("el paso de la transmisión solo conoce el puerto genérico de seguidores", () => {
    const step = readFileSync(join(SRC, "modules/fiscal/application/transmission-step.ts"), "utf8");
    expect(step).toContain('from "./document-transitions.ts"');
    expect(step).not.toMatch(/ride|RIDE/);
  });

  it("detecta cada violación en archivos de ejemplo", () => {
    expect(
      dependencyOffenders([
        {
          path: "modules/fiscal/application/transmission-step.ts",
          content: 'import { rideFollower } from "./archive/ride-jobs.ts";',
        },
        {
          path: "modules/fiscal/application/authorize-handler.ts",
          content: 'const type = "document.render_ride";',
        },
        {
          path: "modules/invoices/application/invoices.ts",
          content: 'export { x } from "../../fiscal/infrastructure/archive/index.ts";',
        },
        {
          path: "modules/fiscal/infrastructure/transmission-sweeper.ts",
          content: 'const lazy = await import("./archive/ride-sweeper.ts");',
        },
        // Permitidos: el propio archivo y la composición del arranque.
        {
          path: "modules/fiscal/application/archive/ride-handler.ts",
          content: 'import { x } from "./ride-jobs.ts"; const t = "document.render_ride";',
        },
        {
          path: "main.ts",
          content:
            'import { rideFollower } from "./modules/fiscal/infrastructure/archive/index.ts";',
        },
      ]),
    ).toEqual([
      "modules/fiscal/application/transmission-step.ts: importa el archivo documental",
      "modules/fiscal/application/authorize-handler.ts: nombra el job del RIDE",
      "modules/invoices/application/invoices.ts: importa el archivo documental",
      "modules/fiscal/infrastructure/transmission-sweeper.ts: importa el archivo documental",
    ]);
  });
});
