// B. Apariencia aprobada del shell premium (design D17). Conjunto canónico pequeño: escritorio claro y
// oscuro con la barra expandida y colapsada, tableta, móvil cerrado y con el panel abierto, Producción
// con un operador, paleta y creación rápida abiertas, los estados de ruta y el inicio de sesión. Las
// capturas de Facturas, que sustituyen a la de la lista heredada dentro del shell, están en
// `facturas.spec.ts`. Nunca se compara con las capturas de la interfaz anterior.
import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  BASE_URL,
  DESKTOP,
  INVOICES,
  MOBILE,
  openPage,
  settle,
  type Recorder,
  type Scenario,
} from "../fixtures";

// El indicador de la barra superior es el aviso persistente de Pruebas: ya no hay franja
// (productize-invoice-editor-and-composition-foundation, design D21).
const TABLET = { width: 1024, height: 768 } as const;

type Options = {
  scenario?: Scenario;
  viewport?: { width: number; height: number };
  colorScheme?: "light" | "dark";
  collapsed?: boolean;
  initScript?: string;
};

async function open(
  browser: Browser,
  path: string,
  options: Options = {},
): Promise<{ page: Page; recorder: Recorder }> {
  const { page, recorder } = await openPage(browser, options.scenario ?? { persona: "admin" }, {
    viewport: options.viewport ?? DESKTOP,
    colorScheme: options.colorScheme ?? "light",
  });
  if (options.collapsed) {
    await page.context().addCookies([{ name: "sidebar_state", value: "false", url: BASE_URL }]);
  }
  if (options.initScript) await page.addInitScript(options.initScript);
  await page.goto(path);
  await settle(page);
  return { page, recorder };
}

async function finish(page: Page, recorder: Recorder, name: string) {
  await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
  expect(recorder.external, "peticiones a otros orígenes").toEqual([]);
  expect(recorder.unexpected, "rutas de la API sin datos de prueba").toEqual([]);
  await page.context().close();
}

// Con un panel o un menú modal abierto, Radix oculta el resto de la página a la asistencia: la
// franja se busca por su lugar.
const pruebasVisible = async (page: Page) => {
  const strip = page.locator('header [data-slot="environment-banner"]');
  await expect(strip).toBeVisible();
  await expect(strip).toContainText("Estás en el ambiente de Pruebas");
};

test.describe("shell premium", () => {
  test("escritorio claro, barra expandida", async ({ browser }) => {
    const { page, recorder } = await open(browser, "/");
    await pruebasVisible(page);
    await finish(page, recorder, "shell-desktop-light");
  });

  test("escritorio oscuro, barra expandida", async ({ browser }) => {
    const { page, recorder } = await open(browser, "/", { colorScheme: "dark" });
    await pruebasVisible(page);
    await finish(page, recorder, "shell-desktop-dark");
  });

  test("escritorio claro, barra colapsada", async ({ browser }) => {
    const { page, recorder } = await open(browser, "/facturas", { collapsed: true });
    await expect(page.getByRole("button", { name: "Expandir barra lateral" })).toBeVisible();
    await pruebasVisible(page);
    await finish(page, recorder, "shell-desktop-collapsed");
  });

  test("tableta", async ({ browser }) => {
    const { page, recorder } = await open(browser, "/facturas", { viewport: TABLET });
    await pruebasVisible(page);
    await finish(page, recorder, "shell-tablet");
  });

  test("móvil cerrado", async ({ browser }) => {
    const { page, recorder } = await open(browser, "/", { viewport: MOBILE });
    await pruebasVisible(page);
    await finish(page, recorder, "shell-mobile");
  });

  test("móvil con el panel abierto", async ({ browser }) => {
    const { page, recorder } = await open(browser, "/", { viewport: MOBILE });
    await page.getByRole("button", { name: "Abrir navegación" }).click();
    await expect(page.getByRole("dialog", { name: "Menú" })).toBeVisible();
    await pruebasVisible(page);
    await finish(page, recorder, "shell-mobile-panel");
  });

  test("Producción con un operador", async ({ browser }) => {
    const { page, recorder } = await open(browser, "/", {
      scenario: { persona: "operator", environment: "PRODUCTION" },
    });
    await expect(page.locator('[data-slot="environment-banner"]')).toHaveCount(0);
    await finish(page, recorder, "shell-production-operator");
  });

  test("paleta de comandos abierta", async ({ browser }) => {
    const { page, recorder } = await open(browser, "/facturas");
    await page.keyboard.press("Control+KeyK");
    await expect(page.getByRole("dialog", { name: "Paleta de comandos" })).toBeVisible();
    await pruebasVisible(page);
    await finish(page, recorder, "command-palette");
  });

  test("creación rápida abierta", async ({ browser }) => {
    const { page, recorder } = await open(browser, "/facturas");
    await page.getByRole("button", { name: "Nuevo" }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await pruebasVisible(page);
    await finish(page, recorder, "quick-create");
  });

  test("carga de una pantalla", async ({ browser }) => {
    const { page, recorder } = await open(browser, "/");
    // La navegación hacia Facturas queda retenida para ver su estado de carga; las precargas del
    // límite de carga pasan, para que Next lo muestre al instante.
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(
      (url) => url.pathname === "/facturas",
      async (route) => {
        const headers = route.request().headers();
        if (headers["rsc"] === "1" && !headers["next-router-prefetch"]) await held;
        await route.continue();
      },
    );
    await page
      .getByRole("navigation", { name: "Navegación principal" })
      // Exacto: ningún otro destino debe coincidir por contener «Facturas».
      .getByRole("link", { name: "Facturas", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "Cargando la pantalla" }),
    ).toBeAttached();
    await pruebasVisible(page);
    await expect(page).toHaveScreenshot("route-loading.png", { fullPage: true });
    release();
    expect(recorder.external).toEqual([]);
    await page.context().close();
  });

  test("error inesperado en una pantalla", async ({ browser }) => {
    // Fallo de render simulado solo en la prueba: el formateo de una fecha centinela lanza un error,
    // que atrapa `app/(app)/error.tsx` dentro del shell.
    const { page, recorder } = await open(browser, "/facturas", {
      scenario: {
        persona: "admin",
        overrides: {
          "GET /api/v1/invoices/entries": {
            status: 200,
            body: {
              data: [{ kind: "DOCUMENT", document: { ...INVOICES[0], issueDate: "1999-01-01" } }],
              meta: { page: 1, pageSize: 25, total: 1 },
            },
          },
        },
      },
      initScript: `(() => {
        const split = String.prototype.split;
        String.prototype.split = function (...args) {
          if (String(this) === "1999-01-01") throw new Error("Fallo simulado de render");
          return split.apply(this, args);
        };
      })();`,
    });
    await expect(
      page.getByRole("heading", { name: "No pudimos mostrar esta pantalla" }),
    ).toBeVisible();
    await expect(page.getByText("Fallo simulado de render")).toHaveCount(0);
    await expect(
      page
        .getByRole("navigation", { name: "Navegación principal" })
        .getByRole("link", { name: "Productos" }),
    ).toBeVisible();
    await pruebasVisible(page);
    await finish(page, recorder, "route-error");
  });

  test("dirección inexistente", async ({ browser }) => {
    const { page, recorder } = await open(browser, "/no-existe", {
      scenario: { persona: "anonymous" },
    });
    await expect(page.getByRole("heading", { name: "Esta página no existe" })).toBeVisible();
    await finish(page, recorder, "route-not-found");
  });

  test("destino no permitido", async ({ browser }) => {
    const { page, recorder } = await open(browser, "/configuracion/usuarios", {
      scenario: { persona: "operator" },
    });
    await expect(
      page.getByRole("heading", { name: "No tienes acceso a esta sección" }),
    ).toBeVisible();
    await pruebasVisible(page);
    await finish(page, recorder, "route-forbidden");
  });

  // Estados de las correcciones del control de calidad UX (design D23, D24 y D27; tarea 14.12).
  // Contribuyente sin registrar, como en una instalación nueva: Ambiente explica qué falta.
  const TAXPAYER_NOT_REGISTERED = {
    "GET /api/v1/taxpayer": {
      status: 200,
      body: {
        data: {
          configured: false,
          version: null,
          environment: "TEST",
          taxIdentityLocked: false,
          profile: null,
          logo: null,
          logoMaxBytes: 1048576,
          updatedAt: null,
        },
      },
    },
  };

  test("destino de Configuración, con la sección abierta", async ({ browser }) => {
    const { page, recorder } = await open(browser, "/configuracion/ambiente", {
      scenario: { persona: "admin", overrides: TAXPAYER_NOT_REGISTERED },
    });
    await expect(
      page.getByRole("navigation", { name: "Navegación principal" }).getByRole("link", {
        name: "Ambiente",
      }),
    ).toHaveAttribute("aria-current", "page");
    await pruebasVisible(page);
    await finish(page, recorder, "shell-config-route");
  });

  test("ventana baja, con el destino actual a la vista", async ({ browser }) => {
    const { page, recorder } = await open(browser, "/configuracion/ambiente", {
      viewport: { width: 1280, height: 560 },
      scenario: { persona: "admin", overrides: TAXPAYER_NOT_REGISTERED },
    });
    await expect(
      page.getByRole("navigation", { name: "Navegación principal" }).getByRole("link", {
        name: "Ambiente",
      }),
    ).toBeInViewport();
    await finish(page, recorder, "shell-short-height");
  });

  test("Producción en móvil", async ({ browser }) => {
    const { page, recorder } = await open(browser, "/", {
      viewport: MOBILE,
      scenario: { persona: "operator", environment: "PRODUCTION" },
    });
    await expect(page.locator('[data-slot="environment-banner"]')).toHaveCount(0);
    await finish(page, recorder, "shell-mobile-production");
  });

  test("inicio de sesión", async ({ browser }) => {
    const { page, recorder } = await open(browser, "/iniciar-sesion", {
      scenario: { persona: "anonymous" },
    });
    await expect(page.getByText("EmiteYa")).toBeVisible();
    await finish(page, recorder, "login");
  });
});
