// Recorrido de teclado real del shell (design D18): el enlace para saltar al contenido mueve el foco,
// el foco es visible, Ctrl+B alterna la barra, hay un solo control de tema por anchura y la barra se
// desplaza dentro de sí misma con la ventana baja (antes se comprobaba por clases en jsdom).
import { expect, test } from "@playwright/test";
import { DESKTOP, MOBILE, openPage, settle } from "../fixtures";

test.describe("teclado del shell", () => {
  test("el primer Tab muestra «Saltar al contenido» y Enter lleva el foco al contenido", async ({
    browser,
  }) => {
    const { page } = await openPage(browser, { persona: "admin" });
    await page.goto("/facturas");
    await settle(page);
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Saltar al contenido" });
    await expect(skip).toBeFocused();
    expect((await skip.boundingBox())?.width ?? 0).toBeGreaterThan(20);
    await page.keyboard.press("Enter");
    await expect(page.locator("main#contenido")).toBeFocused();
    await page.context().close();
  });

  test("el foco es visible en la navegación", async ({ browser }) => {
    const { page } = await openPage(browser, { persona: "admin" });
    await page.goto("/facturas");
    await settle(page);
    const link = page
      .getByRole("navigation", { name: "Navegación principal" })
      .getByRole("link", { name: "Productos" });
    await link.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(link).toBeFocused();
    const ring = await link.evaluate((element) => {
      const style = getComputedStyle(element);
      return style.boxShadow !== "none" || style.outlineStyle !== "none";
    });
    expect(ring).toBe(true);
    await page.context().close();
  });

  test("Ctrl+B colapsa y expande la barra lateral", async ({ browser }) => {
    const { page } = await openPage(browser, { persona: "admin" });
    await page.goto("/facturas");
    await settle(page);
    await page.keyboard.press("Control+KeyB");
    await expect(page.getByRole("button", { name: "Expandir barra lateral" })).toBeVisible();
    await page.keyboard.press("Control+KeyB");
    await expect(page.getByRole("button", { name: "Contraer barra lateral" })).toBeVisible();
    await page.context().close();
  });

  test("a cada anchura hay un solo control de tema", async ({ browser }) => {
    for (const viewport of [DESKTOP, { width: 375, height: 812 }]) {
      const { page } = await openPage(browser, { persona: "admin" }, { viewport });
      await page.goto("/facturas");
      await settle(page);
      // Primero la barra superior: al abrir el menú, Radix oculta el resto de la página.
      const topbar = page.getByRole("radiogroup", { name: "Tema" });
      if (viewport.width >= 640) await expect(topbar).toBeVisible();
      else await expect(topbar).toBeHidden();
      await page.getByRole("button", { name: "Cuenta de Ana Admin" }).click();
      await expect(page.getByRole("menu")).toBeVisible();
      await expect(page.getByRole("menuitemradio")).toHaveCount(viewport.width >= 640 ? 0 : 3);
      await page.context().close();
    }
  });

  test("con la ventana baja, la navegación se desplaza dentro de la barra", async ({ browser }) => {
    const { page } = await openPage(
      browser,
      { persona: "admin" },
      { viewport: { width: 1280, height: 480 } },
    );
    await page.goto("/facturas");
    await settle(page);
    const nav = page.getByRole("navigation", { name: "Navegación principal" });
    // Configuración empieza plegada fuera de sus pantallas (design D24): su cabecera es lo último.
    const section = nav.getByRole("button", { name: "Configuración" });
    await expect(section).not.toBeInViewport();
    await section.scrollIntoViewIfNeeded();
    await expect(section).toBeInViewport();
    await section.click();
    const last = nav.getByRole("link", { name: "Portabilidad de datos" });
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
    // Se desplazó la barra, no la página.
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await page.context().close();
  });

  test("en móvil el panel se cierra con Escape y el foco vuelve al botón de menú", async ({
    browser,
  }) => {
    const { page } = await openPage(browser, { persona: "admin" }, { viewport: MOBILE });
    await page.goto("/");
    await settle(page);
    const menu = page.getByRole("button", { name: "Abrir navegación" });
    await menu.click();
    await expect(page.getByRole("dialog", { name: "Menú" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(menu).toBeFocused();
    await page.context().close();
  });
});
