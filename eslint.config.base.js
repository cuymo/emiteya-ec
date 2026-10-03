// Configuración ESLint compartida por los paquetes Node (backend, contracts).
// Cada paquete la extiende desde su propio eslint.config.js.
import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

const infrastructureImports = {
  group: ["**/infrastructure", "**/infrastructure/**"],
  message:
    "Las capas domain y application no dependen de infrastructure (docs/architecture/backend.md).",
};

// Better Auth solo se importa dentro de su módulo de integración (design D2b de add-user-access).
const BETTER_AUTH_MODULE = "**/modules/identity/infrastructure/better-auth/**";
const betterAuthImports = {
  // Solo nombres de paquete: las rutas relativas hacia el módulo (su index.ts) están permitidas.
  regex: "^(?:better-auth|@better-auth/[^/]+|auth)(?:/.*)?$",
  message:
    "Better Auth solo se usa dentro de modules/identity/infrastructure/better-auth/; el resto usa su puerto de identidad.",
};

// El motor SRI y el validador XSD solo se importan desde su adaptador (ADR 0018 y 0021), y
// node-forge solo desde el lector de PKCS#12 (ADR 0019); el resto usa sus puertos.
const SRI_ENGINE_MODULE = "**/modules/sri-engine/infrastructure/**";
const sriEngineImports = {
  regex: "^(?:facturacion-electronica-ec|ec-sri-invoice-signer|xmllint-wasm)(?:/.*)?$",
  message:
    "facturacion-electronica-ec, ec-sri-invoice-signer y xmllint-wasm solo se usan dentro de modules/sri-engine/infrastructure/ (ADR 0018 y 0021).",
};
// El generador de P12 sintéticos de las pruebas también usa node-forge: no es código de producto.
const PKCS12_READER_MODULE = [
  "**/modules/signing/infrastructure/pkcs12/**",
  "**/test/support/p12-fixtures.ts",
];
const forgeImports = {
  regex: "^node-forge(?:/.*)?$",
  message:
    "node-forge solo se usa en el lector de PKCS#12, modules/signing/infrastructure/pkcs12/ (ADR 0019).",
};

const domainRestrictions = {
  patterns: [
    { group: ["express", "express/**"], message: "El dominio no depende del framework HTTP." },
    {
      group: ["@prisma/**", "prisma", "pg", "**/generated", "**/generated/**"],
      message: "El dominio no depende de la base de datos ni del código generado.",
    },
    infrastructureImports,
    betterAuthImports,
    sriEngineImports,
    forgeImports,
  ],
};

const applicationRestrictions = {
  patterns: [
    { group: ["express", "express/**"], message: "Los casos de uso no reciben objetos HTTP." },
    infrastructureImports,
    betterAuthImports,
    sriEngineImports,
    forgeImports,
  ],
};

/**
 * @param {{ tsconfigRootDir: string, typedFiles?: string[] }} options
 */
export function nodeConfig({ tsconfigRootDir, typedFiles = ["src/**/*.ts", "test/**/*.ts"] }) {
  return defineConfig(
    { ignores: ["dist/**", "coverage/**", "src/generated/**", "test/fixtures/**"] },
    js.configs.recommended,
    tseslint.configs.recommended,
    {
      rules: {
        "@typescript-eslint/no-unused-vars": [
          "error",
          { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
        ],
      },
    },
    {
      files: typedFiles,
      ignores: ["test/fixtures/**"],
      extends: [tseslint.configs.recommendedTypeChecked],
      languageOptions: { parserOptions: { projectService: true, tsconfigRootDir } },
    },
    {
      // Van antes que las reglas de capas, que repiten estos patrones porque sustituyen la regla.
      files: ["**/*.ts"],
      ignores: [BETTER_AUTH_MODULE, SRI_ENGINE_MODULE, ...PKCS12_READER_MODULE],
      rules: {
        "no-restricted-imports": [
          "error",
          { patterns: [betterAuthImports, sriEngineImports, forgeImports] },
        ],
      },
    },
    {
      files: [BETTER_AUTH_MODULE],
      rules: { "no-restricted-imports": ["error", { patterns: [sriEngineImports, forgeImports] }] },
    },
    {
      files: [SRI_ENGINE_MODULE],
      rules: {
        "no-restricted-imports": ["error", { patterns: [betterAuthImports, forgeImports] }],
      },
    },
    {
      files: PKCS12_READER_MODULE,
      rules: {
        "no-restricted-imports": ["error", { patterns: [betterAuthImports, sriEngineImports] }],
      },
    },
    {
      files: ["**/modules/*/domain/**/*.ts"],
      rules: { "no-restricted-imports": ["error", domainRestrictions] },
    },
    {
      files: ["**/modules/*/application/**/*.ts"],
      rules: { "no-restricted-imports": ["error", applicationRestrictions] },
    },
  );
}
