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
    "disabled:not-aria-busy:bg-muted",
    "max-w-reading",
    "max-w-form",
    "max-w-workspace",
    "has-data-[page-width=form]:max-w-form",
    "has-data-[page-width=reading]:max-w-reading",
    "@form-rail:flex-row",
    "@form-rail:grid-cols-form-rail",
    "@lg:grid-cols-payment",
    "@form-wide:grid-cols-2",
    "@form-wide:grid-rows-subgrid",
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

  it("el deshabilitado del botón excluye el pendiente (design D9)", () => {
    // `AsyncButton` pendiente está deshabilitado y lleva `aria-busy`: conserva su variante.
    expect(css).toMatch(
      /\.disabled\\:not-aria-busy\\:bg-muted:disabled:not\(\[aria-busy="true"\]\)\s*\{\s*background-color: var\(--muted\)/,
    );
  });

  it("las columnas de los formularios son utilidades con nombre y responden al contenedor (D5, D7)", () => {
    expect(css).toMatch(
      /@container \(width >= 57.5rem\)\s*\{\s*\.\\@form-rail\\:grid-cols-form-rail\s*\{\s*grid-template-columns: minmax\(0, 1fr\) 20rem/,
    );
    expect(css).toMatch(
      /@container \(width >= 32rem\)\s*\{\s*\.\\@lg\\:grid-cols-payment\s*\{\s*grid-template-columns: minmax\(0, 4fr\) minmax\(10rem, 1fr\)/,
    );
    expect(css).toMatch(/@container \(width >= 40rem\)\s*\{\s*\.\\@form-wide\\:grid-cols-2/);
    expect(css).toMatch(/\.\\@form-wide\\:grid-rows-subgrid\s*\{\s*grid-template-rows: subgrid/);
  });

  it("los anchos por función y el punto de apilado del formulario generan sus utilidades (D4, D5)", () => {
    expect(css).toMatch(/\.max-w-reading\s*\{\s*max-width: var\(--container-reading\)/);
    expect(css).toMatch(/\.max-w-form\s*\{\s*max-width: var\(--container-form\)/);
    expect(css).toMatch(/\.max-w-workspace\s*\{\s*max-width: var\(--container-workspace\)/);
    // La columna del shell se estrecha según el ancho que declara la pantalla.
    for (const role of ["form", "reading"]) {
      expect(css).toMatch(
        new RegExp(
          `:max-w-${role}:has\\(\\[data-page-width="${role}"\\]\\)\\s*\\{\\s*max-width: var\\(--container-${role}\\)`,
        ),
      );
    }
    expect(css).toMatch(
      /@container \(width >= 57.5rem\)\s*\{(?:\s*\.[^{]+\{[^}]*\})*?\s*\.\\@form-rail\\:flex-row\s*\{\s*flex-direction: row/,
    );
  });

  it("los campos se enfocan con un borde y un halo grises, sin el contorno azul", () => {
    // Decisión del propietario, 2026-10-24.
    const rule = css.slice(css.indexOf('[data-slot="date-picker-trigger"]):focus-visible'));
    expect(rule).toMatch(/^[^}]*outline: none/);
    expect(rule).toMatch(/^[^}]*border-color: var\(--color-foreground-muted\)/);
    expect(rule).toMatch(/^[^}]*box-shadow: 0 0 0 3px/);
  });
});
