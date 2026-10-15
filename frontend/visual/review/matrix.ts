// Matriz de la revisión visual (productize-invoice-editor-and-composition-foundation, design D18).
// Cada estado dice su ruta, sus datos, cómo se alcanza y cuándo está listo. La condición de listo es
// una espera real: si no se cumple, la revisión falla en lugar de capturar una pantalla a medias.
import { expect, type Page } from "@playwright/test";
import { PRODUCTION_INVOICES, type Scenario } from "../fixtures";

export type WidthKey = "1440" | "1280" | "1024" | "1024c" | "768" | "390" | "320" | "1440z200";

export type Width = {
  key: WidthKey;
  viewport: { width: number; height: number };
  /** Escala del dispositivo: 720×450 a escala 2 equivale a 1440×900 al 200 % de zoom. */
  scale: number;
  /** Barra lateral colapsada por la cookie que guarda su estado. */
  collapsed: boolean;
};

export const WIDTHS: Record<WidthKey, Width> = {
  "1440": { key: "1440", viewport: { width: 1440, height: 900 }, scale: 1, collapsed: false },
  "1280": { key: "1280", viewport: { width: 1280, height: 800 }, scale: 1, collapsed: false },
  "1024": { key: "1024", viewport: { width: 1024, height: 768 }, scale: 1, collapsed: false },
  "1024c": { key: "1024c", viewport: { width: 1024, height: 768 }, scale: 1, collapsed: true },
  "768": { key: "768", viewport: { width: 768, height: 900 }, scale: 1, collapsed: false },
  "390": { key: "390", viewport: { width: 390, height: 844 }, scale: 1, collapsed: false },
  // La anchura mínima soportada (frontend-checklist.md, tarea 8.3).
  "320": { key: "320", viewport: { width: 320, height: 640 }, scale: 1, collapsed: false },
  "1440z200": {
    key: "1440z200",
    viewport: { width: 720, height: 450 },
    scale: 2,
    collapsed: false,
  },
};

/** Orden de las anchuras en las hojas: las claves numéricas de un objeto se recorren ordenadas. */
export const WIDTH_ORDER: WidthKey[] = [
  "1440",
  "1280",
  "1024",
  "1024c",
  "768",
  "390",
  "320",
  "1440z200",
];
// Las anchuras de D18; 320 px se suma solo en las pantallas principales.
const ALL: WidthKey[] = ["1440", "1280", "1024", "1024c", "768", "390", "1440z200"];
const MAIN: WidthKey[] = [...ALL, "320"];
const KEY: WidthKey[] = ["1440", "1024", "390"];
const PAIR: WidthKey[] = ["1440", "390"];

export type Group = "shell" | "editor" | "listas" | "configuracion";

export type State = {
  /** Pantalla, para el nombre del archivo. */
  route: string;
  /** Estado de la pantalla, para el nombre del archivo. */
  state: string;
  path: string;
  group: Group;
  scenario?: Omit<Scenario, "persona"> & { persona?: Scenario["persona"] };
  widths: WidthKey[];
  /** Anchuras que también se capturan en tema oscuro. */
  dark?: WidthKey[];
  /** Acción que lleva la pantalla al estado, después de la condición de listo. */
  act?: (page: Page, width: Width) => Promise<void>;
  /** Condición de listo: espera a que la pantalla muestre lo que el estado promete. */
  ready: (page: Page) => Promise<void>;
  /** Captura solo la ventana (paneles y diálogos abiertos), en lugar de la página entera. */
  viewportOnly?: boolean;
};

const UNKNOWN_ENVIRONMENT = {
  "GET /api/v1/company/status": {
    status: 403,
    body: { error: { code: "FORBIDDEN", message: "No.", requestId: "visual" } },
  },
};

const heading = (page: Page, name: string) =>
  expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

/** Un texto visible: en las distribuciones compactas, la misma fila existe oculta en otra vista. */
const shows = (page: Page, text: string | RegExp) =>
  expect(page.getByText(text).filter({ visible: true }).first()).toBeVisible();

const FIRST_INVOICE = "001-001-000000123";

export const STATES: State[] = [
  // Facturas: la lista de referencia de la base compartida.
  {
    route: "facturas",
    state: "poblada",
    path: "/facturas",
    group: "listas",
    widths: MAIN,
    dark: PAIR,
    ready: async (page) => {
      await heading(page, "Facturas");
      await expect(
        page.getByRole("link", { name: FIRST_INVOICE }).filter({ visible: true }).first(),
      ).toBeVisible();
    },
  },
  {
    route: "facturas",
    state: "vacia",
    path: "/facturas",
    group: "listas",
    scenario: { invoices: [] },
    widths: PAIR,
    ready: async (page) => {
      await heading(page, "Facturas");
      await shows(page, "Todavía no hay facturas");
    },
  },
  {
    route: "facturas",
    state: "atencion",
    path: "/facturas?vista=atencion",
    group: "listas",
    widths: PAIR,
    ready: async (page) => {
      await heading(page, "Facturas");
      await expect(page.getByRole("radio", { name: /Requiere atención/ })).toBeChecked();
    },
  },
  {
    // Sin acceso: el encabezado no lleva acción. El título cae en la misma y que con «Nueva
    // factura» (productize-invoice-editor-and-composition-foundation, D3).
    route: "facturas",
    state: "sin-acceso",
    path: "/facturas",
    group: "listas",
    scenario: {
      overrides: {
        "GET /api/v1/invoices": {
          status: 403,
          body: { error: { code: "FORBIDDEN", message: "No.", requestId: "visual" } },
        },
      },
    },
    widths: PAIR,
    ready: async (page) => {
      await heading(page, "Facturas");
      await shows(page, "No tienes acceso a Facturas");
    },
  },
  {
    route: "facturas",
    state: "menu-fila",
    path: "/facturas",
    group: "listas",
    widths: PAIR,
    viewportOnly: true,
    ready: (page) => heading(page, "Facturas"),
    act: async (page) => {
      await page
        .getByRole("button", { name: `Acciones de la factura ${FIRST_INVOICE}` })
        .filter({ visible: true })
        .click();
      await expect(page.getByRole("menu")).toBeVisible();
    },
  },
  // Barra superior en cada ambiente, sobre Facturas.
  {
    route: "facturas",
    state: "produccion",
    path: "/facturas",
    group: "shell",
    scenario: { environment: "PRODUCTION", invoices: PRODUCTION_INVOICES },
    widths: KEY,
    ready: (page) => heading(page, "Facturas"),
  },
  {
    route: "facturas",
    state: "ambiente-desconocido",
    path: "/facturas",
    group: "shell",
    scenario: {
      persona: "operator",
      invoices: PRODUCTION_INVOICES,
      overrides: UNKNOWN_ENVIRONMENT,
    },
    widths: KEY,
    ready: (page) => heading(page, "Facturas"),
  },
  {
    // D18: la barra en Pruebas con la explicación del indicador abierta (grupo 3, D21).
    route: "facturas",
    state: "indicador-pruebas",
    path: "/facturas",
    group: "shell",
    widths: KEY,
    viewportOnly: true,
    ready: (page) => heading(page, "Facturas"),
    act: async (page) => {
      await page
        .getByRole("button", { name: /^Ambiente de Pruebas: los comprobantes no tienen validez/ })
        .click();
      await expect(page.getByRole("dialog", { name: "Ambiente de Pruebas" })).toBeVisible();
    },
  },
  {
    route: "facturas",
    state: "panel-movil",
    path: "/facturas",
    group: "shell",
    widths: ["390"],
    viewportOnly: true,
    ready: (page) => heading(page, "Facturas"),
    act: async (page) => {
      await page.getByRole("button", { name: "Abrir navegación" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
    },
  },
  // Nueva factura.
  {
    route: "nueva-factura",
    state: "vacia",
    path: "/borradores/nuevo",
    group: "editor",
    widths: MAIN,
    ready: async (page) => {
      await heading(page, "Nueva factura");
      await expect(page.getByRole("button", { name: "Guardar borrador" })).toBeVisible();
    },
  },
  {
    route: "nueva-factura",
    state: "con-datos-sin-guardar",
    path: "/borradores/nuevo",
    group: "editor",
    widths: KEY,
    ready: (page) => heading(page, "Nueva factura"),
    act: async (page) => {
      await page.getByRole("button", { name: "Elegir comprador" }).click();
      await page.getByRole("option", { name: /EL PERNO/ }).click();
      await shows(page, "EL PERNO CIA. LTDA.");
      for (const product of [/Cemento/, /Tubo PVC/]) {
        await page.getByRole("button", { name: "Agregar producto" }).click();
        await page.getByRole("option", { name: product }).click();
        await expect(page.getByRole("dialog")).toBeHidden();
      }
      await expect(page.getByRole("button", { name: /Quitar la línea 2/ })).toBeVisible();
    },
  },
  // Borradores guardados.
  {
    route: "borrador",
    state: "listo",
    path: "/borradores/borrador-listo",
    group: "editor",
    widths: MAIN,
    dark: PAIR,
    ready: async (page) => {
      await heading(page, "Borrador de factura");
      await shows(page, "USD 61,81");
    },
  },
  {
    // La barra de acciones fija al pie, tal como se ve al desplazarse cuando el resumen se apila
    // (design D8). La captura entera la dibuja donde estaba la ventana; esta es la ventana real.
    route: "borrador",
    state: "barra-acciones",
    path: "/borradores/borrador-listo",
    group: "editor",
    widths: ["1024", "390", "1440z200"],
    viewportOnly: true,
    ready: (page) => heading(page, "Borrador de factura"),
    act: async (page) => {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 2));
      await expect(page.getByRole("button", { name: "Emitir factura" })).toBeInViewport();
    },
  },
  {
    route: "borrador",
    state: "problemas",
    path: "/borradores/borrador-problemas",
    group: "editor",
    widths: KEY,
    ready: async (page) => {
      await heading(page, "Borrador de factura");
      await shows(page, /no tiene el rol de cliente/);
    },
  },
  {
    route: "borrador",
    state: "cambios-sin-guardar",
    path: "/borradores/borrador-listo",
    group: "editor",
    widths: KEY,
    ready: (page) => heading(page, "Borrador de factura"),
    act: async (page) => {
      const quantity = page.getByLabel("Cantidad").first();
      await quantity.fill("5");
      await expect(quantity).toHaveValue("5");
    },
  },
  {
    route: "borrador",
    state: "sin-totales",
    path: "/borradores/borrador-sin-totales",
    group: "editor",
    widths: PAIR,
    ready: async (page) => {
      await heading(page, "Borrador de factura");
      await shows(page, /ya no está habilitada/);
    },
  },
  {
    route: "borrador",
    state: "incompleto",
    path: "/borradores/borrador-incompleto",
    group: "editor",
    widths: PAIR,
    ready: (page) => heading(page, "Borrador de factura"),
  },
  {
    route: "borrador",
    state: "confirmacion",
    path: "/borradores/borrador-listo",
    group: "editor",
    widths: PAIR,
    viewportOnly: true,
    ready: (page) => heading(page, "Borrador de factura"),
    act: async (page) => {
      await page.getByRole("button", { name: "Emitir factura" }).click();
      await expect(page.getByRole("alertdialog").or(page.getByRole("dialog"))).toBeVisible();
    },
  },
  {
    route: "borrador",
    state: "consumidor-final-confirmacion",
    path: "/borradores/borrador-consumidor-final",
    group: "editor",
    widths: ["1440"],
    viewportOnly: true,
    ready: (page) => heading(page, "Borrador de factura"),
    act: async (page) => {
      await page.getByRole("button", { name: "Emitir factura" }).click();
      await expect(page.getByRole("alertdialog").or(page.getByRole("dialog"))).toBeVisible();
    },
  },
  {
    route: "borrador",
    state: "produccion",
    path: "/borradores/borrador-listo",
    group: "editor",
    scenario: { environment: "PRODUCTION" },
    widths: PAIR,
    ready: (page) => heading(page, "Borrador de factura"),
  },
  {
    route: "borrador",
    state: "ambiente-desconocido",
    path: "/borradores/borrador-listo",
    group: "editor",
    scenario: { persona: "operator", overrides: UNKNOWN_ENVIRONMENT },
    widths: PAIR,
    ready: (page) => heading(page, "Borrador de factura"),
  },
  // Un editor heredado que emite: la nota de crédito.
  {
    route: "nota-credito",
    state: "lista",
    path: "/notas-credito/borradores/cnd-1",
    group: "editor",
    widths: PAIR,
    ready: async (page) => {
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("button", { name: "Emitir nota de crédito" })).toBeVisible();
    },
  },
  {
    route: "nota-credito",
    state: "confirmacion",
    path: "/notas-credito/borradores/cnd-1",
    group: "editor",
    widths: ["1440"],
    viewportOnly: true,
    ready: (page) => expect(page.getByRole("heading", { level: 1 })).toBeVisible(),
    act: async (page) => {
      await page.getByRole("button", { name: "Emitir nota de crédito" }).click();
      await expect(page.getByRole("alertdialog").or(page.getByRole("dialog"))).toBeVisible();
    },
  },
  // Una configuración y una lista heredada con su diálogo.
  {
    route: "empresa",
    state: "configurada",
    path: "/configuracion/empresa",
    group: "configuracion",
    widths: MAIN,
    ready: async (page) => {
      await heading(page, "Empresa");
      await expect(page.getByRole("textbox").first()).toBeVisible();
    },
  },
  {
    route: "productos",
    state: "poblada",
    path: "/productos",
    group: "listas",
    widths: ALL,
    dark: PAIR,
    ready: async (page) => {
      await heading(page, "Productos");
      await shows(page, "Cemento Holcim tipo GU 50 kg");
    },
  },
  {
    route: "productos",
    state: "dialogo-nuevo",
    path: "/productos",
    group: "listas",
    widths: ALL,
    viewportOnly: true,
    ready: (page) => heading(page, "Productos"),
    act: async (page) => {
      await page.getByRole("button", { name: "Nuevo producto" }).first().click();
      await expect(page.getByRole("dialog", { name: "Nuevo producto" })).toBeVisible();
    },
  },
];

export type Capture = { state: State; width: Width; theme: "claro" | "oscuro"; key: string };

/** Cada captura de la matriz, con su clave `<ruta>-<estado>-<anchura>-<tema>`. */
export function captures(): Capture[] {
  const filter = (process.env.REVIEW_FILTER ?? "").split(",").filter(Boolean);
  const result: Capture[] = [];
  for (const state of STATES) {
    const variants = [
      ...state.widths.map((width) => ({ width, theme: "claro" as const })),
      ...(state.dark ?? []).map((width) => ({ width, theme: "oscuro" as const })),
    ];
    for (const { width, theme } of variants) {
      const key = `${state.route}-${state.state}-${width}-${theme}`;
      if (filter.length > 0 && !filter.some((part) => key.includes(part))) continue;
      result.push({ state, width: WIDTHS[width], theme, key });
    }
  }
  return result;
}

/** Hoja de contacto de una captura: oscuro y móvil tienen la suya; el resto, la de su grupo. */
export function sheetOf(capture: { group: Group; width: WidthKey; theme: string }): string {
  if (capture.theme === "oscuro") return "oscuro";
  if (capture.width === "390" || capture.width === "320") return "movil";
  return capture.group;
}
