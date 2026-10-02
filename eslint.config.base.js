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

const domainRestrictions = {
  patterns: [
    { group: ["express", "express/**"], message: "El dominio no depende del framework HTTP." },
    {
      group: ["@prisma/**", "prisma", "pg", "**/generated", "**/generated/**"],
      message: "El dominio no depende de la base de datos ni del código generado.",
    },
    infrastructureImports,
  ],
};

const applicationRestrictions = {
  patterns: [
    { group: ["express", "express/**"], message: "Los casos de uso no reciben objetos HTTP." },
    infrastructureImports,
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
      files: ["**/modules/*/domain/**/*.ts"],
      rules: { "no-restricted-imports": ["error", domainRestrictions] },
    },
    {
      files: ["**/modules/*/application/**/*.ts"],
      rules: { "no-restricted-imports": ["error", applicationRestrictions] },
    },
  );
}
