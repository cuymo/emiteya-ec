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

const domainRestrictions = {
  patterns: [
    { group: ["express", "express/**"], message: "El dominio no depende del framework HTTP." },
    {
      group: ["@prisma/**", "prisma", "pg", "**/generated", "**/generated/**"],
      message: "El dominio no depende de la base de datos ni del código generado.",
    },
    infrastructureImports,
    betterAuthImports,
  ],
};

const applicationRestrictions = {
  patterns: [
    { group: ["express", "express/**"], message: "Los casos de uso no reciben objetos HTTP." },
    infrastructureImports,
    betterAuthImports,
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
      // Va antes que las reglas de capas, que repiten este patrón porque sustituyen la regla.
      files: ["**/*.ts"],
      ignores: [BETTER_AUTH_MODULE],
      rules: { "no-restricted-imports": ["error", { patterns: [betterAuthImports] }] },
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
