// A. Prueba de espaciado (design D3 y D17). Línea base de la interfaz anterior al rediseño: después de
// pasar la escala de 8 px a 4 px, estas pantallas deben coincidir píxel a píxel y caja a caja. Es
// evidencia congelada de esa transición; `test:visual` no la ejecuta.
import { expect, test } from "@playwright/test";
import { DESKTOP, MOBILE, dumpGeometry, openPage, settle, type Scenario } from "../fixtures";

type Case = {
  name: string;
  path: string;
  scenario: Scenario;
  viewport: { width: number; height: number };
  colorScheme: "light" | "dark";
};

const CASES: Case[] = [
  {
    name: "shell-desktop-light",
    path: "/",
    scenario: { persona: "admin" },
    viewport: DESKTOP,
    colorScheme: "light",
  },
  {
    name: "shell-desktop-dark",
    path: "/",
    scenario: { persona: "admin" },
    viewport: DESKTOP,
    colorScheme: "dark",
  },
  {
    name: "shell-mobile-light",
    path: "/",
    scenario: { persona: "admin" },
    viewport: MOBILE,
    colorScheme: "light",
  },
  {
    name: "invoices-list",
    path: "/facturas",
    scenario: { persona: "admin" },
    viewport: DESKTOP,
    colorScheme: "light",
  },
  {
    name: "login",
    path: "/iniciar-sesion",
    scenario: { persona: "anonymous" },
    viewport: DESKTOP,
    colorScheme: "light",
  },
];

for (const item of CASES) {
  test(item.name, async ({ browser }) => {
    const { page, recorder } = await openPage(browser, item.scenario, {
      viewport: item.viewport,
      colorScheme: item.colorScheme,
    });
    await page.goto(item.path);
    await settle(page);
    await expect(page).toHaveScreenshot(`${item.name}.png`, { fullPage: true });
    expect(await dumpGeometry(page)).toMatchSnapshot(`${item.name}.geometry.txt`);
    expect(recorder.external, "peticiones a otros orígenes").toEqual([]);
    expect(recorder.unexpected, "rutas de la API sin datos de prueba").toEqual([]);
    await page.context().close();
  });
}
