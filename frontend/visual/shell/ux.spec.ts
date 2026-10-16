// Regresión de los hallazgos del control de calidad UX (adopt-premium-design-foundation-and-shell,
// design D21 a D27; tarea 14.11). Cada prueba reproduce en un navegador real lo que la revisión
// encontró a mano: clic en el centro de cada icono colapsado, alcance con el puntero a poca altura,
// destino actual a la vista, Configuración plegada, ambiente visible en un teléfono, alcance de la
// paleta y los nombres de ventas y documentos.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { BASE_URL, INVOICES, MOBILE, openPage, settle, type Scenario } from "../fixtures";

type Viewport = { width: number; height: number };

const nav = (page: Page) => page.getByRole("navigation", { name: "Navegación principal" });
const content = (page: Page) =>
  page.locator('[data-slot="sidebar-container"] [data-sidebar="content"]');
// Configuración es un solo destino de la barra; sus secciones son pestañas de su página.
const section = (page: Page) => nav(page).getByRole("link", { name: "Configuración" });

async function open(
  browser: Browser,
  path: string,
  viewport: Viewport,
  options: { scenario?: Scenario; collapsed?: boolean } = {},
): Promise<Page> {
  const { page } = await openPage(browser, options.scenario ?? { persona: "admin" }, { viewport });
  if (options.collapsed) {
    await page.context().addCookies([{ name: "sidebar_state", value: "false", url: BASE_URL }]);
  }
  await page.goto(path);
  await settle(page);
  return page;
}

/** Caja visible de la barra, donde la rueda desplaza la navegación. */
async function area(page: Page) {
  const box = await content(page).boundingBox();
  expect(box, "área de la barra").not.toBeNull();
  return box!;
}

/** Lleva `target` a la vista con la rueda del ratón sobre la barra, nunca con el teclado. */
async function wheelIntoView(page: Page, target: Locator) {
  const bar = await area(page);
  for (let attempt = 0; attempt < 60; attempt++) {
    const box = await target.boundingBox();
    if (box && box.y >= bar.y && box.y + box.height <= bar.y + bar.height) return box;
    const below = !box || box.y + box.height > bar.y + bar.height;
    await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2);
    await page.mouse.wheel(0, below ? 120 : -120);
    await page.waitForTimeout(40);
  }
  throw new Error("la rueda no trajo el destino a la vista");
}

/** El elemento que recibe el puntero en el centro de `target` es `target` o uno de sus hijos. */
async function centerHits(target: Locator): Promise<boolean> {
  return target.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return hit !== null && (hit === element || element.contains(hit));
  });
}

async function destinationHrefs(page: Page): Promise<string[]> {
  return nav(page)
    .locator('a[data-sidebar="menu-button"]')
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")!));
}

test.describe("SH-1: cada icono de la barra colapsada responde al clic en su centro", () => {
  for (const [persona, viewport, expected] of [
    ["admin", { width: 1440, height: 900 }, 14],
    ["admin", { width: 1024, height: 768 }, 14],
    ["operator", { width: 1440, height: 900 }, 14],
  ] as const) {
    test(`${persona} a ${viewport.width}x${viewport.height}`, async ({ browser }) => {
      test.setTimeout(240_000);
      const page = await open(browser, "/", viewport, { scenario: { persona }, collapsed: true });
      await expect(page.getByRole("button", { name: "Expandir barra lateral" })).toBeVisible();
      const hrefs = await destinationHrefs(page);
      // Inicio, 4 de Ventas, 2 de Compras, 2 de Logística, 1 de Documentos, 2 de Maestros, 1 de
      // Análisis y Configuración, un solo destino hacia su primera pestaña.
      expect(hrefs).toHaveLength(expected);
      const dead: string[] = [];
      for (const href of hrefs) {
        const link = nav(page).locator(`a[href="${href}"]`);
        const box = await wheelIntoView(page, link);
        if (!(await centerHits(link))) dead.push(href);
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForURL((url) => url.pathname === href);
        await expect(link).toHaveAttribute("aria-current", "page");
      }
      expect(dead, "iconos con el centro muerto").toEqual([]);
      await page.context().close();
    });
  }
});

test.describe("SH-2: a poca altura, cada destino se alcanza con el puntero", () => {
  for (const viewport of [
    { width: 1024, height: 768 },
    // La altura útil de un portátil de 1366x768 con la interfaz del navegador.
    { width: 1366, height: 657 },
    { width: 1280, height: 560 },
  ]) {
    for (const collapsed of [false, true]) {
      test(`${viewport.width}x${viewport.height}, barra ${collapsed ? "colapsada" : "expandida"}`, async ({
        browser,
      }) => {
        const page = await open(browser, "/facturas", viewport, { collapsed });
        const hrefs = await destinationHrefs(page);
        expect(hrefs).toHaveLength(14);
        const unreachable: string[] = [];
        for (const href of hrefs) {
          const link = nav(page).locator(`a[href="${href}"]`);
          await wheelIntoView(page, link);
          if (!(await centerHits(link))) unreachable.push(href);
        }
        expect(unreachable, "destinos fuera del alcance del puntero").toEqual([]);
        // Sin desplazamiento horizontal en la barra, y la página no se movió.
        const overflowX = await content(page).evaluate((el) => el.scrollWidth - el.clientWidth);
        expect(overflowX).toBe(0);
        expect(await page.evaluate(() => window.scrollY)).toBe(0);
        // El último destino responde al clic tras llegar con la rueda.
        const last = nav(page).locator('a[href="/configuracion/portabilidad"]');
        const box = await wheelIntoView(page, last);
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForURL((url) => url.pathname === "/configuracion/portabilidad");
        await page.context().close();
      });
    }
  }
});

test.describe("SH-3: el destino actual queda a la vista", () => {
  for (const [viewport, collapsed] of [
    [{ width: 1440, height: 720 }, false],
    [{ width: 1280, height: 560 }, false],
    [{ width: 1024, height: 600 }, true],
  ] as const) {
    test(`enlace directo a Portabilidad a ${viewport.width}x${viewport.height}${collapsed ? ", colapsada" : ""}`, async ({
      browser,
    }) => {
      const page = await open(browser, "/configuracion/portabilidad", viewport, { collapsed });
      const active = nav(page).locator('a[aria-current="page"]');
      await expect(active).toHaveAttribute("href", "/configuracion/portabilidad");
      const bar = await area(page);
      await expect
        .poll(async () => {
          const box = await active.boundingBox();
          return box !== null && box.y >= bar.y && box.y + box.height <= bar.y + bar.height;
        })
        .toBe(true);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      await page.context().close();
    });
  }

  test("al cambiar de ruta muestra el nuevo destino, y no mueve la barra si ya se ve", async ({
    browser,
  }) => {
    const page = await open(browser, "/facturas", { width: 1280, height: 560 });
    const scrollTop = () => content(page).evaluate((el) => el.scrollTop);
    expect(await scrollTop()).toBe(0);
    // Productos se ve entero: navegar a él no desplaza la barra.
    const productos = nav(page).locator('a[href="/productos"]');
    const box = await wheelIntoView(page, productos);
    const before = await scrollTop();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForURL((url) => url.pathname === "/productos");
    await settle(page);
    expect(await scrollTop()).toBe(before);
    // Desde la paleta a Usuarios: Configuración se abre y el destino queda a la vista.
    await page.keyboard.press("Control+KeyK");
    const dialog = page.getByRole("dialog", { name: "Paleta de comandos" });
    await dialog.getByRole("combobox").fill("usuarios");
    await dialog.getByRole("option", { name: /^Usuarios/ }).click();
    await page.waitForURL((url) => url.pathname === "/configuracion/usuarios");
    await expect(section(page)).toHaveAttribute("aria-current", "page");
    const active = nav(page).locator('a[aria-current="page"]');
    const bar = await area(page);
    await expect
      .poll(async () => {
        const target = await active.boundingBox();
        return (
          target !== null && target.y >= bar.y && target.y + target.height <= bar.y + bar.height
        );
      })
      .toBe(true);
    await page.context().close();
  });
});

test.describe("Configuración como un solo destino con pestañas", () => {
  test("su enlace lleva a la primera pestaña y es el actual en cualquiera de ellas", async ({
    browser,
  }) => {
    const page = await open(browser, "/facturas", { width: 1440, height: 900 });
    await expect(section(page)).toHaveAttribute("href", "/configuracion/empresa");
    await expect(section(page)).not.toHaveAttribute("aria-current", "page");
    await expect(nav(page).getByRole("link", { name: "Usuarios" })).toHaveCount(0);
    await section(page).click();
    await page.waitForURL((url) => url.pathname === "/configuracion/empresa");
    const tabs = page.getByRole("navigation", { name: "Secciones de configuración" });
    await tabs.getByRole("link", { name: "Usuarios" }).click();
    await page.waitForURL((url) => url.pathname === "/configuracion/usuarios");
    await expect(tabs.getByRole("link", { name: "Usuarios" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(section(page)).toHaveAttribute("aria-current", "page");
    await page.context().close();
  });

  test("colapsada la barra, Configuración es un icono con su nombre", async ({ browser }) => {
    const page = await open(
      browser,
      "/facturas",
      { width: 1440, height: 900 },
      { collapsed: true },
    );
    await section(page).hover();
    await expect(page.getByRole("tooltip", { name: "Configuración" })).toBeVisible();
    await page.context().close();
  });
});

test.describe("ambiente siempre visible en un teléfono (D27)", () => {
  const many = Array.from({ length: 25 }, (_, index) => ({
    ...INVOICES[index % INVOICES.length]!,
    id: `inv-${index}`,
    documentNumber: `001-001-${String(200 + index).padStart(9, "0")}`,
  }));
  for (const [environment, label] of [
    ["TEST", "Pruebas"],
    ["PRODUCTION", "Producción"],
  ] as const) {
    test(`${label} sigue a la vista al desplazar`, async ({ browser }) => {
      const page = await open(browser, "/facturas", MOBILE, {
        scenario: {
          persona: "operator",
          environment,
          overrides: {
            "GET /api/v1/invoices": {
              status: 200,
              body: { data: many, meta: { page: 1, pageSize: 25, total: many.length } },
            },
          },
        },
      });
      const header = page.locator("header");
      await expect(header.getByText(label, { exact: true })).toBeVisible();
      await page.mouse.wheel(0, 4000);
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
      await expect(header.getByText(label, { exact: true })).toBeInViewport();
      await page.context().close();
    });
  }

  test("el botón de navegación móvil usa el icono de menú y tiene nombre", async ({ browser }) => {
    const page = await open(browser, "/", MOBILE);
    const menu = page.getByRole("button", { name: "Abrir navegación" });
    await expect(menu).toBeVisible();
    await expect(menu.locator("svg.lucide-menu")).toHaveCount(1);
    await page.context().close();
  });
});

test.describe("paleta veraz sobre su alcance (D26)", () => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, MOBILE]) {
    test(`el control declara su alcance a ${viewport.width} px`, async ({ browser }) => {
      const page = await open(browser, "/facturas", viewport);
      const trigger = page.getByRole("button", { name: "Buscar pantalla o acción" }).filter({
        visible: true,
      });
      await expect(trigger).toHaveCount(1);
      await expect(page.getByRole("button", { name: "Buscar", exact: true })).toHaveCount(0);
      await trigger.click();
      const dialog = page.getByRole("dialog", { name: "Paleta de comandos" });
      const input = dialog.getByRole("combobox", { name: "Buscar pantalla o acción" });
      await expect(input).toHaveAttribute("placeholder", "Buscar pantalla o acción…");
      await page.context().close();
    });
  }

  test("reconoce sinónimos y no inventa registros", async ({ browser }) => {
    const { page, recorder } = await openPage(browser, { persona: "admin" });
    await page.goto("/facturas");
    await settle(page);
    await page.keyboard.press("Control+KeyK");
    const dialog = page.getByRole("dialog", { name: "Paleta de comandos" });
    const input = dialog.getByRole("combobox");
    for (const [query, label] of [
      ["clientes", "Terceros"],
      ["transportista", "Terceros"],
      ["IVA", "Catálogos fiscales"],
      ["PKCS12", "Firma electrónica"],
      ["contraseña", "Mi cuenta"],
      ["numeración", "Secuenciales"],
      ["documentos", "Archivo de comprobantes"],
      ["factura pendiente", "Borradores de facturas"],
    ] as const) {
      await input.fill(query);
      await expect(dialog.getByRole("option", { name: new RegExp(`^${label}`) })).toBeVisible();
    }
    for (const query of ["001-001-000000123", "EL PERNO CIA. LTDA."]) {
      await input.fill(query);
      await expect(dialog.getByRole("option")).toHaveCount(0);
      await expect(
        dialog.getByText("No encontramos una pantalla o acción con ese término."),
      ).toBeVisible();
    }
    // Ninguna consulta a la API por lo escrito.
    expect(recorder.unexpected.filter((call) => !call.startsWith("GET "))).toEqual([]);
    await page.context().close();
  });
});

test.describe("ventas, borradores y archivo (D25)", () => {
  test("Borradores de facturas va en Ventas y Archivo de comprobantes en Documentos", async ({
    browser,
  }) => {
    const page = await open(browser, "/facturas", { width: 1440, height: 900 });
    const labels = await nav(page)
      .locator('a[data-sidebar="menu-button"]')
      .evaluateAll((links) => links.map((link) => link.textContent!.trim()));
    expect(labels.slice(1, 5)).toEqual([
      "Facturas",
      "Borradores de facturas",
      "Notas de crédito",
      "Notas de débito",
    ]);
    await expect(nav(page).getByRole("link", { name: "Borradores de facturas" })).toHaveAttribute(
      "href",
      "/borradores",
    );
    await expect(nav(page).getByRole("link", { name: "Archivo de comprobantes" })).toHaveAttribute(
      "href",
      "/comprobantes",
    );
    await expect(nav(page).getByRole("link", { name: "Borradores", exact: true })).toHaveCount(0);
    await expect(nav(page).getByRole("link", { name: "Comprobantes", exact: true })).toHaveCount(0);
    await page.context().close();
  });

  // productize-invoice-editor-and-composition-foundation, D12 y PO-1: el editor de facturas
  // pertenece a Facturas (sustituye a la D25, que lo colgaba de Borradores de facturas).
  test("Nueva factura desde la creación rápida marca Ventas › Facturas, con sus migas en la barra superior", async ({
    browser,
  }) => {
    const page = await open(browser, "/facturas", { width: 1440, height: 900 });
    await page.getByRole("button", { name: "Nuevo" }).click();
    await page.getByRole("menuitem", { name: "Nueva factura" }).click();
    await page.waitForURL((url) => url.pathname === "/borradores/nuevo");
    await expect(nav(page).locator('a[aria-current="page"]')).toHaveText("Facturas");
    const crumbs = page.getByRole("navigation", { name: "Ruta de navegación" });
    await expect(crumbs).toHaveCount(1);
    await expect(crumbs).toHaveText(/^\/\s*Ventas\s*\/\s*Facturas\s*\/\s*Nueva factura$/);
    // Las migas son de la barra superior, el `banner`, y el contenido no las repite.
    await expect(page.getByRole("banner").getByRole("navigation")).toHaveCount(1);
    await expect(page.getByRole("main").getByRole("navigation")).toHaveCount(0);
    await page.context().close();
  });
});

test.describe("accesibilidad de los estados corregidos", () => {
  for (const [name, path, collapsed, colorScheme] of [
    ["barra colapsada con Configuración", "/configuracion/usuarios", true, "light"],
    ["Configuración abierta, tema oscuro", "/configuracion/usuarios", false, "dark"],
  ] as const) {
    test(`${name}: sin violaciones de WCAG 2.2 AA`, async ({ browser }) => {
      const { page } = await openPage(browser, { persona: "admin" }, { colorScheme });
      if (collapsed) {
        await page.context().addCookies([{ name: "sidebar_state", value: "false", url: BASE_URL }]);
      }
      await page.goto(path);
      await settle(page);
      const result = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(result.violations.map((violation) => violation.id)).toEqual([]);
      await page.context().close();
    });
  }

  test("Producción en móvil: sin violaciones de WCAG 2.2 AA", async ({ browser }) => {
    const { page } = await openPage(
      browser,
      { persona: "operator", environment: "PRODUCTION" },
      { viewport: MOBILE },
    );
    await page.goto("/");
    await settle(page);
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(result.violations.map((violation) => violation.id)).toEqual([]);
    await page.context().close();
  });
});
