// Facturas sobre la base compartida (productize-invoice-list-and-shared-table-foundation, design D15
// a D17, tareas 9.1 y 9.2): el recorrido de teclado real, axe con WCAG 2.2 AA, las anchuras medidas
// en el navegador (container queries que jsdom no aplica) y el conjunto canónico de capturas.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  BASE_URL,
  DESKTOP,
  INVOICE_CATALOG,
  MOBILE,
  PRODUCTION_INVOICES,
  openPage,
  settle,
  type Recorder,
  type Scenario,
} from "../fixtures";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const CATALOG: Scenario = { persona: "admin", invoices: INVOICE_CATALOG };
const FIRST = "001-001-000000140";
const SECOND = "001-001-000000139";

type Options = {
  scenario?: Scenario;
  viewport?: { width: number; height: number };
  colorScheme?: "light" | "dark";
  collapsed?: boolean;
};

async function open(
  browser: Browser,
  path: string,
  options: Options = {},
): Promise<{ page: Page; recorder: Recorder }> {
  const { page, recorder } = await openPage(browser, options.scenario ?? CATALOG, {
    viewport: options.viewport ?? DESKTOP,
    colorScheme: options.colorScheme ?? "light",
  });
  if (options.collapsed) {
    await page.context().addCookies([{ name: "sidebar_state", value: "false", url: BASE_URL }]);
  }
  await page.goto(path);
  await settle(page);
  return { page, recorder };
}

const table = (page: Page) => page.getByRole("table", { name: "Facturas emitidas" });

async function violations(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return result.violations.map((violation) => ({
    id: violation.id,
    nodes: violation.nodes.map((node) => node.target.join(" ")),
  }));
}

/** La página no se desplaza a lo ancho. */
const pageOverflowX = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** Cuántas líneas ocupa cada elemento: su alto entre su alto de línea. */
async function lineCounts(page: Page, selector: string): Promise<number[]> {
  return page.locator(selector).evaluateAll((elements) =>
    elements
      .filter((element) => element.getClientRects().length > 0)
      .map((element) => {
        const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight);
        return Math.round(element.getBoundingClientRect().height / lineHeight);
      }),
  );
}

test.describe("teclado de Facturas (D16)", () => {
  test("acción principal, búsqueda, vistas con flechas, estado, número y menú con su foco", async ({
    browser,
  }) => {
    const { page } = await open(browser, "/facturas");
    await page.locator("main#contenido").focus();
    const tab = () => page.keyboard.press("Tab");
    await tab();
    await expect(page.getByRole("link", { name: "Nueva factura" })).toBeFocused();
    await tab();
    await expect(
      page.getByRole("searchbox", { name: "Buscar por número, comprador o identificación" }),
    ).toBeFocused();
    await tab();
    await expect(page.getByRole("radio", { name: "Todas" })).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("radio", { name: "Requiere atención 3" })).toBeFocused();
    await tab();
    await expect(page.getByRole("button", { name: "Estado", exact: true })).toBeFocused();
    // Cada fila: el número y su menú, sin parada en la fila ni en la copia oculta del menú.
    await tab();
    await expect(table(page).getByRole("link", { name: FIRST })).toBeFocused();
    await tab();
    const menu = page.getByRole("button", { name: `Acciones de la factura ${FIRST}` });
    await expect(menu).toHaveCount(1);
    await expect(menu).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menuitem", { name: "Ver factura" })).toBeFocused();
    // La ayuda «Acciones» no tapa el menú abierto.
    await expect(page.getByRole("tooltip", { name: "Acciones" })).toHaveCount(0);
    await expect(page.getByRole("menuitem")).toHaveCount(2);
    await page.keyboard.press("Escape");
    await expect(menu).toBeFocused();
    await tab();
    await expect(table(page).getByRole("link", { name: SECOND })).toBeFocused();
    // «Verificando con el SRI» lleva su ayuda, con foco y con su texto.
    await tab();
    const help = page.getByRole("button", { name: "Qué significa «Verificando con el SRI»" });
    await expect(help).toBeFocused();
    await expect(
      page.getByRole("tooltip").filter({ hasText: "No emitas esta venta nuevamente." }),
    ).toHaveCount(1);
    await page.context().close();
  });
});

test.describe("accesibilidad de Facturas (D17)", () => {
  for (const [name, path, viewport, colorScheme] of [
    ["escritorio claro", "/facturas", DESKTOP, "light"],
    ["escritorio oscuro", "/facturas", DESKTOP, "dark"],
    ["vista «Requiere atención»", "/facturas?vista=atencion", DESKTOP, "light"],
    ["móvil", "/facturas", MOBILE, "light"],
  ] as const) {
    test(`${name}: sin violaciones de WCAG 2.2 AA`, async ({ browser }) => {
      const { page } = await open(browser, path, { viewport, colorScheme });
      expect(await violations(page)).toEqual([]);
      await page.context().close();
    });
  }

  test("con el menú de una fila abierto", async ({ browser }) => {
    const { page } = await open(browser, "/facturas");
    await page.getByRole("button", { name: `Acciones de la factura ${FIRST}` }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    expect(await violations(page)).toEqual([]);
    await page.context().close();
  });
});

test.describe("lectura a cualquier anchura (D15)", () => {
  for (const [width, collapsed, layout] of [
    [1024, false, "amplia"],
    [1024, true, "amplia"],
    [768, false, "compacta"],
    [768, true, "amplia"],
    // 1280 px al 200 % de zoom.
    [640, false, "compacta"],
  ] as const) {
    test(`${width} px, barra ${collapsed ? "colapsada" : "expandida"}: distribución ${layout}, número y total en una línea`, async ({
      browser,
    }) => {
      const { page } = await open(browser, "/facturas", {
        viewport: { width, height: 768 },
        collapsed,
      });
      await expect(table(page).getByRole("columnheader", { name: "Estado" })).toBeVisible({
        visible: layout === "amplia",
      });
      const numbers = await lineCounts(page, "[data-slot=table] a[href^='/facturas/']");
      expect(numbers).toHaveLength(INVOICE_CATALOG.length);
      expect(numbers.every((lines) => lines === 1)).toBe(true);
      const totals = await table(page)
        .getByText(/^USD /)
        .evaluateAll((elements) =>
          elements.map((element) => {
            const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight);
            return Math.round(element.getBoundingClientRect().height / lineHeight);
          }),
        );
      expect(totals).toHaveLength(INVOICE_CATALOG.length);
      expect(totals.every((lines) => lines === 1)).toBe(true);
      if (layout === "amplia") {
        // El estado se lee junto al número: es la columna siguiente.
        const number = await table(page).getByRole("link", { name: FIRST }).boundingBox();
        const state = await table(page)
          .getByText("Autorizado")
          .filter({ visible: true })
          .first()
          .boundingBox();
        expect(state!.x - (number!.x + number!.width)).toBeLessThan(80);
      }
      // Cabe sin desplazar la tabla ni la página.
      const container = page.locator("[data-slot=table-container]");
      expect(await container.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
      expect(await pageOverflowX(page)).toBe(0);
      await page.context().close();
    });
  }

  test("390 px: número, comprador, estado y total dentro de la tabla, sin desbordar la página", async ({
    browser,
  }) => {
    const { page } = await open(browser, "/facturas", { viewport: MOBILE });
    const frame = await page.locator("[data-slot=data-table]").boundingBox();
    const row = table(page).getByRole("row").filter({ hasText: FIRST });
    for (const part of [
      row.getByRole("link", { name: FIRST }),
      row.getByText("EL PERNO CIA. LTDA.").filter({ visible: true }),
      row.getByText("Autorizado").filter({ visible: true }),
      row.getByText("USD 28,75"),
    ]) {
      await expect(part).toBeVisible();
      const box = (await part.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(frame!.x);
      expect(box.x + box.width).toBeLessThanOrEqual(frame!.x + frame!.width);
    }
    await expect(row.getByRole("button", { name: `Acciones de la factura ${FIRST}` })).toHaveCount(
      1,
    );
    const container = page.locator("[data-slot=table-container]");
    expect(await container.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
    expect(await pageOverflowX(page)).toBe(0);
    await page.context().close();
  });

  test("320 px: si no cabe, se desplaza solo la tabla", async ({ browser }) => {
    const { page } = await open(browser, "/facturas", { viewport: { width: 320, height: 700 } });
    await expect(table(page).getByRole("link", { name: FIRST })).toBeVisible();
    const container = page.locator("[data-slot=table-container]");
    expect(await container.evaluate((el) => getComputedStyle(el).overflowX)).toBe("auto");
    expect(await pageOverflowX(page)).toBe(0);
    await page.context().close();
  });
});

test.describe("peticiones de Facturas (D18)", () => {
  test("la lista y un conteo; el conteo no se repite al filtrar, buscar ni cambiar las filas", async ({
    browser,
  }) => {
    const { page } = await openPage(browser, CATALOG);
    const requests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith("/api/v1/invoices"))
        requests.push(`${url.pathname}${url.search}`);
    });
    const counts = () =>
      requests.filter((key) => key === "/api/v1/invoices?attention=true&pageSize=1");
    await page.goto("/facturas");
    await settle(page);
    expect(counts()).toHaveLength(1);
    expect(requests.filter((key) => key.includes("page="))).toHaveLength(1);
    await page.getByRole("button", { name: "Estado", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "Devuelto" }).click();
    await expect(page).toHaveURL(/estado=devueltas/);
    await settle(page);
    await page.getByRole("radio", { name: /Requiere atención/ }).click();
    await expect(page).toHaveURL(/vista=atencion/);
    await settle(page);
    await page.getByRole("searchbox").fill("Andina");
    await expect(page).toHaveURL(/q=Andina/);
    await settle(page);
    await page.getByRole("button", { name: "Limpiar filtros" }).first().click();
    await expect(page).toHaveURL(/\/facturas$/);
    await settle(page);
    await page.getByRole("combobox", { name: "Filas por página" }).selectOption("10");
    await expect(page).toHaveURL(/filas=10/);
    await settle(page);
    expect(counts()).toHaveLength(1);
    // Sin consultas por fila: ningún detalle, RIDE ni estado de una factura.
    expect(requests.filter((key) => !key.startsWith("/api/v1/invoices?"))).toEqual([]);
    await page.context().close();
  });
});

async function finish(page: Page, recorder: Recorder, name: string) {
  await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
  expect(recorder.external, "peticiones a otros orígenes").toEqual([]);
  expect(recorder.unexpected, "rutas de la API sin datos de prueba").toEqual([]);
  await page.context().close();
}

test.describe("capturas de Facturas (D17)", () => {
  test("escritorio claro con datos", async ({ browser }) => {
    const { page, recorder } = await open(browser, "/facturas");
    await expect(table(page).getByRole("link", { name: FIRST })).toBeVisible();
    await finish(page, recorder, "facturas-desktop-light");
  });

  test("escritorio oscuro con datos", async ({ browser }) => {
    const { page, recorder } = await open(browser, "/facturas", { colorScheme: "dark" });
    await expect(table(page).getByRole("link", { name: FIRST })).toBeVisible();
    await finish(page, recorder, "facturas-desktop-dark");
  });

  test("vista «Requiere atención»", async ({ browser }) => {
    const { page, recorder } = await open(browser, "/facturas?vista=atencion");
    await expect(table(page).getByRole("link", { name: SECOND })).toBeVisible();
    await expect(table(page).getByRole("link", { name: FIRST })).toHaveCount(0);
    await finish(page, recorder, "facturas-attention");
  });

  test("vacío inicial", async ({ browser }) => {
    const { page, recorder } = await open(browser, "/facturas", {
      scenario: { persona: "admin", invoices: [] },
    });
    await expect(page.getByRole("heading", { name: "Todavía no hay facturas" })).toBeVisible();
    await finish(page, recorder, "facturas-empty");
  });

  test("vacío por filtros", async ({ browser }) => {
    const { page, recorder } = await open(browser, "/facturas?q=zzz&estado=devueltas");
    await expect(
      page.getByRole("heading", { name: "No hay facturas con estos filtros" }),
    ).toBeVisible();
    await finish(page, recorder, "facturas-filtered-empty");
  });

  test("carga", async ({ browser }) => {
    const { page, recorder } = await openPage(browser, CATALOG);
    // La lista queda retenida; el conteo y el resto responden.
    await page.route(
      (url) => url.pathname === "/api/v1/invoices" && url.searchParams.has("page"),
      () => new Promise<void>(() => undefined),
    );
    await page.goto("/facturas");
    await expect(page.locator("[data-slot=data-table][aria-busy=true]")).toBeVisible();
    await expect(page.getByRole("radio", { name: "Requiere atención 3" })).toBeVisible();
    await expect(page.getByText(/Mostrando/)).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await finish(page, recorder, "facturas-loading");
  });

  test("error", async ({ browser }) => {
    const { page, recorder } = await open(browser, "/facturas", {
      scenario: {
        persona: "admin",
        overrides: {
          "GET /api/v1/invoices": {
            status: 500,
            body: { error: { code: "INTERNAL_ERROR", message: "Error.", requestId: "visual" } },
          },
        },
      },
    });
    await expect(table(page).getByRole("alert")).toContainText("No pudimos cargar las facturas.");
    await finish(page, recorder, "facturas-error");
  });

  test("1024 px, empresa en Producción con facturas de Pruebas", async ({ browser }) => {
    const { page, recorder } = await open(browser, "/facturas", {
      scenario: { persona: "operator", environment: "PRODUCTION", invoices: PRODUCTION_INVOICES },
      viewport: { width: 1024, height: 768 },
    });
    await expect(table(page).getByText("sin validez tributaria")).toHaveCount(2);
    await finish(page, recorder, "facturas-1024-production");
  });

  test("390 px", async ({ browser }) => {
    const { page, recorder } = await open(browser, "/facturas", { viewport: MOBILE });
    await expect(table(page).getByRole("link", { name: FIRST })).toBeVisible();
    await finish(page, recorder, "facturas-390");
  });
});
