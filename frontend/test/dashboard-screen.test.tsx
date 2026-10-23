// Tablero de Inicio: indicadores, ventas de los seis últimos meses con su tabla para la asistencia,
// comprobantes por tipo, mejores clientes y productos, estado del sistema, últimos comprobantes,
// requisitos pendientes, vacío y error. El servidor está simulado.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionGate } from "@/components/session";
import { HomeScreen } from "@/features/home/home-screen";
import {
  ADMIN_ME,
  OPERATOR_ME,
  errorBody,
  mockApi,
  navigation,
  renderApp,
  type Route,
} from "./harness";

const months = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
const SUMMARY = {
  environment: "TEST",
  today: "2026-10-16",
  month: {
    start: "2026-10-01",
    invoices: {
      authorizedTotal: "18162.13",
      authorizedCount: 15,
      issuedCount: 19,
      previousAuthorizedTotal: "46346.22",
    },
    byType: [
      { documentType: "01", issued: 19, authorized: 15, authorizedTotal: "18162.13" },
      { documentType: "06", issued: 2, authorized: 1, authorizedTotal: null },
    ],
  },
  monthly: months.map((month, index) => ({
    month,
    authorizedTotal: index === 5 ? "18162.13" : "40000.00",
    authorizedCount: index === 5 ? 15 : 30,
  })),
  attention: { count: 3, rejectedLast30Days: 2, emailFailed: 0 },
  drafts: { invoices: 4 },
  inventory: { outOfStock: 1 },
  topCustomers: [
    {
      identification: "0929235760",
      name: "ANA JARAMILLO ORTIZ",
      authorizedTotal: "3851.29",
      invoices: 1,
    },
  ],
  topProducts: [
    {
      mainCode: "TAL-18V",
      description: "Taladro percutor inalámbrico 18 V",
      quantity: "27",
      total: "3212.00",
    },
  ],
  recent: [
    {
      id: "inv-1",
      documentType: "01",
      documentNumber: "002-001-000000030",
      issueDate: "2026-10-15",
      counterpart: "DANIELA MORALES ZAMBRANO",
      total: "775.27",
      state: "AUTHORIZED",
    },
    {
      id: "gr-1",
      documentType: "06",
      documentNumber: "001-001-000000011",
      issueDate: "2026-10-10",
      counterpart: null,
      total: null,
      state: "RETURNED",
    },
  ],
};
const status = (ready: boolean) => ({
  status: 200,
  body: {
    data: {
      environment: "TEST",
      displayName: "Ferretería Andina",
      readiness: {
        ready,
        checks: [
          { key: "TAXPAYER_DATA", status: "MET" },
          { key: "EMISSION_POINT", status: "MET" },
          { key: "SIGNING_CERTIFICATE", status: ready ? "MET" : "PENDING" },
        ],
      },
    },
  },
});

function renderHome(
  routes: Record<string, Route> = {},
  me: typeof ADMIN_ME | typeof OPERATOR_ME = ADMIN_ME,
) {
  mockApi({
    "GET /api/v1/me": () => ({ status: 200, body: { data: me } }),
    "GET /api/v1/company/status": () => status(true),
    "GET /api/v1/signing-certificate/validity": () => ({
      status: 200,
      body: {
        data: {
          state: "VALID",
          usable: true,
          notAfter: "2027-06-30T23:59:59.000Z",
          daysToExpiry: 257,
        },
      },
    }),
    "GET /api/v1/dashboard": () => ({ status: 200, body: { data: SUMMARY } }),
    ...routes,
  });
  return renderApp(
    <SessionGate fallback={<p>cargando</p>}>
      <HomeScreen />
    </SessionGate>,
  );
}

const card = (title: string) =>
  screen
    .getByText(title, { selector: "[data-slot=card-title]" })
    .closest("[data-slot=card]") as HTMLElement;

/** El tablero con datos, no su esqueleto, que también lleva el título. */
const loaded = () =>
  screen.findByText("Ventas autorizadas de octubre", undefined, { timeout: 5_000 });

beforeEach(() => {
  navigation.pathname = "/";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("tablero de Inicio", () => {
  it("muestra los indicadores del mes con su contexto y adónde ir", async () => {
    renderHome();
    await loaded();
    expect(screen.getByRole("heading", { level: 1, name: "Resumen" })).toBeDefined();
    const metrics = document.querySelectorAll("[data-slot=dashboard-metric]");
    expect(metrics).toHaveLength(4);
    expect(metrics[0]!.textContent).toContain("Ventas autorizadas de octubre");
    expect(metrics[0]!.textContent).toContain("USD 18.162,13");
    expect(metrics[0]!.textContent).toContain("En septiembre: USD 46.346,22");
    expect(metrics[1]!.textContent).toContain("19");
    expect(metrics[1]!.textContent).toContain("15 autorizadas");
    expect(metrics[2]!.textContent).toContain("2 devueltos o no autorizados en 30 días");
    const drafts = within(metrics[3] as HTMLElement).getByRole("link", { name: "Ver borradores" });
    expect(drafts.getAttribute("href")).toBe("/facturas?estado=borradores");
    // El icono grande a la izquierda (10 % y 90 %) y una flecha en el enlace, que navega dentro de
    // la aplicación (decisiones del propietario, 2026-10-23).
    for (const metric of metrics) {
      expect(metric.querySelector("[data-slot=dashboard-metric-icon] svg")).not.toBeNull();
    }
    expect(drafts.querySelector("svg")).not.toBeNull();
    expect(drafts.getAttribute("target")).toBeNull();
    expect(screen.getByRole("link", { name: "Nueva factura" }).getAttribute("href")).toBe(
      "/borradores/nuevo",
    );
  });

  it("«Requieren atención» cuenta solo la atención del SRI, no los correos sin enviar", async () => {
    renderHome({
      "GET /api/v1/dashboard": () => ({
        status: 200,
        body: { data: { ...SUMMARY, attention: { ...SUMMARY.attention, emailFailed: 5 } } },
      }),
    });
    await loaded();
    const attention = document.querySelectorAll("[data-slot=dashboard-metric]")[2]!;
    expect(attention.textContent).toContain("3");
    expect(attention.textContent).not.toContain("5");
    expect(attention.textContent).not.toMatch(/correo/i);
  });

  it("las ventas de los seis meses tienen su tabla para la asistencia", async () => {
    renderHome();
    await loaded();
    const table = screen.getByRole("table", { name: "Ventas autorizadas por mes" });
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(7);
    expect(rows.at(-1)!.textContent).toContain("octubre");
    expect(rows.at(-1)!.textContent).toContain("USD 18.162,13");
  });

  it("los comprobantes por tipo, los clientes, los productos y el estado del sistema", async () => {
    renderHome();
    await loaded();
    // Los comprobantes por tipo van en un gráfico de barras apiladas con su tabla para la asistencia.
    const types = screen.getByRole("table", { name: "Comprobantes del mes por tipo" });
    const [typesHeader, invoices, guides] = within(types).getAllByRole("row");
    expect(typesHeader!.textContent).toBe("TipoEmitidosAutorizadosTotal autorizado");
    expect(invoices!.textContent).toBe("Factura1915USD 18.162,13");
    // La guía de remisión no tiene total.
    expect(guides!.textContent).toBe("Guía de remisión21—");
    await waitFor(() =>
      expect(
        card("Comprobantes del mes").querySelector("[data-slot=documents-chart] [data-slot=chart]"),
      ).not.toBeNull(),
    );
    expect(card("Comprobantes del mes").textContent).toContain("AutorizadosSin autorizar");
    expect(card("Mejores clientes").textContent).toContain("ANA JARAMILLO ORTIZ");
    expect(card("Mejores clientes").textContent).toContain("USD 3.851,29");
    expect(card("Productos más vendidos").textContent).toContain("TAL-18V · 27 unidades");
    const system = card("Estado del sistema");
    expect(await within(system).findByText("Vigente · 257 días")).toBeDefined();
    // Cada dato tiene su acceso rápido «Ir» a la sección.
    const shortcuts = within(system).getAllByRole("link");
    expect(shortcuts.map((link) => [link.textContent, link.getAttribute("aria-label")])).toEqual([
      ["Ir", "Ir a Firma electrónica"],
      ["Ir", "Ir a Ambiente"],
      ["Ir", "Ir a Inventario"],
      ["Ir", "Ir a Archivo de comprobantes"],
    ]);
    expect(shortcuts.map((link) => link.getAttribute("href"))).toEqual([
      "/configuracion/firma",
      "/configuracion/ambiente",
      "/inventario",
      "/comprobantes",
    ]);
  });

  it("los rankings de clientes y productos son gráficos con su tabla para la asistencia", async () => {
    renderHome();
    await loaded();
    // Los gráficos llegan aparte; las tablas, con la pantalla.
    await waitFor(() =>
      expect(document.querySelectorAll("[data-slot=ranking-chart] [data-slot=chart]")).toHaveLength(
        2,
      ),
    );
    const customers = screen.getByRole("table", { name: "Mejores clientes del mes" });
    const [header, first] = within(customers).getAllByRole("row");
    expect(header!.textContent).toBe("ClienteIdentificación y facturasFacturado");
    expect(first!.textContent).toBe("ANA JARAMILLO ORTIZ0929235760 · 1 facturaUSD 3.851,29");
    const products = screen.getByRole("table", { name: "Productos más vendidos del mes" });
    expect(within(products).getAllByRole("row")[1]!.textContent).toBe(
      "Taladro percutor inalámbrico 18 VTAL-18V · 27 unidadesUSD 3.212,00",
    );
  });

  it("los últimos comprobantes enlazan a su detalle con su estado", async () => {
    renderHome();
    const table = await screen.findByRole("table", { name: "Últimos comprobantes" });
    expect(
      within(table).getByRole("link", { name: "002-001-000000030" }).getAttribute("href"),
    ).toBe("/facturas/inv-1");
    expect(
      within(table).getByRole("link", { name: "001-001-000000011" }).getAttribute("href"),
    ).toBe("/guias-remision/gr-1");
    expect(within(table).getByText("Autorizado")).toBeDefined();
  });

  it("si la empresa no puede emitir, sus requisitos van primero", async () => {
    renderHome({ "GET /api/v1/company/status": () => status(false) });
    const readiness = await screen.findByText("Tu empresa todavía no puede emitir");
    expect(readiness.closest("[data-slot=dashboard-readiness]")?.textContent).toContain(
      "Firma electrónica",
    );
  });

  it("sin comprobantes invita a emitir el primero", async () => {
    renderHome({
      "GET /api/v1/dashboard": () => ({
        status: 200,
        body: {
          data: {
            ...SUMMARY,
            recent: [],
            topCustomers: [],
            topProducts: [],
            month: { ...SUMMARY.month, byType: [] },
          },
        },
      }),
    });
    expect(await screen.findByText(/Todavía no hay comprobantes en Pruebas/)).toBeDefined();
    expect(screen.getAllByText("Aún no hay facturas autorizadas este mes.")).toHaveLength(2);
  });

  it("un error se reintenta", async () => {
    let fail = true;
    renderHome({
      "GET /api/v1/dashboard": () =>
        fail
          ? { status: 500, body: errorBody("INTERNAL_ERROR", "x") }
          : { status: 200, body: { data: SUMMARY } },
    });
    expect(
      await screen.findByText("No pudimos cargar el resumen.", undefined, { timeout: 5_000 }),
    ).toBeDefined();
    fail = false;
    await userEvent.setup().click(screen.getByRole("button", { name: "Intentar de nuevo" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Resumen" })).toBeDefined();
    expect((await screen.findAllByText("USD 18.162,13")).length).toBeGreaterThan(0);
  }, 10_000);

  it("el operador también ve el tablero, con los accesos rápidos de las secciones que abre", async () => {
    renderHome({}, OPERATOR_ME);
    expect(await loaded()).toBeDefined();
    // La firma y el ambiente son de Configuración, que el operador no abre: su estado sí se ve.
    const system = card("Estado del sistema");
    expect(within(system).getByText("Firma electrónica")).toBeDefined();
    expect(
      within(system)
        .getAllByRole("link")
        .map((link) => link.getAttribute("aria-label")),
    ).toEqual(["Ir a Inventario", "Ir a Archivo de comprobantes"]);
  });
});
