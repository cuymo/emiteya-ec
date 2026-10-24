// Tablero de Inicio: indicadores, ventas de los seis últimos meses con su tabla para la asistencia,
// comprobantes por tipo, mejores clientes y productos, estado de facturación electrónica, últimos comprobantes,
// requisitos pendientes, vacío y error. El servidor está simulado.
import { TOUR_SEGMENTS } from "@/features/onboarding/tour-steps";
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

/** Los selectores del recorrido de bienvenida de un tramo (add-onboarding-tour). */
const tourSelectors = (id: string) =>
  TOUR_SEGMENTS.find((segment) => segment.id === id)!.steps.flatMap((step) =>
    step.selector ? [step.selector] : [],
  );

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
      previousChangePercent: "-60.8",
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
  email: { pending: 0 },
  sri: { transmissionEnabled: true, lastContact: null },
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
    "GET /api/v1/email/availability": () => ({
      status: 200,
      body: {
        data: { configured: true, deliveryEnabled: true, autoSend: true, testRecipient: null },
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
  screen.findByText("Ventas autorizadas · octubre", undefined, { timeout: 5_000 });

/** El tablero con un resumen distinto del de base. */
const withSummary = (patch: Record<string, unknown>) => ({
  "GET /api/v1/dashboard": () => ({ status: 200, body: { data: { ...SUMMARY, ...patch } } }),
});

/** Las filas del estado de facturación electrónica: nombre, detalle y estado. */
const invoicingRows = () =>
  Array.from(
    card("Estado de facturación electrónica").querySelectorAll("[data-slot=invoicing-status]"),
  ).map((row) => (row as HTMLElement).innerText ?? row.textContent);

beforeEach(() => {
  navigation.pathname = "/";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("tablero de Inicio", () => {
  it("muestra los indicadores comerciales con su contexto y adónde ir", async () => {
    renderHome();
    await loaded();
    expect(screen.getByRole("heading", { level: 1, name: "Resumen" })).toBeDefined();
    const metrics = Array.from(
      document.querySelectorAll<HTMLElement>("[data-slot=dashboard-metric]"),
    );
    expect(metrics).toHaveLength(4);
    // redesign-dashboard-indicators, design D4: la variación la da el servidor, con signo y flecha.
    expect(metrics[0]!.textContent).toContain("USD 18.162,13");
    const trend = metrics[0]!.querySelector("[data-slot=dashboard-trend]")!;
    expect(trend.textContent).toBe("−60,8 %");
    expect(trend.getAttribute("data-variant")).toBe("destructive");
    expect(trend.querySelector("svg.lucide-trending-down")).not.toBeNull();
    expect(metrics[0]!.textContent).toContain("Frente a USD 46.346,22 en septiembre");
    expect(metrics[1]!.textContent).toContain("Facturas autorizadas15 / 19");
    expect(metrics[1]!.textContent).toContain("78,9 % de las facturas del mes");
    expect(metrics[2]!.textContent).toContain("Problemas de autorización2");
    expect(metrics[2]!.textContent).toContain("Devueltos o no autorizados en 30 días");
    expect(metrics[3]!.textContent).toContain("Facturas en borrador4");
    expect(metrics[3]!.textContent).toContain("Pendientes de emitir");
    // Cada uno lleva su icono en una caja, un enlace con flecha a su lista y el degradado azul.
    expect(
      metrics.map((metric) => {
        const link = within(metric).getByRole("link");
        return [link.getAttribute("aria-label"), link.getAttribute("href")];
      }),
    ).toEqual([
      ["Ver facturas autorizadas", "/facturas?estado=autorizadas"],
      ["Ver facturas", "/facturas"],
      ["Ver comprobantes devueltos", "/comprobantes?estado=devueltos"],
      ["Ver borradores", "/facturas?estado=borradores"],
    ]);
    for (const metric of metrics) {
      expect(metric.querySelector("[data-slot=dashboard-metric-icon] svg")).not.toBeNull();
      expect(metric.querySelector("a svg.lucide-arrow-up-right")).not.toBeNull();
      expect(metric.className).toContain("bg-linear-to-t");
      expect(metric.className).toContain("from-primary/8");
    }
    expect(screen.getByRole("link", { name: "Nueva factura" }).getAttribute("href")).toBe(
      "/borradores/nuevo",
    );
    // Anclajes del tramo Inicio del recorrido; los requisitos solo aparecen si faltan.
    for (const selector of tourSelectors("inicio").filter(
      (selector) => selector.includes("inicio-") && !selector.includes("requisitos"),
    )) {
      expect(document.querySelector(selector), selector).not.toBeNull();
    }
  });

  it("la variación sube en verde, no aparece sin mes anterior y los problemas en ámbar", async () => {
    renderHome(
      withSummary({
        month: {
          ...SUMMARY.month,
          invoices: { ...SUMMARY.month.invoices, previousChangePercent: "9.5" },
        },
      }),
    );
    await loaded();
    const [sales, , problems] = Array.from(
      document.querySelectorAll<HTMLElement>("[data-slot=dashboard-metric]"),
    );
    const trend = sales!.querySelector("[data-slot=dashboard-trend]")!;
    expect(trend.textContent).toBe("+9,5 %");
    expect(trend.getAttribute("data-variant")).toBe("success");
    expect(problems!.querySelector("[data-slot=dashboard-metric-icon]")!.className).toContain(
      "text-warning",
    );
  });

  it("sin ventas el mes anterior no hay variación", async () => {
    renderHome(
      withSummary({
        month: {
          ...SUMMARY.month,
          invoices: { ...SUMMARY.month.invoices, previousChangePercent: null },
        },
      }),
    );
    await loaded();
    expect(document.querySelector("[data-slot=dashboard-trend]")).toBeNull();
  });

  it("«Problemas de autorización» no cuenta los correos sin enviar", async () => {
    renderHome(withSummary({ attention: { ...SUMMARY.attention, emailFailed: 5 } }));
    await loaded();
    const problems = document.querySelectorAll("[data-slot=dashboard-metric]")[2]!;
    expect(problems.textContent).toContain("2");
    expect(problems.textContent).not.toContain("5");
    expect(problems.textContent).not.toMatch(/correo/i);
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

  it("los comprobantes por tipo, los clientes, los productos y el estado de facturación", async () => {
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
    const status = card("Estado de facturación electrónica");
    expect(await within(status).findByText("Vigente · Vence en 257 días")).toBeDefined();
    await waitFor(() =>
      expect(invoicingRows()).toEqual([
        "Firma electrónicaVigente · Vence en 257 díasActiva",
        "Conexión con SRITodavía no hay comunicaciones con el SRISin datos",
        "Entrega de comprobantesLos correos están al díaAl día",
      ]),
    );
    // Solo la firma tiene una sección que abrir aquí; el administrador la abre.
    expect(
      within(status)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")),
    ).toEqual(["/configuracion/firma"]);
  });

  it("la conexión con el SRI sale de la última comunicación guardada", async () => {
    const at = "2026-10-15T15:30:00.000Z";
    for (const [sri, expected] of [
      [
        { transmissionEnabled: false, lastContact: null },
        /^Conexión con SRIEl envío al SRI está apagado en este servidorApagado$/,
      ],
      [
        { transmissionEnabled: true, lastContact: { at, reached: true } },
        /^Conexión con SRIÚltima comunicación correcta: .+Disponible$/,
      ],
      [
        { transmissionEnabled: true, lastContact: { at, reached: false } },
        /^Conexión con SRILa última comunicación no tuvo respuesta: .+Sin respuesta$/,
      ],
    ] as const) {
      const view = renderHome(withSummary({ sri }));
      await loaded();
      expect(invoicingRows()[1]).toMatch(expected);
      view.unmount();
      vi.unstubAllGlobals();
    }
  });

  it("la entrega de comprobantes pide revisar los correos fallidos y lleva a la bandeja", async () => {
    renderHome(
      withSummary({
        attention: { ...SUMMARY.attention, emailFailed: 2 },
        email: { pending: 1 },
      }),
    );
    await loaded();
    await waitFor(() =>
      expect(invoicingRows()[2]).toBe("Entrega de comprobantes2 correos sin enviarRevisar"),
    );
    const row = card("Estado de facturación electrónica").querySelectorAll(
      "[data-slot=invoicing-status]",
    )[2]!;
    expect(
      within(row as HTMLElement)
        .getByRole("link")
        .getAttribute("href"),
    ).toBe("/comprobantes?correo=no-enviado");
  });

  it("la entrega muestra la cola, el servidor sin configurar y el envío apagado", async () => {
    const availability = (configured: boolean, deliveryEnabled: boolean) => ({
      "GET /api/v1/email/availability": () => ({
        status: 200,
        body: { data: { configured, deliveryEnabled, autoSend: configured, testRecipient: null } },
      }),
    });
    for (const [routes, expected] of [
      [
        { ...withSummary({ email: { pending: 3 } }), ...availability(true, true) },
        "Entrega de comprobantes3 correos en colaEnviando",
      ],
      [
        availability(false, true),
        "Entrega de comprobantesFalta configurar el servidor de correoConfigurar",
      ],
      [availability(true, false), "Entrega de comprobantesEl envío por correo está apagadoApagado"],
    ] as const) {
      const view = renderHome(routes);
      await loaded();
      await waitFor(() => expect(invoicingRows()[2]).toBe(expected));
      view.unmount();
      vi.unstubAllGlobals();
    }
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

  it("los requisitos pendientes no van en el tablero: tienen su página (redesign-dashboard-indicators, 4.1)", async () => {
    renderHome({ "GET /api/v1/company/status": () => status(false) });
    await loaded();
    expect(screen.queryByText("Tu empresa todavía no puede emitir")).toBeNull();
    expect(document.querySelector("[data-slot=dashboard-readiness]")).toBeNull();
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

  it("el operador también ve el tablero, sin el enlace de la firma, que es de Configuración", async () => {
    renderHome(withSummary({ attention: { ...SUMMARY.attention, emailFailed: 1 } }), OPERATOR_ME);
    expect(await loaded()).toBeDefined();
    const status = card("Estado de facturación electrónica");
    expect(await within(status).findByText("Vigente · Vence en 257 días")).toBeDefined();
    await waitFor(() =>
      expect(
        within(status)
          .getAllByRole("link")
          .map((link) => link.getAttribute("href")),
      ).toEqual(["/comprobantes?correo=no-enviado"]),
    );
  });
});
