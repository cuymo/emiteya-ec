// Revisión visual como ojos del agente (productize-invoice-editor-and-composition-foundation, design
// D17 y D18). Captura la matriz sobre el build de producción y el harness determinista, mide la
// composición y escribe las hojas de contacto en `frontend/.review/visual/<etiqueta>/`. No compara
// imágenes ni juzga la estética: falla solo si una pantalla no se puede alcanzar o capturar, si la
// página lanza un error, si hay peticiones a otro origen o si una ruta de la API no tiene datos.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Browser } from "@playwright/test";
import { BASE_URL, openPage, settle } from "../fixtures";
import { measureComposition } from "./geometry";
import { captures, type Capture } from "./matrix";
import { BUILD, COMMIT, OUTPUT, writeSheets, type Entry } from "./output";

const MATRIX = captures();

// Las pruebas de este archivo corren en orden con un solo worker: preparar, capturar y resumir. Con
// `REVIEW_FILTER`, la carpeta se conserva y solo se reescriben las capturas del subconjunto.
test("preparar la carpeta de la revisión", () => {
  if (!process.env.REVIEW_FILTER) rmSync(OUTPUT, { recursive: true, force: true });
  for (const folder of ["screenshots", "geometry", "contact-sheets"]) {
    mkdirSync(join(OUTPUT, folder), { recursive: true });
  }
});

async function capture({ state, width, theme, key }: Capture, browser: Browser) {
  const { page, recorder } = await openPage(
    browser,
    { persona: "admin", ...state.scenario },
    {
      viewport: width.viewport,
      deviceScaleFactor: width.scale,
      colorScheme: theme === "oscuro" ? "dark" : "light",
    },
  );
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  if (width.collapsed) {
    await page.context().addCookies([{ name: "sidebar_state", value: "false", url: BASE_URL }]);
  }
  await page.goto(state.path);
  await settle(page);
  await state.ready(page);
  if (state.act) {
    await state.act(page, width);
    await settle(page);
  }
  // Una acción puede dejar la página desplazada: la captura entera empieza siempre arriba.
  if (!state.viewportOnly) await page.evaluate(() => window.scrollTo(0, 0));
  const screenshot = `screenshots/${key}.png`;
  await page.screenshot({
    path: join(OUTPUT, screenshot),
    fullPage: !state.viewportOnly,
    animations: "disabled",
    caret: "hide",
    scale: "css",
  });
  const geometry = await page.evaluate(measureComposition);
  const meta: Entry = {
    key,
    route: state.route,
    state: state.state,
    path: state.path,
    group: state.group,
    width: width.key,
    viewport: width.viewport,
    scale: width.scale,
    collapsed: width.collapsed,
    theme,
    screenshot,
    geometry: `geometry/${key}.json`,
    commit: COMMIT,
    build: BUILD,
    date: new Date().toISOString(),
  };
  writeFileSync(join(OUTPUT, meta.geometry), `${JSON.stringify({ meta, geometry }, null, 2)}\n`);
  await page.context().close();
  return { errors, recorder };
}

for (const entry of MATRIX) {
  test(entry.key, async ({ browser }) => {
    const { errors, recorder } = await capture(entry, browser);
    expect(errors, "errores de la página").toEqual([]);
    expect(recorder.external, "peticiones a otro origen").toEqual([]);
    expect(recorder.unexpected, "rutas de la API sin datos de prueba").toEqual([]);
  });
}

test("hojas de contacto y manifiesto", async ({ browser }) => {
  test.setTimeout(600_000);
  const { missing } = await writeSheets(
    browser,
    MATRIX.map((entry) => entry.key),
  );
  expect(missing, "capturas de la matriz que faltan").toEqual([]);
});
