// ERS AC-04 en ejecución aislada (docs/quality/testing.md). La prueba mide 120 reservas simultáneas
// con la configuración de transacción por defecto de Prisma; junto al resto de la suite en
// paralelo, la carga de la máquina, no la numeración, puede agotar el tiempo para empezar una
// transacción. Aislarla elimina esa interferencia sin cambiar sus invariantes ni `maxWait`.
import { defineConfig } from "vitest/config";
import { AC04_TEST } from "./vitest.config.ts";

export default defineConfig({
  resolve: { conditions: ["development"] },
  test: {
    name: "backend-ac04",
    include: [AC04_TEST],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
