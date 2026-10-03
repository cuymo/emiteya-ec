import { defineProject } from "vitest/config";

/** ERS AC-04 se ejecuta aparte, aislada de la carga de la suite (vitest.ac04.config.ts). */
export const AC04_TEST = "test/integration/fiscal-ac04.test.ts";

export default defineProject({
  resolve: { conditions: ["development"] },
  test: {
    name: "backend",
    include: ["test/**/*.test.ts"],
    exclude: ["test/fixtures/**", AC04_TEST],
    // P12 sintéticos generados una vez por ejecución (add-signing-certificate, design D16).
    globalSetup: ["test/support/p12-global-setup.ts"],
    // Varias pruebas lanzan procesos (main.ts, prisma migrate, el CLI auth) y crean un esquema
    // migrado por archivo; con todos los archivos en paralelo, 5 s no bastan. Los procesos lanzados
    // tienen su propio límite de 90 s.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
