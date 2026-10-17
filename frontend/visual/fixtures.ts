// Datos deterministas del harness visual (design D17). Cada `/api/v1` del navegador se responde aquí
// con la forma exacta de los contratos; cualquier petición a otro origen se corta y se registra, y
// cualquier ruta de la API sin respuesta declarada también, para que la prueba falle.
import type { Browser, BrowserContextOptions, Page } from "@playwright/test";
import { editorReply } from "./editor-fixtures";

export type Persona = "admin" | "operator" | "anonymous";
export type Environment = "TEST" | "PRODUCTION";

export type Scenario = {
  persona: Persona;
  environment?: Environment;
  /** Facturas de la empresa; por defecto, `INVOICES`. La lista las filtra como el servidor. */
  invoices?: InvoiceSummary[];
  /** Respuestas propias de una prueba, por `MÉTODO /ruta`; se consultan antes que las comunes. */
  overrides?: Record<string, Reply>;
};

/** Servidor del build de producción que arranca `playwright.config.ts`. */
export const BASE_URL = "http://127.0.0.1:4310";

/** 2026-10-14 10:00 en Ecuador: el reloj fijo de todas las capturas. */
export const FIXED_NOW = new Date("2026-10-14T15:00:00.000Z");

export const DESKTOP = { width: 1280, height: 800 } as const;
export const MOBILE = { width: 390, height: 844 } as const;

const ME = {
  admin: { name: "Ana Admin", email: "ana@empresa.ec", role: "ADMIN" },
  operator: { name: "Óscar Operador", email: "oscar@empresa.ec", role: "OPERATOR" },
} as const;

export const INVOICES = [
  [
    "inv-1",
    "001-001-000000123",
    "2026-10-14",
    "0992877878001",
    "EL PERNO CIA. LTDA.",
    "28.75",
    "AUTHORIZED",
  ],
  [
    "inv-2",
    "001-001-000000122",
    "2026-10-13",
    "1790012345001",
    "Comercial Andina S.A.",
    "1250.00",
    "SEND_UNKNOWN",
  ],
  [
    "inv-3",
    "001-001-000000121",
    "2026-10-13",
    "0102030405",
    "María José Paredes",
    "45.10",
    "RECEIVED",
  ],
  [
    "inv-4",
    "001-001-000000120",
    "2026-10-12",
    "9999999999999",
    "CONSUMIDOR FINAL",
    "3.45",
    "RETURNED",
  ],
  [
    "inv-5",
    "001-001-000000119",
    "2026-10-11",
    "0991234567001",
    "Distribuidora del Pacífico",
    "980.40",
    "SIGNED",
  ],
].map(([id, documentNumber, issueDate, buyerIdentification, buyerName, total, state]) => ({
  id,
  documentNumber,
  environment: "TEST",
  issueDate,
  buyerIdentification,
  buyerName,
  total,
  state,
  diagnosticCode: null,
  transmissionStopped: false,
  createdAt: `${issueDate}T15:00:00.000Z`,
}));

/** Una fila de la lista de facturas, con la forma de `invoiceSummaryViewSchema`. */
export type InvoiceSummary = {
  id: string;
  documentNumber: string;
  environment: string;
  issueDate: string;
  buyerIdentification: string;
  buyerName: string;
  total: string;
  state: string;
  diagnosticCode: string | null;
  transmissionStopped: boolean;
  createdAt: string;
};

/** Una factura del catálogo con los campos que la lista recibe del servidor. */
function invoice(
  id: string,
  sequential: number,
  issueDate: string,
  buyerIdentification: string,
  buyerName: string,
  total: string,
  state: string,
  extra: { environment?: Environment; transmissionStopped?: boolean } = {},
) {
  return {
    id,
    documentNumber: `001-001-${String(sequential).padStart(9, "0")}`,
    environment: extra.environment ?? "TEST",
    issueDate,
    buyerIdentification,
    buyerName,
    total,
    state,
    diagnosticCode: null,
    transmissionStopped: extra.transmissionStopped ?? false,
    createdAt: `${issueDate}T15:00:00.000Z`,
  };
}

/**
 * Catálogo de la lista de facturas (productize-invoice-list-and-shared-table-foundation, tarea 1.1):
 * los ocho estados, una transmisión detenida (atención sin ser `SEND_UNKNOWN` ni `MANUAL_REVIEW`) y
 * un total de cuatro cifras, en el orden del servidor (más recientes primero).
 */
export const INVOICE_CATALOG: InvoiceSummary[] = [
  invoice(
    "cat-01",
    140,
    "2026-10-14",
    "0992877878001",
    "EL PERNO CIA. LTDA.",
    "28.75",
    "AUTHORIZED",
  ),
  invoice(
    "cat-02",
    139,
    "2026-10-14",
    "1790012345001",
    "Comercial Andina S.A.",
    "1250.00",
    "SEND_UNKNOWN",
  ),
  invoice("cat-03", 138, "2026-10-13", "0102030405", "María José Paredes", "45.10", "RECEIVED"),
  invoice(
    "cat-04",
    137,
    "2026-10-13",
    "1791234567001",
    "Importadora Quito Cía. Ltda.",
    "312.00",
    "MANUAL_REVIEW",
  ),
  invoice(
    "cat-05",
    136,
    "2026-10-12",
    "0991234567001",
    "Distribuidora del Pacífico",
    "980.40",
    "SIGNED",
    { transmissionStopped: true },
  ),
  invoice("cat-06", 135, "2026-10-12", "9999999999999", "CONSUMIDOR FINAL", "3.45", "RETURNED"),
  invoice(
    "cat-07",
    134,
    "2026-10-11",
    "0190123456001",
    "Servicios Técnicos del Sur",
    "76.20",
    "NOT_AUTHORIZED",
  ),
  invoice("cat-08", 133, "2026-10-11", "1712345678", "Juan Pérez", "12.00", "RESERVED"),
  invoice(
    "cat-09",
    132,
    "2026-10-10",
    "0990011223001",
    "Ferretería La Esquina",
    "4599.99",
    "AUTHORIZED",
  ),
  invoice(
    "cat-10",
    131,
    "2026-10-10",
    "1790098765001",
    "Constructora Valle Alto S.A.",
    "640.00",
    "SIGNED",
  ),
];

/**
 * Una empresa ya en Producción, con dos facturas antiguas de Pruebas: la lista del servidor mezcla
 * los ambientes, y cada fila trae el suyo.
 */
export const PRODUCTION_INVOICES: InvoiceSummary[] = INVOICE_CATALOG.map((row, index) => ({
  ...row,
  environment: index === 2 || index === 8 ? "TEST" : "PRODUCTION",
}));

/** Estados que el servidor reúne en «Requiere atención», además de la transmisión detenida. */
const ATTENTION_STATES = ["SEND_UNKNOWN", "MANUAL_REVIEW"];

/** La lista de facturas filtrada y paginada con la semántica del servidor (`prisma-documents.ts`). */
function invoiceList(rows: InvoiceSummary[], query: URLSearchParams): Reply {
  const search = query.get("search")?.trim() ?? "";
  const state = query.get("state");
  const attention = query.get("attention") === "true";
  const page = Number(query.get("page") ?? "1");
  const pageSize = Number(query.get("pageSize") ?? "25");
  const matching = rows.filter(
    (row) =>
      (!state || row.state === state) &&
      (!attention || ATTENTION_STATES.includes(row.state) || row.transmissionStopped) &&
      (!search ||
        row.documentNumber.includes(search) ||
        row.buyerIdentification.includes(search) ||
        row.buyerName.toLowerCase().includes(search.toLowerCase())),
  );
  return {
    status: 200,
    body: {
      data: matching.slice((page - 1) * pageSize, page * pageSize),
      meta: { page, pageSize, total: matching.length },
    },
  };
}

/**
 * La lista unificada de Facturas (unify-drafts-into-document-lists): el catálogo no tiene borradores,
 * así que son las facturas como entradas, y el filtro de borradores queda vacío.
 */
function invoiceEntries(rows: InvoiceSummary[], query: URLSearchParams): Reply {
  const draftsOnly = query.get("state") === "DRAFT";
  const filtered = new URLSearchParams(query);
  filtered.delete("state");
  if (!draftsOnly && query.get("state")) filtered.set("state", query.get("state")!);
  const list = invoiceList(draftsOnly ? [] : rows, filtered).body as {
    data: InvoiceSummary[];
    meta: { page: number; pageSize: number; total: number };
  };
  return {
    status: 200,
    body: {
      data: list.data.map((document) => ({ kind: "DOCUMENT", document })),
      meta: list.meta,
    },
  };
}

export type Reply = { status: number; body?: unknown };

function reply(
  scenario: Scenario,
  method: string,
  path: string,
  query: URLSearchParams,
  body: string | null = null,
): Reply | null {
  const environment = scenario.environment ?? "TEST";
  if (scenario.persona === "anonymous") {
    if (method === "GET" && path === "/api/v1/me") {
      return {
        status: 401,
        body: { error: { code: "UNAUTHENTICATED", message: "Sin sesión.", requestId: "visual" } },
      };
    }
    return null;
  }
  const route = `${method} ${path}`;
  const override = scenario.overrides?.[route];
  if (override) return override;
  switch (route) {
    case "GET /api/v1/me":
      return { status: 200, body: { data: ME[scenario.persona] } };
    case "GET /api/v1/company/status":
      return {
        status: 200,
        body: {
          data: {
            environment,
            displayName: "Ferretería Andina",
            readiness: {
              ready: false,
              checks: [
                { key: "TAXPAYER_DATA", status: "MET" },
                { key: "EMISSION_POINT", status: "MET" },
                { key: "SIGNING_CERTIFICATE", status: "PENDING" },
              ],
            },
          },
        },
      };
    case "GET /api/v1/signing-certificate/validity":
      return {
        status: 200,
        body: {
          data: {
            state: "VALID",
            usable: true,
            notAfter: "2027-06-30T23:59:59.000Z",
            daysToExpiry: 259,
          },
        },
      };
    case "GET /api/v1/invoices":
      return invoiceList(scenario.invoices ?? (INVOICES as InvoiceSummary[]), query);
    case "GET /api/v1/invoices/entries":
      return invoiceEntries(scenario.invoices ?? (INVOICES as InvoiceSummary[]), query);
    default:
      // El editor de facturas y los catálogos de sus pantallas vecinas (editor-fixtures.ts).
      return editorReply(method, path, query, scenario.environment ?? "TEST", body);
  }
}

export type Recorder = { unexpected: string[]; external: string[] };

/** Contexto determinista: idioma, zona, movimiento reducido y tema del sistema pedidos. */
export async function openPage(
  browser: Browser,
  scenario: Scenario,
  options: BrowserContextOptions = {},
): Promise<{ page: Page; recorder: Recorder }> {
  // `browser.newContext` no hereda `use` de la configuración: el contexto se declara completo aquí.
  const context = await browser.newContext({
    baseURL: BASE_URL,
    locale: "es-EC",
    timezoneId: "America/Guayaquil",
    reducedMotion: "reduce",
    deviceScaleFactor: 1,
    viewport: DESKTOP,
    ...options,
  });
  const page = await context.newPage();
  await page.clock.setFixedTime(FIXED_NOW);
  const recorder: Recorder = { unexpected: [], external: [] };
  const origin = new URL(BASE_URL).origin;
  // Se registra primero el comodín: Playwright prueba las rutas en orden inverso.
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) {
      recorder.external.push(url.href);
      return route.abort();
    }
    return route.continue();
  });
  await page.route("**/api/v1/**", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const found = reply(
      scenario,
      request.method(),
      url.pathname,
      url.searchParams,
      request.postData(),
    );
    if (!found) {
      recorder.unexpected.push(`${request.method()} ${url.pathname}`);
      return route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "NOT_FOUND", message: "Sin datos de prueba.", requestId: "visual" },
        }),
      });
    }
    return route.fulfill({
      status: found.status,
      contentType: "application/json",
      body: found.body === undefined ? "" : JSON.stringify(found.body),
    });
  });
  return { page, recorder };
}

/** Espera a que la pantalla termine de cargar: sin estados ocupados, red en calma y fuentes listas. */
export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  await page
    .locator("[aria-busy='true']")
    .first()
    .waitFor({ state: "detached", timeout: 15_000 })
    .catch(() => undefined);
  await page.waitForFunction(() => document.querySelectorAll("[aria-busy='true']").length === 0);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

/**
 * Caja de cada elemento visible, con su ruta en el DOM (design D3). Redondeada a centésimas de píxel
 * para que el volcado sea estable entre ejecuciones de la misma máquina.
 */
export async function dumpGeometry(page: Page): Promise<string> {
  const boxes = await page.evaluate(() => {
    const path = (element: Element): string => {
      const parts: string[] = [];
      let node: Element | null = element;
      while (node && node !== document.body) {
        const parent: Element | null = node.parentElement;
        const tag = node.tagName.toLowerCase();
        const index = parent
          ? Array.from(parent.children)
              .filter((child) => child.tagName === node!.tagName)
              .indexOf(node)
          : 0;
        parts.unshift(`${tag}:${index}`);
        node = parent;
      }
      return parts.join(">");
    };
    const round = (value: number) => Math.round(value * 100) / 100;
    const result: { path: string; x: number; y: number; w: number; h: number }[] = [];
    for (const element of Array.from(document.body.querySelectorAll("*"))) {
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      result.push({
        path: path(element),
        x: round(rect.x),
        y: round(rect.y + window.scrollY),
        w: round(rect.width),
        h: round(rect.height),
      });
    }
    return result;
  });
  return `${boxes.map((box) => JSON.stringify(box)).join("\n")}\n`;
}
