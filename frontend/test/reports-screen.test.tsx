// Reportes (add-reports-export, tarea 5.1, design D16): la carga, el vacío, sin coincidencias, el
// error y sin permiso; los filtros en la URL y el atajo mensual; los estados por defecto y el
// ambiente efectivo; la exportación con los filtros de la URL y el ambiente de la lista; y los
// mensajes del 409 y del 503 junto al botón.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionGate } from "@/components/session";
import { ReportsScreen } from "@/features/reports/reports-screen";
import {
  ADMIN_ME,
  OPERATOR_ME,
  errorBody,
  mockApi,
  navigation,
  renderApp,
  type Route,
} from "./harness";

const document = (overrides: Record<string, unknown> = {}) => ({
  id: "doc-1",
  issueDate: "2026-09-30",
  documentType: "01",
  number: "001-001-000000001",
  counterpart: { identification: "0102030405", name: '=HYPERLINK("http://ejemplo.invalid")' },
  recipientCount: null,
  subtotal: "100",
  taxes: "15",
  total: "115",
  state: "AUTHORIZED",
  environment: "TEST",
  ...overrides,
});
const guide = document({
  id: "doc-2",
  documentType: "06",
  number: "001-001-000000002",
  counterpart: null,
  recipientCount: 3,
  subtotal: null,
  taxes: null,
  total: null,
});
const paged =
  (data: unknown[], environment: string | null = "TEST"): Route =>
  () => ({
    status: 200,
    body: { data, meta: { page: 1, pageSize: 25, total: data.length, environment } },
  });

function render(
  routes: Record<string, Route>,
  me: typeof ADMIN_ME | typeof OPERATOR_ME = OPERATOR_ME,
) {
  const calls = mockApi({
    "GET /api/v1/me": () => ({ status: 200, body: { data: me } }),
    "GET /api/v1/establishments": () => ({ status: 200, body: { data: [] } }),
    ...routes,
  });
  renderApp(
    <SessionGate fallback={<p>cargando</p>}>
      <ReportsScreen />
    </SessionGate>,
  );
  return calls;
}

const requested = (calls: { key: string }[], prefix: string) =>
  calls.filter((call) => call.key.startsWith(prefix)).map((call) => call.key);

beforeEach(() => {
  navigation.pathname = "/reportes";
  navigation.search = new URLSearchParams();
  navigation.replace.mockReset();
  vi.stubGlobal(
    "URL",
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:xlsx"), revokeObjectURL: vi.fn() }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Reportes", () => {
  it("lista Documentos emitidos con el número de registros, el ambiente y el aviso", async () => {
    render({ "GET /api/v1/reports/issued-documents": paged([document(), guide]) });
    const table = await screen.findByRole("table", { name: "Documentos emitidos" });
    await within(table).findByText("001-001-000000002");
    expect(screen.getByText(/registros · Ambiente: Pruebas/)).toBeDefined();
    expect(
      screen.getByText("Los reportes no reemplazan obligaciones contables ni anexos tributarios."),
    ).toBeDefined();
    // El texto que parece una fórmula se muestra tal cual; la guía no inventa importes.
    expect(within(table).getByText('=HYPERLINK("http://ejemplo.invalid")')).toBeDefined();
    expect(within(table).getByText("3 destinatarios")).toBeDefined();
    expect(within(table).getAllByText("Sin importe").length).toBe(3);
    expect(within(table).getByText("Guía de remisión")).toBeDefined();
  });

  it("marca la tabla como ocupada mientras carga, sin inventar filas", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => (release = resolve));
    mockApi({
      "GET /api/v1/me": () => ({ status: 200, body: { data: OPERATOR_ME } }),
      "GET /api/v1/establishments": () => ({ status: 200, body: { data: [] } }),
    });
    const fetchMock = vi.mocked(fetch);
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input).startsWith("/api/v1/reports/")) {
        await pending;
        return new Response(
          JSON.stringify({
            data: [],
            meta: { page: 1, pageSize: 25, total: 0, environment: "TEST" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return original(input, init);
    });
    renderApp(
      <SessionGate fallback={<p>cargando</p>}>
        <ReportsScreen />
      </SessionGate>,
    );
    const table = await screen.findByRole("table", { name: "Documentos emitidos" });
    expect(table.closest("[aria-busy]")?.getAttribute("aria-busy")).toBe("true");
    expect(within(table).queryByText("001-001-000000001")).toBeNull();
    release();
    expect((await screen.findAllByText("Todavía no hay registros")).length).toBeGreaterThan(0);
  });

  it("ofrece exactamente los cinco reportes, con las dos vistas del inventario", async () => {
    navigation.search = new URLSearchParams("reporte=inventario");
    render({ "GET /api/v1/reports/inventory-balances": paged([], null) });
    const select = await screen.findByLabelText("Reporte");
    expect(
      within(select)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Documentos emitidos", "Facturas", "Retenciones", "Inventario", "Terceros"]);
    expect(screen.getByRole("radio", { name: "Existencias" })).toBeDefined();
    fireEvent.click(screen.getByRole("radio", { name: "Movimientos" }));
    expect(navigation.replace).toHaveBeenCalledWith(
      "/reportes?reporte=inventario&vista=movimientos",
      {
        scroll: false,
      },
    );
  });

  it("muestra el vacío sin filtros", async () => {
    const empty = render({ "GET /api/v1/reports/issued-documents": paged([]) });
    expect((await screen.findAllByText("Todavía no hay registros")).length).toBeGreaterThan(0);
    expect(requested(empty, "GET /api/v1/reports")).toHaveLength(1);
  });

  it("explica que no hay coincidencias y permite limpiar los filtros", async () => {
    navigation.search = new URLSearchParams("estado=RETURNED");
    render({ "GET /api/v1/reports/issued-documents": paged([]) });
    expect(
      (await screen.findAllByText("No hay registros con estos filtros")).length,
    ).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: "Limpiar filtros" })[0]!);
    expect(navigation.replace).toHaveBeenCalledWith("/reportes", { scroll: false });
  });

  it("ofrece reintentar si falla", async () => {
    render({
      "GET /api/v1/reports/issued-documents": () => ({
        status: 500,
        body: errorBody("INTERNAL_ERROR", "Error"),
      }),
    });
    expect(
      (await screen.findAllByText("No pudimos cargar el reporte.", undefined, { timeout: 5_000 }))
        .length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Intentar de nuevo" }).length).toBeGreaterThan(0);
  });

  it("explica la falta de permiso", async () => {
    render({
      "GET /api/v1/reports/issued-documents": () => ({
        status: 403,
        body: errorBody("FORBIDDEN", "No tienes permiso."),
      }),
    });
    expect(await screen.findByText("No tienes acceso a Reportes")).toBeDefined();
  });

  it("lleva los filtros de la URL a la API y el atajo mensual fija solo el rango", async () => {
    navigation.search = new URLSearchParams(
      "reporte=facturas&cliente=0102030405&estado=NOT_AUTHORIZED&ambiente=todos",
    );
    const calls = render({ "GET /api/v1/reports/invoices": paged([], "ALL") });
    await screen.findAllByText("No hay registros con estos filtros");
    expect(requested(calls, "GET /api/v1/reports/invoices")[0]).toBe(
      "GET /api/v1/reports/invoices?customerIdentification=0102030405&state=NOT_AUTHORIZED&environment=ALL&page=1&pageSize=25",
    );
    const month = screen.getByLabelText("Mes");
    const option = within(month).getAllByRole("option")[2]!;
    fireEvent.change(month, { target: { value: (option as HTMLOptionElement).value } });
    const [, args] = [null, navigation.replace.mock.calls.at(-1)];
    const query = new URLSearchParams(String(args?.[0]).split("?")[1]);
    const value = (option as HTMLOptionElement).value;
    expect(query.get("desde")).toBe(`${value}-01`);
    expect(query.get("hasta")?.startsWith(value)).toBe(true);
    expect(query.get("cliente")).toBe("0102030405");
  });

  it("muestra los estados por defecto: todos en Documentos emitidos, autorizados en Facturas", async () => {
    const issued = render({ "GET /api/v1/reports/issued-documents": paged([document()]) });
    await screen.findByRole("table", { name: "Documentos emitidos" });
    expect((screen.getByLabelText("Estado") as HTMLSelectElement).value).toBe("ALL");
    // Sin elegir, el estado no viaja: lo aplica el servidor.
    expect(requested(issued, "GET /api/v1/reports/issued-documents")[0]).toBe(
      "GET /api/v1/reports/issued-documents?page=1&pageSize=25",
    );
  });

  it("Facturas y Retenciones parten de las autorizadas", async () => {
    navigation.search = new URLSearchParams("reporte=retenciones");
    render({ "GET /api/v1/reports/withholdings": paged([]) });
    await screen.findAllByText("Todavía no hay registros");
    expect((screen.getByLabelText("Estado") as HTMLSelectElement).value).toBe("AUTHORIZED");
  });

  it("exporta con los filtros de la URL y el ambiente efectivo de la lista", async () => {
    navigation.search = new URLSearchParams("reporte=facturas&desde=2026-09-01&hasta=2026-09-30");
    const calls = render({
      "GET /api/v1/reports/invoices": paged([], "PRODUCTION"),
      "GET /api/v1/reports/invoices/export": () => ({ status: 200, body: "xlsx" }),
    });
    await screen.findByText(/Ambiente: Producción/);
    await userEvent.click(screen.getByRole("button", { name: "Exportar XLSX" }));
    await waitFor(() =>
      expect(requested(calls, "GET /api/v1/reports/invoices/export")).toEqual([
        "GET /api/v1/reports/invoices/export?from=2026-09-01&to=2026-09-30&environment=PRODUCTION",
      ]),
    );
    expect(await screen.findByText("Descargaste el XLSX.")).toBeDefined();
  });

  it("explica el máximo de filas y la concurrencia junto al botón", async () => {
    let status = 409;
    render({
      "GET /api/v1/reports/issued-documents": paged([document()]),
      "GET /api/v1/reports/issued-documents/export": () =>
        status === 409
          ? {
              status: 409,
              body: errorBody(
                "REPORT_EXPORT_ROW_LIMIT",
                "El reporte tiene 120000 filas y una exportación admite como máximo 100000. Acota los filtros, por ejemplo el rango de fechas.",
              ),
            }
          : { status: 503, body: errorBody("REPORT_EXPORT_BUSY", "Ocupado") },
    });
    await screen.findByRole("table", { name: "Documentos emitidos" });
    await userEvent.click(screen.getByRole("button", { name: "Exportar XLSX" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Acota los filtros");
    status = 503;
    await userEvent.click(screen.getByRole("button", { name: "Exportar XLSX" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Intenta de nuevo en unos segundos"),
    );
  });
});
