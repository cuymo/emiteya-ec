// Accesibilidad del shell premium (design D18): axe con WCAG 2.2 AA sobre los flujos representativos
// del shell, en escritorio claro y oscuro, móvil y con la paleta abierta. Es un complemento de las
// pruebas de interacción y de teclado, no su sustituto.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { DESKTOP, MOBILE, openPage, settle } from "../fixtures";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function violations(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return result.violations.map((violation) => ({
    id: violation.id,
    nodes: violation.nodes.map((node) => node.target.join(" ")),
  }));
}

test.describe("accesibilidad del shell", () => {
  for (const [name, viewport, colorScheme] of [
    ["escritorio claro", DESKTOP, "light"],
    ["escritorio oscuro", DESKTOP, "dark"],
    ["móvil", MOBILE, "light"],
  ] as const) {
    test(`${name}: sin violaciones de WCAG 2.2 AA`, async ({ browser }) => {
      const { page } = await openPage(browser, { persona: "admin" }, { viewport, colorScheme });
      await page.goto("/facturas");
      await settle(page);
      expect(await violations(page)).toEqual([]);
      await page.context().close();
    });
  }

  test("con la paleta de comandos abierta", async ({ browser }) => {
    const { page } = await openPage(browser, { persona: "admin" });
    await page.goto("/facturas");
    await settle(page);
    await page.keyboard.press("Control+KeyK");
    await expect(page.getByRole("dialog", { name: "Paleta de comandos" })).toBeVisible();
    expect(await violations(page)).toEqual([]);
    await page.context().close();
  });

  test("con el panel de navegación móvil abierto", async ({ browser }) => {
    const { page } = await openPage(browser, { persona: "admin" }, { viewport: MOBILE });
    await page.goto("/");
    await settle(page);
    await page.getByRole("button", { name: "Abrir navegación" }).click();
    await expect(page.getByRole("dialog", { name: "Menú" })).toBeVisible();
    expect(await violations(page)).toEqual([]);
    await page.context().close();
  });
});
