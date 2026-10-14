// Pruebas del codemod de un solo uso que pasa la escala de espaciado a base 4 (design D3).
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BASE_4,
  BASE_8,
  rebaseSource,
  rebaseText,
  rebaseToken,
  run,
} from "./rebase-spacing-to-4px.ts";

describe("rebaseToken", () => {
  it("duplica el número de las utilidades de espaciado", () => {
    expect(rebaseToken("p-2")).toBe("p-4");
    expect(rebaseToken("gap-x-1")).toBe("gap-x-2");
    expect(rebaseToken("size-2.5")).toBe("size-5");
    expect(rebaseToken("h-5.5")).toBe("h-11");
    expect(rebaseToken("mt-0.5")).toBe("mt-1");
    expect(rebaseToken("w-32")).toBe("w-64");
    expect(rebaseToken("max-w-32")).toBe("max-w-64");
    expect(rebaseToken("space-y-3")).toBe("space-y-6");
    expect(rebaseToken("translate-x-3")).toBe("translate-x-6");
  });

  it("conserva variantes, negativos e importante", () => {
    expect(rebaseToken("max-md:hover:h-5.5")).toBe("max-md:hover:h-11");
    expect(rebaseToken("-mt-1")).toBe("-mt-2");
    expect(rebaseToken("md:-translate-y-1")).toBe("md:-translate-y-2");
    expect(rebaseToken("!p-1")).toBe("!p-2");
    expect(rebaseToken("p-1!")).toBe("p-2!");
    expect(rebaseToken("[&>svg]:size-2.5")).toBe("[&>svg]:size-5");
    expect(rebaseToken("focus:top-2")).toBe("focus:top-4");
  });

  it("no toca lo que no multiplica la escala", () => {
    for (const token of [
      "p-0",
      "text-sm",
      "max-w-2xl",
      "outline-offset-2",
      "w-1/2",
      "h-[calc(100dvh-4rem)]",
      "w-px",
      "h-full",
      "rounded-md",
      "border-2",
      "z-(--z-toast)",
      "grid-cols-2",
      "sustento-",
      "001-001-000000123",
    ]) {
      expect(rebaseToken(token)).toBe(token);
    }
  });
});

describe("rebaseSource", () => {
  it("reescribe solo dentro de literales, también en plantillas", () => {
    const source = [
      'import { cn } from "@/lib/utils";',
      "const size = 5;",
      'export const a = <div className="p-2 text-sm" />;',
      "export const b = cn(`gap-1 ${size} h-5`, 'w-32');",
      "export const c = `sustento-${size}`;",
    ].join("\n");
    const { output, changes } = rebaseSource("x.tsx", source);
    expect(output).toContain('className="p-4 text-sm"');
    expect(output).toContain("`gap-2 ${size} h-10`");
    expect(output).toContain("'w-64'");
    expect(output).toContain("`sustento-${size}`");
    expect(output).toContain('from "@/lib/utils"');
    expect(output).toContain("const size = 5;");
    // La plantilla aporta dos partes: su cabeza y su cola.
    expect(changes).toHaveLength(4);
  });
});

describe("run", () => {
  function repo(css: string) {
    const root = mkdtempSync(join(tmpdir(), "rebase-"));
    mkdirSync(join(root, "frontend", "src", "app"), { recursive: true });
    writeFileSync(join(root, "frontend", "src", "app", "globals.css"), css);
    writeFileSync(join(root, "frontend", "src", "app", "page.tsx"), 'export const x = "p-2";\n');
    return root;
  }

  it("reescribe y fija la escala de base 4", () => {
    const root = repo(`@theme {\n  ${BASE_8}\n}\n`);
    expect(run(root, () => undefined)).toBe(0);
    expect(readFileSync(join(root, "frontend", "src", "app", "page.tsx"), "utf8")).toContain(
      '"p-4"',
    );
    expect(readFileSync(join(root, "frontend", "src", "app", "globals.css"), "utf8")).toContain(
      BASE_4,
    );
  });

  it("se niega a ejecutarse dos veces", () => {
    const root = repo(`@theme {\n  ${BASE_8}\n}\n`);
    expect(run(root, () => undefined)).toBe(0);
    expect(run(root, () => undefined)).toBe(1);
    expect(readFileSync(join(root, "frontend", "src", "app", "page.tsx"), "utf8")).toContain(
      '"p-4"',
    );
  });

  it("deja el texto sin espaciado intacto", () => {
    expect(rebaseText("  Facturas   p-1\n")).toBe("  Facturas   p-2\n");
  });
});
