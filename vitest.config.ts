import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "backend",
      "packages/contracts",
      "frontend",
      {
        test: {
          name: "scripts",
          include: ["scripts/**/*.test.ts"],
          // Necesita el binario de Gitleaks fijado: corre con `test:secret-rules`
          // (scripts/security/vitest.gitleaks.config.ts), en local y en el workflow de seguridad.
          exclude: [...configDefaults.exclude, "scripts/security/gitleaks-rules.test.ts"],
          environment: "node",
        },
      },
    ],
  },
});
