// Pruebas de las reglas de Gitleaks contra el binario fijado (add-ci-dependency-and-secret-scanning,
// design D7). Fuera del proyecto `scripts` por defecto, porque el job `verify` no tiene el binario.
import { join } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: join(import.meta.dirname, "..", ".."),
  test: {
    name: "secret-rules",
    include: ["scripts/security/gitleaks-rules.test.ts"],
    environment: "node",
    testTimeout: 60_000,
  },
});
