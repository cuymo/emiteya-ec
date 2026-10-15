// Medición de la carga de las pantallas representativas (design D20), con el mismo método antes y
// después del cambio: los bytes de JavaScript, CSS y fuentes que el navegador descarga del build de
// producción hasta que la red queda en calma, según los eventos de red de Playwright. Next 16 con
// Turbopack ya no imprime tamaños por ruta. Registra también las peticiones a `/api/v1` de cada
// pantalla (productize-invoice-list-and-shared-table-foundation, D18), para comparar el patrón de
// peticiones. Escribe `test-results/bundle.json`; no compara nada.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "@playwright/test";
import { openPage, settle, type Scenario } from "../fixtures";

const ROUTES: { name: string; path: string; scenario: Scenario }[] = [
  { name: "login", path: "/iniciar-sesion", scenario: { persona: "anonymous" } },
  { name: "inicio", path: "/", scenario: { persona: "admin" } },
  { name: "facturas", path: "/facturas", scenario: { persona: "admin" } },
  // productize-invoice-editor-and-composition-foundation, tarea 1.4: el editor de facturas.
  { name: "nueva-factura", path: "/borradores/nuevo", scenario: { persona: "admin" } },
];

type Totals = { files: number; transferred: number; decoded: number };

test("carga de las pantallas representativas", async ({ browser }) => {
  const result: Record<string, { assets: Record<string, Totals>; api: string[] }> = {};
  for (const route of ROUTES) {
    const { page } = await openPage(browser, route.scenario);
    const totals: Record<string, Totals> = {};
    const api: string[] = [];
    const pending: Promise<void>[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith("/api/v1/"))
        api.push(`${request.method()} ${url.pathname}${url.search}`);
    });
    page.on("requestfinished", (request) => {
      const path = new URL(request.url()).pathname;
      const kind = path.endsWith(".js")
        ? "js"
        : path.endsWith(".css")
          ? "css"
          : /\.(woff2?|ttf|otf)$/.test(path)
            ? "font"
            : null;
      if (!kind) return;
      pending.push(
        (async () => {
          const sizes = await request.sizes();
          const response = await request.response();
          const body = response ? await response.body() : Buffer.alloc(0);
          const bucket = (totals[kind] ??= { files: 0, transferred: 0, decoded: 0 });
          bucket.files += 1;
          bucket.transferred += sizes.responseBodySize;
          bucket.decoded += body.length;
        })(),
      );
    });
    await page.goto(route.path);
    await settle(page);
    await Promise.all(pending);
    result[route.name] = { assets: totals, api: api.sort() };
    await page.context().close();
  }
  writeFileSync(join("test-results", "bundle.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
});
