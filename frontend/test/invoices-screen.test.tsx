// Facturas y su detalle (add-invoice-emission, tarea 10.3, design D15): lista con estado, búsqueda y
// paginación; detalle desde el snapshot con el diagnóstico; "Reintentar firma" solo con RESERVED y
// permiso; carga, vacío, error, sin permiso y no encontrada.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionGate } from "@/components/session";
import { InvoiceDetailScreen } from "@/features/invoices/invoice-detail";
import { InvoicesScreen } from "@/features/invoices/invoices-screen";
import {
  ADMIN_ME,
  OPERATOR_ME,
  errorBody,
  mockApi,
  navigation,
  renderApp,
  type Route,
} from "./harness";

const summary = (overrides: Record<string, unknown> = {}) => ({
  id: "inv-1",
  documentNumber: "001-001-000000001",
  environment: "TEST",
  issueDate: "2026-10-03",
  buyerIdentification: "0992877878001",
  buyerName: "EL PERNO CIA. LTDA.",
  total: "28.75",
  state: "SIGNED",
  diagnosticCode: null,
  transmissionStopped: false,
  createdAt: "2026-10-03T15:00:00.000Z",
  ...overrides,
});
const TOTALS = {
  withoutTaxes: "25.00",
  discount: "1.25",
  taxes: [{ taxCode: "2", rateCode: "4", percentage: "15", base: "25.00", amount: "3.75" }],
  total: "28.75",
};
const detail = (overrides: Record<string, unknown> = {}) => ({
  id: "inv-1",
  documentType: "01",
  environment: "TEST",
  documentNumber: "001-001-000000001",
  accessKey: "0310202601179001234500110010010000000011234567816",
  issueDate: "2026-10-03",
  state: "SIGNED",
  issuer: {
    ruc: "1790012345001",
    legalName: "COMERCIAL ANDINA S.A.",
    tradeName: null,
    headOfficeAddress: "Quito",
    establishmentAddress: "Quito",
    accountingRequired: true,
    specialTaxpayerNumber: null,
    withholdingAgentResolution: null,
    rimpeCategory: null,
  },
  buyer: {
    identificationType: "04",
    identification: "0992877878001",
    legalName: "EL PERNO CIA. LTDA.",
    address: "Guayaquil",
    consumerFinal: false,
  },
  lines: [
    {
      position: 1,
      mainCode: "CEM-50",
      auxiliaryCode: null,
      description: "Cemento 50 kg",
      quantity: "3",
      unitPrice: "8.75",
      discount: "1.25",
      taxableBase: "25.00",
      taxes: TOTALS.taxes,
    },
  ],
  payments: [{ code: "01", amount: "28.75" }],
  totals: TOTALS,
  diagnostic: null,
  artifact: { sha256: "a".repeat(64), sizeBytes: 4096 },
  authorizedArtifact: null,
  transmission: {
    inProgress: true,
    stopped: null,
    reconcilable: false,
    authorization: null,
    lastResult: null,
  },
  createdAt: "2026-10-03T15:00:00.000Z",
  signedAt: "2026-10-03T15:00:01.000Z",
  ...overrides,
});
const RESERVED = detail({
  state: "RESERVED",
  artifact: null,
  signedAt: null,
  diagnostic: {
    stage: "SIGN",
    code: "CRYPTO_BUSY",
    class: "RETRYABLE_OPERATIONAL",
    message: "El servicio de firma está saturado. Reintenta en unos segundos.",
    at: "2026-10-03T15:00:02.000Z",
    attemptCount: 1,
  },
});
const paged =
  (data: unknown[], total = data.length): Route =>
  () => ({ status: 200, body: { data, meta: { page: 1, pageSize: 25, total } } });
const ok =
  (data: unknown): Route =>
  () => ({ status: 200, body: { data } });

function render(
  ui: React.ReactNode,
  routes: Record<string, Route>,
  me: typeof ADMIN_ME | typeof OPERATOR_ME = ADMIN_ME,
) {
  const calls = mockApi({
    "GET /api/v1/me": () => ({ status: 200, body: { data: me } }),
    "GET /api/v1/fiscal-catalogs/payment-method/entries": () => ({
      status: 500,
      body: errorBody("INTERNAL_ERROR", "Error"),
    }),
    ...routes,
  });
  renderApp(<SessionGate fallback={<p>cargando</p>}>{ui}</SessionGate>);
  return calls;
}

beforeEach(() => {
  navigation.pathname = "/facturas";
  navigation.search = new URLSearchParams();
  navigation.replace.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pantalla Facturas", () => {
  it("lista número, comprador, total, fecha y estado con icono y texto", async () => {
    render(<InvoicesScreen />, {
      "GET /api/v1/invoices": paged([
        summary({
          id: "inv-2",
          documentNumber: "001-001-000000002",
          state: "RESERVED",
          diagnosticCode: "CRYPTO_BUSY",
        }),
        summary(),
      ]),
    });
    const table = await screen.findByRole("table", { name: "Facturas emitidas" });
    await within(table).findByText("001-001-000000002");
    // El estado y la fecha tienen dos copias por fila (distribución amplia y compacta, D15).
    const rows = within(table).getAllByRole("row");
    const reserved = rows.find(
      (row) => within(row).queryAllByText("001-001-000000002").length > 0,
    )!;
    expect(within(reserved).getAllByText("Procesando").length).toBeGreaterThan(0);
    expect(within(reserved).getByText("$28,75")).toBeDefined();
    expect(within(reserved).getAllByText("03/10/2026").length).toBeGreaterThan(0);
    const signed = rows.find((row) => within(row).queryAllByText("001-001-000000001").length > 0)!;
    expect(within(signed).getAllByText("Pendiente de envío").length).toBeGreaterThan(0);
    expect(
      within(signed).getByRole("link", { name: "001-001-000000001" }).getAttribute("href"),
    ).toBe("/facturas/inv-1");
  });

  it("filtra por estado desde la URL y busca por número, comprador o identificación", async () => {
    // La búsqueda declara también la identificación, que el servidor ya buscaba (D8).
    navigation.search = new URLSearchParams("estado=procesando");
    const calls = render(<InvoicesScreen />, { "GET /api/v1/invoices": paged([]) });
    await screen.findAllByText("No hay facturas con estos filtros");
    expect(calls.some((call) => call.key.includes("state=RESERVED"))).toBe(true);
    await userEvent
      .setup()
      .type(
        screen.getByRole("searchbox", { name: "Buscar por número, comprador o identificación" }),
        "000000012",
      );
    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith(
        expect.stringContaining("q=000000012"),
        expect.anything(),
      ),
    );
  });

  it("muestra el vacío, el error con reintento y la falta de permiso", async () => {
    let fail = true;
    render(<InvoicesScreen />, {
      "GET /api/v1/invoices": () =>
        fail
          ? { status: 500, body: errorBody("INTERNAL_ERROR", "Error") }
          : { status: 200, body: { data: [], meta: { page: 1, pageSize: 25, total: 0 } } },
    });
    expect(
      (await screen.findAllByText("No pudimos cargar las facturas.", undefined, { timeout: 5_000 }))
        .length,
    ).toBeGreaterThan(0);
    fail = false;
    await userEvent.setup().click(screen.getAllByRole("button", { name: "Intentar de nuevo" })[0]!);
    expect((await screen.findAllByText("Todavía no hay facturas")).length).toBeGreaterThan(0);
  }, 10_000);

  it("sin permiso en el servidor, muestra el aviso de acceso", async () => {
    render(<InvoicesScreen />, {
      "GET /api/v1/invoices": () => ({ status: 403, body: errorBody("FORBIDDEN", "No.") }),
    });
    expect(await screen.findByText("No tienes acceso a Facturas")).toBeDefined();
  });
});

describe("detalle de una factura", () => {
  it("una factura firmada muestra número, clave, totales y estado, sin diagnóstico ni reintento", async () => {
    render(<InvoiceDetailScreen invoiceId="inv-1" />, {
      "GET /api/v1/invoices/inv-1": ok(detail()),
    });
    expect(
      await screen.findByRole("heading", { level: 1, name: "Factura 001-001-000000001" }),
    ).toBeDefined();
    expect(screen.getByText("Pendiente de envío")).toBeDefined();
    expect(screen.getByText("0310202601179001234500110010010000000011234567816")).toBeDefined();
    const totals = screen.getByRole("complementary", { name: "Totales" });
    expect(within(totals).getByText("USD 28,75")).toBeDefined();
    expect(within(totals).getByText("IVA 15 %")).toBeDefined();
    expect(screen.getByText("Cemento 50 kg")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Reintentar firma" })).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("una factura reservada muestra la etapa, el motivo y si es reintentable, y el operador reintenta", async () => {
    let signed = false;
    const calls = render(
      <InvoiceDetailScreen invoiceId="inv-1" />,
      {
        "GET /api/v1/invoices/inv-1": () => ok(signed ? detail() : RESERVED)({}),
        "POST /api/v1/invoices/inv-1/signing-attempts": () => {
          signed = true;
          return { status: 200, body: { data: detail() } };
        },
      },
      OPERATOR_ME,
    );
    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("No se completó la firma: Firma.");
    expect(status.textContent).toContain("El servicio de firma está saturado");
    expect(status.textContent).toContain("Puedes reintentar ahora.");
    expect(status.textContent).toContain("Intentos: 1 · último intento:");
    await userEvent.setup().click(screen.getByRole("button", { name: "Reintentar firma" }));
    expect(await screen.findByText("Firmaste la factura 001-001-000000001.")).toBeDefined();
    expect(calls.some((call) => call.key === "POST /api/v1/invoices/inv-1/signing-attempts")).toBe(
      true,
    );
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Reintentar firma" })).toBeNull(),
    );
  });

  it("si el reintento no completa la firma, lo avisa con el motivo", async () => {
    render(<InvoiceDetailScreen invoiceId="inv-1" />, {
      "GET /api/v1/invoices/inv-1": ok(RESERVED),
      "POST /api/v1/invoices/inv-1/signing-attempts": ok(RESERVED),
    });
    await userEvent.setup().click(await screen.findByRole("button", { name: "Reintentar firma" }));
    expect(
      await screen.findByText(
        "La factura 001-001-000000001 quedó procesando: El servicio de firma está saturado. Reintenta en unos segundos.",
      ),
    ).toBeDefined();
  });

  it("una factura que no existe en la empresa", async () => {
    render(<InvoiceDetailScreen invoiceId="otra" />, {
      "GET /api/v1/invoices/otra": () => ({
        status: 404,
        body: errorBody("INVOICE_NOT_FOUND", "La factura no existe."),
      }),
    });
    expect(
      await screen.findByText("La factura no existe", undefined, { timeout: 5_000 }),
    ).toBeDefined();
  }, 10_000);
});
