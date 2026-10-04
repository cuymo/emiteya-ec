// Frontera del renderer del RIDE (add-document-archive, design D6 y D15): pdfmake, pdfkit, bwip-js
// y fontkit solo los carga la entrada del worker del RIDE. Ningún otro archivo de `src/` (y menos
// `main.ts`, que atiende HTTP) alcanza esas librerías por sus imports, directos o transitivos.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const RENDERER_LIBRARIES = /^(?:pdfmake|pdfkit|bwip-js|fontkit)(?:\/.*)?$/;
/** Los únicos archivos que alcanzan las librerías del renderer. */
const ALLOWED = [
  "modules/sri-engine/infrastructure/ride/ride-renderer.ts",
  "modules/sri-engine/infrastructure/ride/serve-ride-tasks.ts",
];

type SourceFile = { path: string; content: string };

const IMPORT = /(?:import|export)\s+(?:type\s+)?(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/g;
const DYNAMIC_IMPORT = /import\(\s*["']([^"']+)["']\s*\)/g;

/** Archivos de `src/` que alcanzan las librerías del renderer por imports de valor. */
export function rendererReachers(files: readonly SourceFile[]): string[] {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const imports = new Map<string, { local: string[]; packages: string[] }>();
  for (const { path, content } of files) {
    const local: string[] = [];
    const packages: string[] = [];
    const specifiers = [...content.matchAll(IMPORT), ...content.matchAll(DYNAMIC_IMPORT)]
      // Un `import type` no carga el módulo en tiempo de ejecución.
      .filter((match) => !/^(?:import|export)\s+type\s/.test(match[0]))
      .map((match) => match[1]!);
    for (const specifier of specifiers) {
      if (specifier.startsWith(".")) local.push(normalize(join(dirname(path), specifier)));
      else packages.push(specifier);
    }
    imports.set(path, { local, packages });
  }
  const reaches = new Map<string, boolean>();
  const visit = (path: string, stack: Set<string>): boolean => {
    const known = reaches.get(path);
    if (known !== undefined) return known;
    if (stack.has(path) || !byPath.has(path)) return false;
    stack.add(path);
    const entry = imports.get(path)!;
    const result =
      entry.packages.some((name) => RENDERER_LIBRARIES.test(name)) ||
      entry.local.some((target) => visit(target, stack));
    stack.delete(path);
    reaches.set(path, result);
    return result;
  };
  return files
    .map((file) => file.path)
    .filter((path) => visit(path, new Set()))
    .sort();
}

function sourceFiles(dir: string): SourceFile[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "generated" ? [] : sourceFiles(path);
    return path.endsWith(".ts") && !path.endsWith(".d.ts")
      ? [{ path: relative(SRC, path), content: readFileSync(path, "utf8") }]
      : [];
  });
}

describe("frontera del renderer del RIDE", () => {
  it("solo el renderer y la entrada del worker alcanzan pdfmake, pdfkit, bwip-js y fontkit", () => {
    expect(rendererReachers(sourceFiles(SRC))).toEqual(ALLOWED);
  });

  it("detecta un import directo, uno transitivo y uno dinámico, e ignora los de tipos", () => {
    expect(
      rendererReachers([
        { path: "a/direct.ts", content: 'import pdfmake from "pdfmake";' },
        { path: "a/transitive.ts", content: 'import { x } from "./direct.ts";' },
        { path: "b/main.ts", content: 'export { y } from "../a/transitive.ts";' },
        { path: "c/lazy.ts", content: 'const m = await import("bwip-js");' },
        { path: "d/types.ts", content: 'import type { Content } from "pdfmake";' },
        { path: "d/clean.ts", content: 'import { z } from "./types.ts";' },
      ]),
    ).toEqual(["a/direct.ts", "a/transitive.ts", "b/main.ts", "c/lazy.ts"]);
  });
});
