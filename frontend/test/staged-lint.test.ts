// Prevención de duplicación escalonada (adopt-premium-design-foundation-and-shell, design D19): ESLint
// con la configuración real del frontend detecta cada infracción en el código nuevo del shell, acepta el
// código correcto y deja el código heredado con sus reglas de siempre.
import { join } from "node:path";
import { ESLint } from "eslint";
import { beforeAll, describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
let eslint: ESLint;

// El primer análisis carga la configuración y los plugins: se hace aquí, con margen, para que bajo
// carga no agote el tiempo de la primera prueba.
beforeAll(async () => {
  eslint = new ESLint({ cwd: ROOT, overrideConfigFile: join(ROOT, "eslint.config.js") });
  await eslint.lintText("export {};\n", {
    filePath: join(ROOT, "src/components/shell/warmup.tsx"),
  });
}, 60_000);

async function lint(code: string, file: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: join(ROOT, file) });
  return (result?.messages ?? []).map((message) => message.message);
}

const SHELL = "src/components/shell/sample.tsx";
const BUTTON = 'import { Button } from "@/components/ui/button";\n';

describe("reglas del código nuevo del shell", () => {
  it("prohíbe importar Radix directamente", async () => {
    const messages = await lint('import { Dialog } from "radix-ui";\nexport { Dialog };\n', SHELL);
    // ESLint antepone a los mensajes de no-restricted-imports el nombre del módulo.
    expect(messages.some((message) => message.endsWith("no Radix directamente."))).toBe(true);
  });

  it("prohíbe los componentes heredados", async () => {
    const messages = await lint(
      'import { Tooltip } from "@/components/ui/menu-and-tooltip";\nexport { Tooltip };\n',
      SHELL,
    );
    expect(messages.some((message) => message.endsWith("usa los primitivos derivados."))).toBe(
      true,
    );
  });

  it("prohíbe valores arbitrarios y colores literales", async () => {
    const messages = await lint(
      'export const A = () => <div className="w-[13px] text-[#ff0000]" />;\n',
      SHELL,
    );
    expect(messages).toContain(
      "Sin valores arbitrarios de Tailwind: usa los tokens y las escalas.",
    );
    expect(messages).toContain("Sin colores literales: usa los tokens semánticos.");
  });

  it("prohíbe los tamaños legacy-*, el atributo style y Button sin tamaño", async () => {
    const messages = await lint(
      `${BUTTON}export const A = () => (\n  <>\n    <Button size="legacy-md">a</Button>\n    <Button>b</Button>\n    <div style={{ color: "red" }} />\n  </>\n);\n`,
      SHELL,
    );
    expect(messages).toContain("Los tamaños legacy-* son solo para pantallas sin migrar.");
    expect(messages).toContain("Pasa un tamaño de la escala aprobada a Button.");
    expect(messages).toContain("Sin atributo style: la CSP lo bloquea en el HTML del servidor.");
  });

  it("acepta el código correcto: tokens, variantes arbitrarias y tamaños aprobados", async () => {
    const messages = await lint(
      `${BUTTON}export const A = () => (\n  <Button size="sm" variant="outline" className="data-[side=right]:w-4 w-(--sidebar-width) bg-primary">\n    a\n  </Button>\n);\n`,
      SHELL,
    );
    expect(messages).toEqual([]);
  });
});

describe("aplicación escalonada", () => {
  it("en los primitivos solo se prohíbe style; sus valores internos de la plantilla siguen", async () => {
    const ui = "src/components/ui/sample.tsx";
    expect(await lint('export const A = () => <div className="w-[13px]" />;\n', ui)).toEqual([]);
    expect(await lint("export const A = () => <div style={{}} />;\n", ui)).toContain(
      "Sin atributo style: la CSP lo bloquea en el HTML del servidor.",
    );
  });

  it("el código heredado conserva sus reglas", async () => {
    const legacy = "src/features/sample/sample.tsx";
    const messages = await lint(
      `${BUTTON}export const A = () => <Button size="legacy-md" className="w-[13px]">a</Button>;\n`,
      legacy,
    );
    expect(messages).toEqual([]);
  });
});

describe("base de listas y Facturas (productize-invoice-list-and-shared-table-foundation, D19)", () => {
  const MIGRATED = [
    "src/features/invoices/invoices-screen.tsx",
    "src/components/data-table/data-table-sample.tsx",
    "src/components/layout/sample.tsx",
    "src/features/documents/sample.tsx",
  ];

  it("la pantalla migrada y la base no importan states, Radix ni tamaños legacy-*", async () => {
    for (const file of MIGRATED) {
      const messages = await lint(
        `import { Dialog } from "radix-ui";\nimport { EmptyState } from "@/components/states";\n${BUTTON}export const A = () => <Button size="legacy-sm">a</Button>;\nexport { Dialog, EmptyState };\n`,
        file,
      );
      expect(
        messages.some((message) => message.endsWith("no Radix directamente.")),
        file,
      ).toBe(true);
      expect(
        messages.some((message) => message.endsWith("usa los primitivos derivados.")),
        file,
      ).toBe(true);
      expect(messages, file).toContain("Los tamaños legacy-* son solo para pantallas sin migrar.");
    }
  });

  it("los archivos reales de la base y de Facturas cumplen las reglas", async () => {
    const results = await eslint.lintFiles([
      "src/features/invoices/invoices-screen.tsx",
      "src/components/data-table/data-table*.tsx",
      "src/components/data-table/row-actions-menu.tsx",
      "src/components/layout/**/*.tsx",
      "src/features/documents/**/*.tsx",
      "src/hooks/use-list-url-state.ts",
    ]);
    expect(
      results.flatMap((result) => result.messages.map((m) => `${result.filePath}: ${m.message}`)),
    ).toEqual([]);
  });

  it("las listas heredadas conservan sus reglas mientras no migran", async () => {
    const messages = await lint(
      'import { EmptyState } from "@/components/states";\nexport { EmptyState };\n',
      "src/components/data-table/app-data-table.tsx",
    );
    expect(messages).toEqual([]);
  });
});

describe("composición de formularios y ambiente (productize-invoice-editor-and-composition-foundation, 5.5)", () => {
  const STRICT = [
    "src/components/layout/form-layout.tsx",
    "src/components/layout/form-grid.tsx",
    "src/components/layout/form-section.tsx",
    "src/features/company/environment-notice.tsx",
    "src/features/company/emission-environment-notice.tsx",
  ];

  it("los primitivos de formulario y los avisos del ambiente están en la lista estricta", async () => {
    for (const file of STRICT) {
      const messages = await lint(
        `import { Dialog } from "radix-ui";\nexport const A = () => <div className="w-[13rem]" />;\nexport { Dialog };\n`,
        file,
      );
      expect(
        messages.some((message) => message.endsWith("no Radix directamente.")),
        file,
      ).toBe(true);
      expect(messages, file).toContain(
        "Sin valores arbitrarios de Tailwind: usa los tokens y las escalas.",
      );
    }
  });

  it("los archivos reales cumplen las reglas", async () => {
    const results = await eslint.lintFiles(STRICT);
    expect(
      results.flatMap((result) => result.messages.map((m) => `${result.filePath}: ${m.message}`)),
    ).toEqual([]);
  });
});
