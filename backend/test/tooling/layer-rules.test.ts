// Verifica que las reglas de capas de ESLint (eslint.config.base.js) se aplican a los módulos.
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const backendRoot = fileURLToPath(new URL("../..", import.meta.url));
const fixtures = "test/fixtures/lint/modules/example";
// Los fixtures están ignorados en el lint normal; la prueba los analiza de forma explícita.
const eslint = new ESLint({ cwd: backendRoot, ignore: false });

async function restrictedImports(file: string, base = fixtures): Promise<number> {
  const [result] = await eslint.lintFiles([`${base}/${file}`]);
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

describe("módulo único de integración con Better Auth", () => {
  it("infrastructure fuera del módulo no importa better-auth ni @better-auth/*", async () => {
    expect(await restrictedImports("infrastructure/imports-better-auth.ts")).toBe(2);
  });

  it("application no importa better-auth", async () => {
    expect(await restrictedImports("application/imports-better-auth.ts")).toBe(1);
  });

  it("el módulo de integración sí importa Better Auth", async () => {
    expect(
      await restrictedImports(
        "allowed.ts",
        "test/fixtures/lint/modules/identity/infrastructure/better-auth",
      ),
    ).toBe(0);
  });
});

describe("frontera del motor SRI y de node-forge (ADR 0018 y 0019)", () => {
  it("infrastructure fuera de sri-engine no importa facturacion-electronica-ec ni ec-sri-invoice-signer", async () => {
    expect(await restrictedImports("infrastructure/imports-sri-engine.ts")).toBe(2);
  });

  it("application no importa el motor SRI", async () => {
    expect(await restrictedImports("application/imports-sri-engine.ts")).toBe(1);
  });

  it("el adaptador de sri-engine sí importa la librería y su firmador", async () => {
    expect(
      await restrictedImports("allowed.ts", "test/fixtures/lint/modules/sri-engine/infrastructure"),
    ).toBe(0);
  });

  it("node-forge solo se importa en el lector de PKCS#12", async () => {
    expect(await restrictedImports("infrastructure/imports-forge.ts")).toBe(1);
    expect(
      await restrictedImports(
        "imports-forge.ts",
        "test/fixtures/lint/modules/sri-engine/infrastructure",
      ),
    ).toBe(1);
    expect(
      await restrictedImports(
        "allowed.ts",
        "test/fixtures/lint/modules/signing/infrastructure/pkcs12",
      ),
    ).toBe(0);
  });
});
