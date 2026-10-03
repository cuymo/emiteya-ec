import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionGate } from "@/components/session";
import { FiscalCatalogsScreen } from "@/features/fiscal-catalogs/catalogs-screen";
import {
  ADMIN_ME,
  OPERATOR_ME,
  errorBody,
  mockApi,
  navigation,
  renderApp,
  type Route,
} from "./harness";

const SOURCE = {
  document: "Ficha técnica",
  version: "2.34",
  publishedOn: "2026-07-27",
  url: "https://www.sri.gob.ec/facturacion-electronica",
  sha256: "a".repeat(64),
};
const summary = (catalogType: string, enablementPolicy: string) => ({
  catalogType,
  datasetVersion: 1,
  source: SOURCE,
  enablementPolicy,
});
const SUMMARIES = [
  summary("identification-type", "NOT_ENABLEABLE"),
  summary("tax", "NOT_ENABLEABLE"),
  summary("iva-rate", "DEFAULT_ENABLED"),
  summary("ice-rate", "DEFAULT_DISABLED"),
  summary("irbpnr-rate", "DEFAULT_DISABLED"),
  summary("payment-method", "DEFAULT_ENABLED"),
];

type Version = Record<string, unknown>;
const version = (overrides: Version = {}): Version => ({
  id: "v",
  officialLabel: "15%",
  effectiveFrom: "2026-07-27",
  effectiveFromBasis: "PROJECT_BASELINE",
  effectiveTo: null,
  normativeStatus: "OFFICIAL",
  sourceRef: "Tabla 17, página 30",
  datasetVersion: 1,
  rate: null,
  taxKind: null,
  identificationRule: null,
  ...overrides,
});
const entry = (
  entryKey: string,
  v: Version,
  { enabled = true, source = "DEFAULT", applicable = true, code = entryKey } = {},
) => ({
  entryKey,
  code,
  versions: [v],
  applicable: applicable ? v : null,
  enablement: { enabled, source },
  usable: applicable && enabled,
});
const ivaRate = (code: string, label: string, percentage: string | null, rateKind = "PERCENTAGE") =>
  version({
    id: `iva-${code}`,
    officialLabel: label,
    rate: { taxKind: "IVA", sriTaxCode: "2", rateKind, percentage },
  });

const catalog = (catalogType: string, entries: unknown[]) => ({
  status: 200,
  body: {
    data: {
      catalog: SUMMARIES.find((s) => s.catalogType === catalogType),
      at: "2026-10-03",
      entries,
    },
  },
});

function routes(overrides: Record<string, Route> = {}): Record<string, Route> {
  return {
    "GET /api/v1/fiscal-catalogs": () => ({ status: 200, body: { data: SUMMARIES } }),
    "GET /api/v1/fiscal-catalogs/iva-rate/entries": () =>
      catalog("iva-rate", [
        entry("3", ivaRate("3", "14%", "14")),
        entry("4", ivaRate("4", "15%", "15")),
        entry("8", ivaRate("8", "IVA diferenciado", null, "DIFFERENTIATED")),
      ]),
    "GET /api/v1/fiscal-catalogs/payment-method/entries": () =>
      catalog("payment-method", [
        entry(
          "19",
          version({
            id: "pm-19",
            officialLabel: "TARJETA DE CRÉDITO",
            effectiveFrom: "2016-06-01",
            effectiveFromBasis: "SOURCE_STATED",
          }),
        ),
      ]),
    "GET /api/v1/fiscal-catalogs/ice-rate/entries": () =>
      catalog("ice-rate", [
        entry(
          "3011",
          version({
            id: "ice-3011",
            officialLabel: "ICE Cigarrillos Rubios",
            rate: { taxKind: "ICE", sriTaxCode: "3", rateKind: "PER_NORMATIVE", percentage: null },
          }),
          { enabled: false },
        ),
        entry(
          "3041-GRAN-ESCALA",
          version({
            id: "ice-3041",
            officialLabel: "ICE Cerveza Industrial Gran Escala",
            rate: { taxKind: "ICE", sriTaxCode: "3", rateKind: "PER_NORMATIVE", percentage: null },
          }),
          { enabled: false, code: "3041" },
        ),
      ]),
    "GET /api/v1/fiscal-catalogs/irbpnr-rate/entries": () =>
      catalog("irbpnr-rate", [
        entry(
          "5001",
          version({
            id: "irbpnr",
            officialLabel: "IRBPNR",
            rate: { taxKind: "IRBPNR", sriTaxCode: "5", rateKind: "PER_UNIT", percentage: null },
          }),
          { enabled: false, applicable: false },
        ),
      ]),
    "GET /api/v1/fiscal-catalogs/identification-type/entries": () =>
      catalog("identification-type", [
        entry(
          "07",
          version({
            id: "id-07",
            officialLabel: "VENTA A CONSUMIDOR FINAL",
            identificationRule: {
              pattern: "^9{13}$",
              description: "Reservado al consumidor final del sistema: 13 dígitos de nueve",
              reservedFor: "CONSUMER_FINAL",
            },
          }),
          { source: "NOT_ENABLEABLE" },
        ),
      ]),
    "GET /api/v1/fiscal-catalogs/consumer-final-policy": () => ({
      status: 200,
      body: {
        data: {
          source: SOURCE,
          at: "2026-10-03",
          applicable: {
            id: "p1",
            maxAmount: "50",
            currency: "USD",
            identificationType: "07",
            identification: "9999999999999",
            canonicalName: "CONSUMIDOR FINAL",
            effectiveFrom: "2026-07-27",
            effectiveFromBasis: "PROJECT_BASELINE",
            effectiveTo: null,
            sourceRef: "Numeral 9.10, página 29",
            datasetVersion: 1,
          },
          versions: [],
        },
      },
    }),
    "GET /api/v1/fiscal-catalogs/special-cases": () => ({
      status: 200,
      body: {
        data: [
          {
            annex: 26,
            topic: "RUC del proveedor del sistema",
            category: "CONDITIONAL_GO_LIVE",
            sourceRef: "ADR 0014",
          },
        ],
      },
    }),
    "GET /api/v1/fiscal-catalogs/schemas": () => ({
      status: 200,
      body: {
        data: [
          {
            kind: "DOCUMENT",
            path: "sri-xsd/factura_V1.1.0.xsd",
            documentType: "01",
            root: "factura",
            version: "1.1.0",
            file: "factura_V1.1.0.xsd",
            sha256: "b".repeat(64),
            source: "SRI",
            revision: null,
            imports: ["w3c-xsd/xmldsig-core-schema.xsd"],
            downloadedAt: "2026-10-02T15:38:05.000Z",
            supported: true,
          },
          {
            kind: "IMPORT",
            path: "w3c-xsd/xmldsig-core-schema.xsd",
            documentType: null,
            root: null,
            version: null,
            file: "xmldsig-core-schema.xsd",
            sha256: "c".repeat(64),
            source: "W3C",
            revision: "1.2 (2013-04-16)",
            imports: [],
            downloadedAt: "2026-10-03T10:31:13.000Z",
            supported: true,
          },
        ],
      },
    }),
    ...overrides,
  };
}

function renderScreen(
  overrides: Record<string, Route> = {},
  me = ADMIN_ME as typeof ADMIN_ME | typeof OPERATOR_ME,
) {
  const calls = mockApi({
    "GET /api/v1/me": () => ({ status: 200, body: { data: me } }),
    ...routes(overrides),
  });
  renderApp(
    <SessionGate fallback={<p>cargando</p>}>
      <FiscalCatalogsScreen />
    </SessionGate>,
  );
  return calls;
}

const ivaList = () => screen.findByRole("list", { name: "Tarifas de IVA" });
const row = async (list: Promise<HTMLElement>, label: string) =>
  within(await list)
    .getByText(label)
    .closest("li")!;

beforeEach(() => {
  navigation.pathname = "/configuracion/catalogos-fiscales";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Catálogos fiscales (design D17)", () => {
  it("muestra la carga mientras llegan los catálogos", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const base = routes();
    mockApi({
      "GET /api/v1/me": () => ({ status: 200, body: { data: ADMIN_ME } }),
      ...base,
    });
    const fetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        if (input.endsWith("/fiscal-catalogs")) await gate;
        return fetch(input, init);
      }),
    );
    renderApp(
      <SessionGate fallback={<p>cargando</p>}>
        <FiscalCatalogsScreen />
      </SessionGate>,
    );
    await waitFor(() => expect(document.querySelector('section[aria-busy="true"]')).not.toBeNull());
    release();
    expect(await ivaList()).toBeDefined();
  });

  it("un error se puede reintentar", async () => {
    let fail = true;
    renderScreen({
      "GET /api/v1/fiscal-catalogs": () =>
        fail
          ? { status: 500, body: errorBody("INTERNAL_ERROR", "x") }
          : { status: 200, body: { data: SUMMARIES } },
    });
    const alert = await screen.findByRole("alert", undefined, { timeout: 5_000 });
    fail = false;
    await userEvent.setup().click(within(alert).getByRole("button"));
    expect(await ivaList()).toBeDefined();
  }, 10_000);

  it("las tarifas muestran su semántica y el origen de su fecha, sin presentarla como vigencia legal", async () => {
    renderScreen();
    const fifteen = await row(ivaList(), "15%");
    expect(fifteen.textContent).toContain("Código 4 · 15 %");
    expect(fifteen.textContent).toContain("Base del proyecto: ficha v2.34 (27/07/2026)");
    expect(fifteen.textContent).not.toMatch(/vigente desde/i);
    expect((await row(ivaList(), "IVA diferenciado")).textContent).toContain(
      "Diferenciado: sin tarifa fija en la ficha",
    );
    const card = await row(
      screen.findByRole("list", { name: "Formas de pago" }),
      "TARJETA DE CRÉDITO",
    );
    expect(card.textContent).toContain("Desde 01/06/2016 (declarada por la fuente)");
  });

  it("el administrador deshabilita una tarifa; el Switch se bloquea mientras guarda", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const calls = renderScreen({
      "PUT /api/v1/fiscal-catalogs/iva-rate/entries/3/enablement": () => ({
        status: 200,
        body: {
          data: entry("3", ivaRate("3", "14%", "14"), { enabled: false, source: "COMPANY" }),
        },
      }),
    });
    const fetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        if (init?.method === "PUT") await gate;
        return fetch(input, init);
      }),
    );
    const fourteen = await row(ivaList(), "14%");
    const toggle = within(fourteen).getByRole("switch", { name: "14%" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    await userEvent.setup().click(toggle);
    await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(true));
    release();
    expect(
      await screen.findByText("Deshabilitaste la tarifa de IVA 14% para tu empresa."),
    ).toBeDefined();
    expect(
      calls.find((c) => c.key === "PUT /api/v1/fiscal-catalogs/iva-rate/entries/3/enablement")
        ?.body,
    ).toEqual({ enabled: false });
  });

  it("el Switch funciona con el teclado", async () => {
    const calls = renderScreen({
      "PUT /api/v1/fiscal-catalogs/ice-rate/entries/3011/enablement": () => ({
        status: 200,
        body: {
          data: entry(
            "3011",
            version({
              id: "ice-3011",
              officialLabel: "ICE Cigarrillos Rubios",
              rate: {
                taxKind: "ICE",
                sriTaxCode: "3",
                rateKind: "PER_NORMATIVE",
                percentage: null,
              },
            }),
            { enabled: true, source: "COMPANY" },
          ),
        },
      }),
    });
    const toggle = await screen.findByRole("switch", { name: "ICE Cigarrillos Rubios" });
    toggle.focus();
    await userEvent.setup().keyboard(" ");
    await waitFor(() =>
      expect(
        calls.find((c) => c.key === "PUT /api/v1/fiscal-catalogs/ice-rate/entries/3011/enablement")
          ?.body,
      ).toEqual({ enabled: true }),
    );
  });

  it("el operador consulta en solo lectura", async () => {
    renderScreen({}, OPERATOR_ME);
    const toggle = within(await row(ivaList(), "15%")).getByRole("switch", { name: "15%" });
    expect((toggle as HTMLButtonElement).disabled).toBe(true);
    expect(
      screen.getAllByText("Solo un administrador cambia la habilitación.").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText(/solo un administrador elige qué entradas usa la empresa/),
    ).toBeDefined();
  });

  it("ICE se filtra por código o denominación y muestra la variante de los códigos repetidos", async () => {
    renderScreen();
    const list = await screen.findByRole("list", { name: "ICE" });
    expect(within(list).getByText(/variante 3041-GRAN-ESCALA/)).toBeDefined();
    expect(within(list).getAllByText(/no está en el catálogo/).length).toBe(2);
    await userEvent
      .setup()
      .type(screen.getByLabelText("Filtrar por código o denominación"), "cerveza");
    await waitFor(() => expect(within(list).queryByText("ICE Cigarrillos Rubios")).toBeNull());
    expect(within(list).getByText("ICE Cerveza Industrial Gran Escala")).toBeDefined();
  });

  it("una entrada sin versión aplicable hoy se marca como no vigente", async () => {
    renderScreen();
    const irbpnr = await row(screen.findByRole("list", { name: "IRBPNR" }), "IRBPNR");
    expect(within(irbpnr).getByText("No vigente hoy")).toBeDefined();
    expect(irbpnr.textContent).toContain("Sin tarifa transcrita");
  });

  it("los datos de solo lectura: identificación, consumidor final, matriz y esquemas", async () => {
    renderScreen();
    const user = userEvent.setup();
    await user.click(await screen.findByText("Consumidor final"));
    expect(await screen.findByText("USD 50,00")).toBeDefined();
    expect(screen.getByText("Tipo 07 · 9999999999999")).toBeDefined();
    await user.click(screen.getByText("Tipos de identificación"));
    expect(await screen.findByText(/no disponible para registrar terceros/)).toBeDefined();
    await user.click(screen.getByText("Casos especiales"));
    expect(await screen.findByText(/Condición del go-live/)).toBeDefined();
    await user.click(screen.getByText("Esquemas XSD"));
    expect(await screen.findByText(/factura_V1.1.0.xsd · soportado/)).toBeDefined();
    expect(screen.getByText("Esquema importado, revisión 1.2 (2013-04-16)")).toBeDefined();
    expect(screen.getByText(/xmldsig-core-schema.xsd · soportado/)).toBeDefined();
    // Cada esquema con su fuente y su hash, también el importado de la firma XML.
    expect(screen.getByText("Fuente: SRI")).toBeDefined();
    expect(screen.getByText(`SHA-256 ${"b".repeat(64)}`)).toBeDefined();
    expect(screen.getByText("Fuente: W3C")).toBeDefined();
    expect(screen.getByText(`SHA-256 ${"c".repeat(64)}`)).toBeDefined();
  });
});

describe("Catálogos fiscales sin permiso", () => {
  it("explica que no tiene permiso", async () => {
    vi.resetModules();
    vi.doMock("@/lib/permissions", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/permissions")>();
      return { ...actual, canSee: () => false };
    });
    const { FiscalCatalogsScreen: Screen } =
      await import("@/features/fiscal-catalogs/catalogs-screen");
    const { SessionGate: Gate } = await import("@/components/session");
    mockApi({ "GET /api/v1/me": () => ({ status: 200, body: { data: ADMIN_ME } }) });
    renderApp(
      <Gate fallback={<p>cargando</p>}>
        <Screen />
      </Gate>,
    );
    expect(await screen.findByText("No tienes permiso para ver esta sección")).toBeDefined();
    vi.doUnmock("@/lib/permissions");
  });
});

describe("Catálogos fiscales con productos (add-parties-and-products, design D17)", () => {
  const withUsage = (overrides: Record<string, Route> = {}) => ({
    "GET /api/v1/products/tax-summary": () => ({
      status: 200,
      body: {
        data: {
          evaluatedOn: "2026-10-03",
          byStatus: { READY: 5, REVIEW_REQUIRED: 2, INCOMPLETE: 1 },
          byEntry: [{ catalogType: "iva-rate", entryKey: "3", activeProducts: 3 }],
        },
      },
    }),
    "PUT /api/v1/fiscal-catalogs/iva-rate/entries/3/enablement": () => ({
      status: 200,
      body: { data: entry("3", ivaRate("3", "14%", "14"), { enabled: false, source: "COMPANY" }) },
    }),
    "PUT /api/v1/fiscal-catalogs/iva-rate/entries/4/enablement": () => ({
      status: 200,
      body: { data: entry("4", ivaRate("4", "15%", "15"), { enabled: false, source: "COMPANY" }) },
    }),
    ...overrides,
  });
  const puts = (calls: { key: string }[]) => calls.filter((c) => c.key.startsWith("PUT "));

  it("muestra cuántos productos activos usan cada entrada y cuántos necesitan revisión", async () => {
    renderScreen(withUsage());
    const fourteen = await row(ivaList(), "14%");
    expect(await within(fourteen).findByText("Usada por 3 productos activos")).toBeDefined();
    expect(await screen.findByText("2 productos necesitan revisión")).toBeDefined();
    expect(screen.getByRole("link", { name: "Ver en Productos" }).getAttribute("href")).toBe(
      "/productos?tributario=revisar",
    );
  });

  it("deshabilitar una entrada en uso pide confirmación; cancelar no cambia nada", async () => {
    const calls = renderScreen(withUsage());
    const fourteen = await row(ivaList(), "14%");
    await within(fourteen).findByText("Usada por 3 productos activos");
    const user = userEvent.setup();
    await user.click(within(fourteen).getByRole("switch", { name: "14%" }));
    const dialog = await screen.findByRole("dialog", { name: "¿Deshabilitar 14%?" });
    expect(
      within(dialog).getByText(/La usan 3 productos activos: pasarán a Revisar impuestos/),
    ).toBeDefined();
    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(puts(calls)).toEqual([]);
  });

  it("confirmar deshabilita la entrada", async () => {
    const calls = renderScreen(withUsage());
    const fourteen = await row(ivaList(), "14%");
    await within(fourteen).findByText("Usada por 3 productos activos");
    const user = userEvent.setup();
    await user.click(within(fourteen).getByRole("switch", { name: "14%" }));
    const dialog = await screen.findByRole("dialog", { name: "¿Deshabilitar 14%?" });
    await user.click(within(dialog).getByRole("button", { name: "Deshabilitar" }));
    expect(
      await screen.findByText("Deshabilitaste la tarifa de IVA 14% para tu empresa."),
    ).toBeDefined();
    expect(puts(calls).map((c) => c.key)).toEqual([
      "PUT /api/v1/fiscal-catalogs/iva-rate/entries/3/enablement",
    ]);
  });

  it("una entrada sin uso se deshabilita sin confirmación", async () => {
    const calls = renderScreen(withUsage());
    const fifteen = await row(ivaList(), "15%");
    await screen.findByText("2 productos necesitan revisión");
    await userEvent.setup().click(within(fifteen).getByRole("switch", { name: "15%" }));
    expect(
      await screen.findByText("Deshabilitaste la tarifa de IVA 15% para tu empresa."),
    ).toBeDefined();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(puts(calls).map((c) => c.key)).toEqual([
      "PUT /api/v1/fiscal-catalogs/iva-rate/entries/4/enablement",
    ]);
  });
});
