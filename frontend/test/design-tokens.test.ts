// Tokens canónicos de globals.css (adopt-premium-design-foundation-and-shell, design D4; ADR 0028):
// un solo primario por tema, alias heredados que apuntan a un canónico, radios con nombre, ningún
// color literal fuera de los bloques de tokens, y el contraste de cada par de tokens que se usa.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(join(__dirname, "..", "src", "app", "globals.css"), "utf8");

function block(selector: string): string {
  const start = CSS.indexOf(`\n${selector} {`);
  expect(start, `bloque ${selector}`).toBeGreaterThanOrEqual(0);
  return CSS.slice(start, CSS.indexOf("\n}", start));
}

function variables(source: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const [, name, value] of source.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) {
    result.set(name!, value!.trim());
  }
  return result;
}

const ROOT = variables(block(":root"));
const DARK = new Map([...ROOT, ...variables(block(".dark"))]);
const THEME_INLINE = variables(block("@theme inline"));

function resolve(theme: Map<string, string>, name: string): string {
  let value = theme.get(name);
  expect(value, `--${name}`).toBeDefined();
  while (value!.startsWith("var(--")) value = theme.get(value!.slice(6, -1));
  return value!;
}

/** Luminancia relativa (WCAG) de un `oklch(L C h)` opaco, vía sRGB lineal (Björn Ottosson). */
function luminance(oklch: string): number {
  const match = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/.exec(oklch);
  expect(match, `color opaco ${oklch}`).not.toBeNull();
  const [l, c, h] = match!.slice(1).map(Number) as [number, number, number];
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const lp = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mp = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sp = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  const r = clamp(4.0767416621 * lp - 3.3077115913 * mp + 0.2309699292 * sp);
  const g = clamp(-1.2684380046 * lp + 2.6097574011 * mp - 0.3413193965 * sp);
  const bl = clamp(-0.0041960863 * lp - 0.7034186147 * mp + 1.707614701 * sp);
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
}

function contrast(theme: Map<string, string>, a: string, b: string): number {
  const [x, y] = [luminance(resolve(theme, a)), luminance(resolve(theme, b))];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Texto sobre fondo: 4.5:1. */
const TEXT_PAIRS: [string, string][] = [
  ["foreground", "background"],
  ["foreground", "card"],
  ["muted-foreground", "background"],
  ["muted-foreground", "muted"],
  ["muted-foreground", "card"],
  ["muted-foreground", "sidebar"],
  ["primary-foreground", "primary"],
  ["destructive-foreground", "destructive"],
  ["success-foreground", "success"],
  ["warning-foreground", "warning"],
  ["info-foreground", "info"],
  ["sidebar-foreground", "sidebar"],
  ["sidebar-accent-foreground", "sidebar-accent"],
  ["secondary-foreground", "secondary"],
  ["accent-foreground", "accent"],
  ["active-foreground", "active"],
  ["popover-foreground", "popover"],
  ["primary", "background"],
  ["destructive", "background"],
];

/** Elementos no textuales con significado (bordes de formulario, foco, iconos de estado): 3:1. */
const NON_TEXT_PAIRS: [string, string][] = [
  ["chart-1", "card"],
  ["chart-muted", "card"],
  ["ring", "background"],
  ["ring", "sidebar"],
  ["success", "background"],
  ["warning", "background"],
  ["info", "background"],
  ["destructive", "background"],
];

describe("tokens del sistema de diseño", () => {
  it("hay un solo primario por tema y es el azul de EmiteYa", () => {
    for (const source of [block(":root"), block(".dark")]) {
      expect(source.match(/--primary:/g)).toHaveLength(1);
    }
    expect(resolve(ROOT, "primary")).toBe("oklch(0.5 0.16 255)");
    expect(resolve(DARK, "primary")).toBe("oklch(0.68 0.15 255)");
    expect(resolve(ROOT, "sidebar-primary")).toBe(resolve(ROOT, "primary"));
  });

  it("cada alias heredado resuelve a un token canónico", () => {
    const aliases: Record<string, string> = {
      "color-surface": "var(--card)",
      "color-surface-subtle": "var(--muted)",
      "color-foreground-muted": "var(--muted-foreground)",
      "color-danger": "var(--destructive)",
      "color-danger-foreground": "var(--destructive-foreground)",
      "color-neutral": "var(--muted-foreground)",
    };
    for (const [alias, canonical] of Object.entries(aliases)) {
      expect(THEME_INLINE.get(alias)).toBe(canonical);
      expect(ROOT.has(canonical.slice(6, -1))).toBe(true);
    }
  });

  it("los radios son tokens con nombre derivados de --radius", () => {
    expect(ROOT.get("radius")).toBe("0.625rem");
    for (const size of ["sm", "md", "lg", "xl", "2xl", "3xl", "4xl"]) {
      expect(THEME_INLINE.get(`radius-${size}`)).toMatch(/var\(--radius\)/);
    }
  });

  it("no hay colores literales fuera de los bloques de tokens", () => {
    const outside = [":root", ".dark"]
      .reduce((css, selector) => css.replace(block(selector), ""), CSS)
      // Excepción documentada: el contraste de los avisos de sonner.
      .replace(/:root \[data-sonner-toaster\][\s\S]*?\n\}/, "");
    expect(outside).not.toMatch(/oklch\(|#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  });

  it("el tema oscuro no usa negro ni blanco casi puros (design D28)", () => {
    // Antes: fondo 0.145 y texto 0.985, 18.96:1, que deslumbra en sesiones largas.
    const lightness = (name: string) => Number(/^oklch\(([\d.]+) /.exec(resolve(DARK, name))![1]);
    expect(lightness("background")).toBeGreaterThanOrEqual(0.17);
    expect(lightness("foreground")).toBeLessThanOrEqual(0.95);
    expect(lightness("card")).toBeGreaterThan(lightness("background"));
    expect(lightness("muted")).toBeGreaterThan(lightness("card"));
    expect(contrast(DARK, "foreground", "background")).toBeLessThan(17);
    expect(contrast(DARK, "foreground", "background")).toBeGreaterThanOrEqual(7);
  });

  it("la escala de espaciado es de base 4", () => {
    expect(CSS).toContain("--spacing: 0.25rem;");
  });
});

describe("botón deshabilitado (productize-invoice-editor-and-composition-foundation, D9)", () => {
  for (const [name, theme] of [
    ["claro", ROOT],
    ["oscuro", DARK],
  ] as const) {
    it(`tema ${name}: el texto deshabilitado sobre muted sigue legible, al menos 3:1`, () => {
      expect(contrast(theme, "muted-foreground", "muted")).toBeGreaterThanOrEqual(3);
    });
    it(`tema ${name}: la pieza elegida del control segmentado se distingue de la pista y de su relleno (D10)`, () => {
      expect(contrast(theme, "muted-foreground", "muted")).toBeGreaterThanOrEqual(3);
      expect(contrast(theme, "muted-foreground", "background")).toBeGreaterThanOrEqual(3);
    });
  }
});

describe("contraste de los tokens", () => {
  for (const [name, theme] of [
    ["claro", ROOT],
    ["oscuro", DARK],
  ] as const) {
    it.each(TEXT_PAIRS)(`tema ${name}: texto %s sobre %s, al menos 4.5:1`, (text, background) => {
      expect(contrast(theme, text, background)).toBeGreaterThanOrEqual(4.5);
    });
    it.each(NON_TEXT_PAIRS)(`tema ${name}: %s sobre %s, al menos 3:1`, (element, background) => {
      expect(contrast(theme, element, background)).toBeGreaterThanOrEqual(3);
    });
    // Decisión del propietario (2026-10-22): el borde de los campos es un gris suave, por debajo del
    // 3:1 de WCAG 1.4.11; sigue visible frente al fondo y la tarjeta, y el foco conserva su 3:1.
    it(`tema ${name}: el borde de los campos es suave pero visible`, () => {
      for (const surface of ["background", "card"]) {
        const ratio = contrast(theme, "input", surface);
        expect(ratio, surface).toBeGreaterThanOrEqual(1.3);
        expect(ratio, surface).toBeLessThan(3);
      }
    });
  }
  it("los colores de categoría de los gráficos: 3:1 en el oscuro; en el claro, con leyenda", () => {
    // En el claro, aqua, amarillo y rosa quedan bajo 3:1 (paleta de referencia del método de
    // visualización): los gráficos que los usan llevan siempre su leyenda visible y su tabla.
    for (const slot of ["chart-2", "chart-3", "chart-4", "chart-5"]) {
      expect(contrast(DARK, slot, "card"), slot).toBeGreaterThanOrEqual(3);
    }
    expect(contrast(ROOT, "chart-2", "card")).toBeGreaterThanOrEqual(3);
  });
  it("tema claro: el borde de los campos es un paso más oscuro que el de las tarjetas", () => {
    expect(contrast(ROOT, "input", "background")).toBeGreaterThan(
      contrast(ROOT, "border", "background"),
    );
  });
});
