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

async function restrictedFetch(file: string, base = fixtures): Promise<number> {
  const [result] = await eslint.lintFiles([`${base}/${file}`]);
  return (
    result?.messages.filter(
      (m) => m.ruleId === "no-restricted-globals" || m.ruleId === "no-restricted-properties",
    ).length ?? 0
  );
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

  it("el módulo de catálogos no importa facturacion-electronica-ec en ninguna capa (ADR 0020)", async () => {
    for (const layer of ["domain", "application", "infrastructure"]) {
      expect(
        await restrictedImports(
          "imports-sri-engine.ts",
          `test/fixtures/lint/modules/catalogs/${layer}`,
        ),
        layer,
      ).toBe(1);
    }
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

describe("transporte SOAP propio (add-sri-transmission, design D10 y D11)", () => {
  it("fuera de sri-engine no se llama a fetch, ni como global ni por globalThis", async () => {
    expect(await restrictedFetch("infrastructure/uses-fetch.ts")).toBe(2);
  });

  it("application no importa el parser XML", async () => {
    expect(await restrictedImports("application/imports-xml-parser.ts")).toBe(1);
  });

  it("el adaptador de sri-engine sí usa fetch y el parser XML", async () => {
    const base = "test/fixtures/lint/modules/sri-engine/infrastructure";
    expect(await restrictedFetch("allowed-transport.ts", base)).toBe(0);
    expect(await restrictedImports("allowed-transport.ts", base)).toBe(0);
  });
});
