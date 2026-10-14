// globals.css compilado con Tailwind (design D4): las variantes copiadas de shadcn/ui generan sus
// selectores, tw-animate-css aporta las animaciones de los primitivos y el movimiento reducido las
// anula. Compila el CSS real con la API de Tailwind, sin build de Next.
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { compile } from "tailwindcss";
import { beforeAll, describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const PACKAGES: Record<string, string> = {
  tailwindcss: join(realpathSync(join(ROOT, "node_modules", "tailwindcss")), "index.css"),
  "tw-animate-css": join(
    realpathSync(join(ROOT, "node_modules", "tw-animate-css")),
    "dist",
    "tw-animate.css",
  ),
};

let css = "";

beforeAll(async () => {
  const source = readFileSync(join(ROOT, "src", "app", "globals.css"), "utf8");
  const compiler = await compile(source, {
    base: join(ROOT, "src", "app"),
    loadStylesheet: async (id) => {
      const path = PACKAGES[id];
      if (!path) throw new Error(`hoja no prevista: ${id}`);
      return { path, base: dirname(path), content: readFileSync(path, "utf8") };
    },
  });
  css = compiler.build([
    "data-open:animate-in",
    "data-closed:animate-out",
    "data-closed:fade-out-0",
    "data-selected:bg-muted",
    "data-disabled:opacity-50",
    "data-active:bg-sidebar-accent",
    "data-horizontal:h-px",
    "data-vertical:w-px",
    "no-scrollbar",
    "rounded-xl",
    "h-9",
    "bg-surface",
  ]);
});

describe("CSS del sistema de diseño", () => {
  it("las variantes de shadcn/ui generan sus selectores", () => {
    expect(css).toContain('[data-state="open"]');
    expect(css).toContain('[data-state="closed"]');
    expect(css).toContain('[data-selected="true"]');
    expect(css).toContain('[data-disabled="true"]');
    expect(css).toContain('[data-state="active"]');
    expect(css).toContain('[data-orientation="horizontal"]');
    expect(css).toContain('[data-orientation="vertical"]');
  });

  it("tw-animate-css aporta las animaciones de entrada y salida", () => {
    expect(css).toMatch(/\.data-open\\:animate-in/);
    expect(css).toMatch(/@keyframes enter/);
  });

  it("el movimiento reducido anula las animaciones", () => {
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation-duration: 0\.01ms/,
    );
  });

  it("la escala de 4 px, los radios con nombre y los alias heredados compilan", () => {
    expect(css).toMatch(/\.h-9\s*\{\s*height: calc\(var\(--spacing\) \* 9\)/);
    // `@theme inline` resuelve el valor al compilar: el radio sale de --radius y el alias heredado
    // apunta directamente al token canónico.
    expect(css).toMatch(/\.rounded-xl\s*\{\s*border-radius: calc\(var\(--radius\) \+ 4px\)/);
    expect(css).toMatch(/\.bg-surface\s*\{\s*background-color: var\(--card\)/);
  });
});
