// Verifica que las reglas de capas de ESLint (eslint.config.base.js) se aplican a los módulos.
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const backendRoot = fileURLToPath(new URL("../..", import.meta.url));
const fixtures = "test/fixtures/lint/modules/example";
// Los fixtures están ignorados en el lint normal; la prueba los analiza de forma explícita.
const eslint = new ESLint({ cwd: backendRoot, ignore: false });

async function restrictedImports(file: string): Promise<number> {
  const [result] = await eslint.lintFiles([`${fixtures}/${file}`]);
  return result?.messages.filter((m) => m.ruleId === "no-restricted-imports").length ?? 0;
}

describe("reglas de capas", () => {
  it("domain no importa express", async () => {
    expect(await restrictedImports("domain/imports-express.ts")).toBe(1);
  });

  it("domain no importa infrastructure", async () => {
    expect(await restrictedImports("domain/imports-infrastructure.ts")).toBe(1);
  });

  it("domain no importa el cliente generado de Prisma", async () => {
    expect(await restrictedImports("domain/imports-generated.ts")).toBe(1);
  });

  it("application no importa infrastructure", async () => {
    expect(await restrictedImports("application/imports-infrastructure.ts")).toBe(1);
  });

  it("infrastructure puede importar express y otros adaptadores", async () => {
    expect(await restrictedImports("infrastructure/imports-allowed.ts")).toBe(0);
  });
});
