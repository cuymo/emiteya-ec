// Harness de regresión visual local (adopt-premium-design-foundation-and-shell, design D17). Usa el
// Chrome del sistema, sin descargar navegadores, contra el build de producción del frontend. La API se
// simula en el navegador con datos deterministas (visual/fixtures.ts): no hace falta backend y nunca
// hay tráfico al SRI. No forma parte de `verify`; las imágenes base solo se escriben con
// `--update-snapshots`, nunca de forma automática.
import { defineConfig, devices } from "@playwright/test";

const PORT = 4310;

export default defineConfig({
  testDir: "./visual",
  outputDir: "./test-results",
  // Una imagen base que falta es un fallo, no una escritura silenciosa.
  updateSnapshots: "none",
  snapshotPathTemplate: "{testDir}/{projectName}/__screenshots__/{arg}{ext}",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "./playwright-report" }]],
  timeout: 60_000,
  expect: {
    toHaveScreenshot: { animations: "disabled", caret: "hide", scale: "css" },
  },
  use: {
    ...devices["Desktop Chrome"],
    channel: "chrome",
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: "es-EC",
    timezoneId: "America/Guayaquil",
    reducedMotion: "reduce",
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  },
  projects: [
    {
      // A. Evidencia congelada del paso de la escala de 8 px a 4 px (design D3): cero píxeles.
      name: "spacing-proof",
      testMatch: /spacing-proof\/.*\.spec\.ts$/,
      expect: { toHaveScreenshot: { maxDiffPixels: 0, threshold: 0 } },
    },
    {
      // Medición de la carga, con el mismo método antes y después (design D20).
      name: "bundle",
      testMatch: /bundle\/.*\.spec\.ts$/,
    },
    {
      // B. Apariencia aprobada del shell premium. Tolerancia mínima documentada (testing.md) para el
      // suavizado del texto; cualquier cambio de diseño la supera.
      name: "shell",
      testMatch: /shell\/.*\.spec\.ts$/,
      expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.001 } },
    },
    {
      // C. Revisión visual (productize-invoice-editor-and-composition-foundation, design D17): captura
      // la matriz en `.review/visual/<etiqueta>/` para mirarla. No compara imágenes y nunca falla por
      // estética; fuera de `test:visual` y de `verify`.
      name: "review",
      testMatch: /review\/.*\.spec\.ts$/,
    },
  ],
  webServer: {
    command: "node_modules/.bin/next build && node_modules/.bin/next start --port 4310",
    url: `http://127.0.0.1:${PORT}/iniciar-sesion`,
    reuseExistingServer: false,
    timeout: 600_000,
    stdout: "ignore",
    stderr: "pipe",
    // El build de producción exige un destino interno de la API; el navegador nunca llega a él
    // porque cada `/api/v1` se responde en el propio navegador.
    env: { API_INTERNAL_URL: "http://127.0.0.1:4000", NEXT_TELEMETRY_DISABLED: "1" },
  },
});
