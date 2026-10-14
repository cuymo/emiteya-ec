// Cada pantalla heredada abre dentro del shell nuevo (adopt-premium-design-foundation-and-shell,
// tarea 13.3): las 41 rutas autenticadas, a 320, 768, 1024 y 1440 px, sin errores no capturados y sin
// desbordamiento horizontal de la página. Las rutas de la API que una pantalla pida sin datos de prueba
// responden 404 y la pantalla muestra su propio estado; lo que se comprueba es el shell.
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { expect, test } from "@playwright/test";
import { openPage } from "../fixtures";

const APP = join(import.meta.dirname, "..", "..", "src", "app", "(app)");

function pageUrls(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return pageUrls(path);
    if (name !== "page.tsx") return [];
    const segments = relative(APP, directory)
      .split(sep)
      .filter((segment) => segment && !segment.startsWith("("))
      .map((segment) => (segment.startsWith("[") ? "x1" : segment));
    return [`/${segments.join("/")}`];
  });
}

const URLS = pageUrls(APP).sort();
/** Los anchos de frontend-checklist.md; el zoom al 200 % equivale a un viewport CSS de la mitad. */
const WIDTHS = [320, 768, 1024, 1440];

test("las 41 pantallas autenticadas abren dentro del shell a 320, 768, 1024 y 1440 px", async ({
  browser,
}) => {
  test.setTimeout(600_000);
  expect(URLS).toHaveLength(41);
  const problems: string[] = [];
  for (const width of WIDTHS) {
    const { page } = await openPage(
      browser,
      { persona: "admin" },
      { viewport: { width, height: 800 } },
    );
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const url of URLS) {
      errors.length = 0;
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      const shell =
        width < 768
          ? page.getByRole("button", { name: "Abrir navegación" })
          : page.getByRole("navigation", { name: "Navegación principal" });
      if (!(await shell.isVisible())) problems.push(`${width}px ${url}: sin shell`);
      if (errors.length > 0) problems.push(`${width}px ${url}: ${errors.join(" | ")}`);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      if (overflow > 0) problems.push(`${width}px ${url}: desborda ${overflow}px`);
    }
    await page.context().close();
  }
  expect(problems).toEqual([]);
});
