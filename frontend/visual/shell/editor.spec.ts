// Editor de facturas en el navegador (productize-invoice-editor-and-composition-foundation, tarea
// 7.1): el recorrido de teclado real, axe con WCAG 2.2 AA, las anchuras de D18 medidas en el navegador
// (container queries que jsdom no aplica), el ambiente junto a las acciones y en la confirmación, y
// el foco nunca tapado por la barra de acciones fija (D8). Solo el harness: nunca guarda ni emite.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  BASE_URL,
  DESKTOP,
  MOBILE,
  openPage,
  settle,
  type Recorder,
  type Scenario,
} from "../fixtures";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const READY = "/borradores/borrador-listo";

type Options = {
  scenario?: Partial<Scenario>;
  viewport?: { width: number; height: number };
  scale?: number;
  colorScheme?: "light" | "dark";
  collapsed?: boolean;
};

async function open(
  browser: Browser,
  path: string,
  options: Options = {},
): Promise<{ page: Page; recorder: Recorder }> {
  const { page, recorder } = await openPage(
    browser,
    { persona: "admin", ...options.scenario },
    {
      viewport: options.viewport ?? DESKTOP,
      deviceScaleFactor: options.scale ?? 1,
      colorScheme: options.colorScheme ?? "light",
    },
  );
  if (options.collapsed) {
    await page.context().addCookies([{ name: "sidebar_state", value: "false", url: BASE_URL }]);
  }
  await page.goto(path);
  await settle(page);
  return { page, recorder };
}

/** Ninguna petición a otro origen ni ninguna ruta de la API sin datos de prueba. */
async function finish(page: Page, recorder: Recorder) {
  expect(recorder.external, "peticiones a otros orígenes").toEqual([]);
  expect(recorder.unexpected, "rutas de la API sin datos de prueba").toEqual([]);
  await page.context().close();
}

async function violations(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return result.violations.map((violation) => ({
    id: violation.id,
    nodes: violation.nodes.map((node) => node.target.join(" ")),
  }));
}

const focused = (page: Page) =>
  page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    return element?.getAttribute("aria-label") || element?.textContent?.trim() || element?.id;
  });

test.describe("teclado del editor (7.1)", () => {
  test("factura nueva: comprador, punto, productos, formas de pago y guardar, en orden", async ({
    browser,
  }) => {
    const { page, recorder } = await open(browser, "/borradores/nuevo");
    await page.locator("main#contenido").focus();
    const tab = () => page.keyboard.press("Tab");
    await tab();
    await expect(page.getByRole("link", { name: "Facturas" }).last()).toBeFocused();
    await tab();
    await expect(page.getByRole("button", { name: "Elegir comprador" })).toBeFocused();
    await tab();
    await expect(page.getByLabel("Establecimiento", { exact: true })).toBeFocused();
    await tab();
    await expect(page.getByLabel("Punto de emisión", { exact: true })).toBeFocused();
    await tab();
    await expect(page.getByRole("button", { name: "Agregar producto" })).toBeFocused();
    // Agregar con el teclado deja el foco en la cantidad de la línea nueva.
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Agregar producto" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("option").first()).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    const line = page.getByRole("listitem", { name: /^Línea 1:/ });
    await expect(line.getByLabel("Cantidad")).toBeFocused();
    await tab();
    await expect(line.getByLabel("Descuento (USD)")).toBeFocused();
    await tab();
    await expect(page.getByRole("button", { name: /^Quitar / }).first()).toBeFocused();
    await tab();
    await expect(page.getByLabel("Forma de pago", { exact: true })).toBeFocused();
    await tab();
    await expect(page.getByRole("button", { name: "Dividir el pago" })).toBeFocused();
    await tab();
    // «Emitir factura» no está disponible sin comprador: el siguiente es guardar.
    await expect(page.getByRole("button", { name: "Guardar borrador" })).toBeFocused();
    await finish(page, recorder);
  });

  test("borrador listo: emitir abre la confirmación y Escape devuelve el foco", async ({
    browser,
  }) => {
    const { page, recorder } = await open(browser, READY);
    const emit = page.getByRole("button", { name: "Emitir factura" });
    await emit.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Emitir factura" });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText("Pruebas · esta factura no tendrá validez tributaria."),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(emit).toBeFocused();
    await finish(page, recorder);
  });
});

test.describe("accesibilidad del editor (7.1)", () => {
  for (const [name, path, viewport, colorScheme] of [
    ["claro", READY, DESKTOP, "light"],
    ["oscuro", READY, DESKTOP, "dark"],
    ["móvil", READY, MOBILE, "light"],
    ["con problemas", "/borradores/borrador-problemas", DESKTOP, "light"],
    ["nueva", "/borradores/nuevo", DESKTOP, "light"],
  ] as const) {
    test(`${name}: sin violaciones de WCAG 2.2 AA`, async ({ browser }) => {
      const { page, recorder } = await open(browser, path, { viewport, colorScheme });
      // En un teléfono, con la página arriba, la barra de acciones fija tapa en parte las últimas
      // líneas, y axe lo cuenta como objetivo pequeño. Es un estado del desplazamiento, no un control
      // pequeño: se mide con la página al final, donde la barra no tapa nada. Que el foco nunca
      // quede debajo de la barra se comprueba aparte.
      if (viewport === MOBILE) {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      }
      expect(await violations(page)).toEqual([]);
      await finish(page, recorder);
    });
  }

  test("con la confirmación abierta: sin violaciones de WCAG 2.2 AA", async ({ browser }) => {
    const { page, recorder } = await open(browser, READY);
    await page.getByRole("button", { name: "Emitir factura" }).click();
    await expect(page.getByRole("dialog", { name: "Emitir factura" })).toBeVisible();
    expect(await violations(page)).toEqual([]);
    await finish(page, recorder);
  });
});

/** Ancho que necesita el texto elegido de un `select` frente al que tiene para mostrarlo. */
const selectFit = (page: Page, label: string) =>
  page.getByLabel(label, { exact: true }).evaluate((element) => {
    const select = element as HTMLSelectElement;
    const style = getComputedStyle(select);
    const canvas = document.createElement("canvas").getContext("2d")!;
    canvas.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const needed = canvas.measureText(select.selectedOptions[0]?.text ?? "").width;
    // Relleno a los lados y la flecha del control nativo.
    const available =
      select.clientWidth -
      Number.parseFloat(style.paddingLeft) -
      Number.parseFloat(style.paddingRight) -
      16;
    return {
      needed: Math.ceil(needed),
      available: Math.floor(available),
      width: select.clientWidth,
    };
  });

test.describe("lectura a cualquier anchura (D5, D18)", () => {
  for (const [width, height, scale, collapsed, side] of [
    [1440, 900, 1, false, true],
    [1280, 800, 1, false, true],
    [1024, 768, 1, false, false],
    [1024, 768, 1, true, true],
    [768, 900, 1, false, false],
    [390, 844, 1, false, false],
    // La anchura mínima soportada (frontend-checklist.md, tarea 8.3).
    [320, 640, 1, false, false],
    // 1440 px al 200 % de zoom.
    [720, 450, 2, false, false],
  ] as const) {
    test(`${width} px${scale === 2 ? " al 200 %" : ""}${collapsed ? ", barra colapsada" : ""}: panel ${side ? "al lado" : "apilado"}, sin desplazamiento horizontal`, async ({
      browser,
    }) => {
      const { page, recorder } = await open(browser, READY, {
        viewport: { width, height },
        scale,
        collapsed,
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBe(0);
      const form = await page.locator("[data-slot=form-layout-main]").boundingBox();
      const panel = await page.getByRole("complementary", { name: "Resumen" }).boundingBox();
      if (side) {
        expect(panel!.x).toBeGreaterThan(form!.x + form!.width);
        expect(form!.width).toBeGreaterThanOrEqual(576);
      } else {
        expect(panel!.y).toBeGreaterThan(form!.y + form!.height - 1);
      }
      // El importe se lee entero, y la forma de pago también salvo a 390 px, donde el control
      // nativo, a 16 px para no ampliar en iOS, ocupa toda la fila y recorta el nombre oficial.
      const amount = await page.getByLabel("Importe").boundingBox();
      expect(amount!.width).toBeGreaterThanOrEqual(150);
      const fit = await selectFit(page, "Forma de pago");
      const select = await page.getByLabel("Forma de pago", { exact: true }).boundingBox();
      if (width <= 390) expect(select!.width).toBeGreaterThanOrEqual(form!.width - 1);
      else expect(fit.needed).toBeLessThanOrEqual(fit.available);
      await finish(page, recorder);
    });
  }
});

test.describe("barra superior en una línea (D1, tarea 8.3)", () => {
  for (const [width, height] of [
    [320, 640],
    [390, 844],
    [768, 900],
    [1024, 768],
    [1280, 800],
  ] as const) {
    test(`${width} px: cada pieza en una sola línea y sin solaparse`, async ({ browser }) => {
      const { page, recorder } = await open(browser, READY, { viewport: { width, height } });
      const boxes = await page.getByRole("banner").evaluate((header) =>
        [...header.querySelectorAll("[data-slot=topbar-row] > [data-slot^=topbar-] > *")]
          .filter((element) => element.getClientRects().length > 0)
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return { left: rect.left, right: rect.right, height: rect.height };
          }),
      );
      const bar = await page.getByRole("banner").boundingBox();
      for (const box of boxes) expect(box.height).toBeLessThanOrEqual(44);
      for (const [index, box] of boxes.entries()) {
        if (index > 0) expect(box.left).toBeGreaterThanOrEqual(boxes[index - 1]!.right - 0.5);
        expect(box.right).toBeLessThanOrEqual(bar!.x + bar!.width);
      }
      // El nombre de la empresa se lee, aunque recortado, también a 320 px.
      const name = await page
        .locator("[data-slot=company-context] > span:last-child")
        .boundingBox();
      expect(name!.width).toBeGreaterThanOrEqual(28);
      await finish(page, recorder);
    });
  }
});

test.describe("ambiente junto a las acciones y en la confirmación (7.1, D21)", () => {
  const notice = (page: Page) => page.locator("[data-slot=emission-environment-notice]");
  for (const [name, scenario, expected] of [
    ["Pruebas", {}, "Pruebas · esta factura no tendrá validez tributaria."],
    ["Producción", { environment: "PRODUCTION" as const }, null],
    [
      "sin confirmar",
      {
        overrides: {
          "GET /api/v1/company/status": {
            status: 403,
            body: { error: { code: "FORBIDDEN", message: "No.", requestId: "visual" } },
          },
        },
      },
      /^No pudimos confirmar el ambiente/,
    ],
  ] as const) {
    test(name, async ({ browser }) => {
      const { page, recorder } = await open(browser, READY, { scenario });
      const actions = page.locator("[data-slot=sticky-form-actions]");
      if (expected === null) await expect(actions.locator(notice(page))).toHaveCount(0);
      else
        await expect(actions.locator("[data-slot=emission-environment-notice]")).toHaveText(
          expected,
        );
      await page.getByRole("button", { name: "Emitir factura" }).click();
      const dialog = page.getByRole("dialog", { name: "Emitir factura" });
      await expect(dialog).toBeVisible();
      if (expected === null) {
        await expect(dialog.getByText("Producción", { exact: true })).toBeVisible();
        await expect(dialog.locator("[data-slot=emission-environment-notice]")).toHaveCount(0);
      } else {
        await expect(dialog.locator("[data-slot=emission-environment-notice]")).toHaveText(
          expected,
        );
        await expect(dialog.getByText("Producción", { exact: true })).toHaveCount(0);
      }
      await finish(page, recorder);
    });
  }
});

test.describe("el foco nunca queda debajo de la barra de acciones (5.4, D8)", () => {
  for (const [width, height, scale] of [
    [390, 844, 1],
    [1024, 768, 1],
    [720, 450, 2],
  ] as const) {
    test(`${width} px${scale === 2 ? " al 200 %" : ""}`, async ({ browser }) => {
      const { page, recorder } = await open(browser, READY, { viewport: { width, height }, scale });
      await page.locator("main#contenido").focus();
      const bar = page.locator("[data-slot=sticky-form-actions]");
      // Recorre con Tab todo el formulario hasta llegar a las acciones de la barra.
      for (let step = 0; step < 30; step += 1) {
        await page.keyboard.press("Tab");
        const state = await page.evaluate(() => {
          const element = document.activeElement as HTMLElement;
          const barElement = document.querySelector("[data-slot=sticky-form-actions]")!;
          const rect = element.getBoundingClientRect();
          return {
            inBar: barElement.contains(element),
            bottom: rect.bottom,
            barTop: barElement.getBoundingClientRect().top,
          };
        });
        if (state.inBar) break;
        expect(state.bottom, `paso ${step}: ${await focused(page)}`).toBeLessThanOrEqual(
          state.barTop + 1,
        );
      }
      await expect(bar.getByRole("button", { name: "Emitir factura" })).toBeFocused();
      await finish(page, recorder);
    });
  }
});

test.describe("capturas del editor (7.2)", () => {
  for (const [name, path, viewport, colorScheme, act] of [
    ["editor-new", "/borradores/nuevo", DESKTOP, "light", null],
    ["editor-incomplete", "/borradores/borrador-incompleto", DESKTOP, "light", null],
    ["editor-ready", READY, DESKTOP, "light", null],
    ["editor-issues", "/borradores/borrador-problemas", DESKTOP, "light", null],
    ["editor-dirty", READY, DESKTOP, "light", "dirty"],
    ["editor-1024-expanded", READY, { width: 1024, height: 768 }, "light", null],
    ["editor-390", READY, MOBILE, "light", null],
    ["editor-dark", READY, DESKTOP, "dark", null],
  ] as const) {
    test(name, async ({ browser }) => {
      const { page, recorder } = await open(browser, path, { viewport, colorScheme });
      if (act === "dirty") {
        const quantity = page.getByRole("listitem", { name: /^Línea 1:/ }).getByLabel("Cantidad");
        await quantity.fill("5");
        await expect(page.locator("[data-slot=draft-state]")).toHaveText("Sin guardar");
        await quantity.blur();
      }
      await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
      await finish(page, recorder);
    });
  }
});
