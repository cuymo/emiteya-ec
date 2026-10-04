// Comprobantes, la bandeja documental (add-document-archive, tarea 10.2, design D13): carga, vacío,
// sin coincidencias, error, sin permiso, filtros en la URL, rango inválido y descarga del RIDE.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionGate } from "@/components/session";
import { DocumentsScreen } from "@/features/archive/documents-screen";
import {
  ADMIN_ME,
  OPERATOR_ME,
  errorBody,
  mockApi,
  navigation,
  renderApp,
  type Route,
} from "./harness";

const item = (overrides: Record<string, unknown> = {}) => ({
  id: "doc-1",
  documentType: "01",
  number: "001-001-000000001",
  issueDate: "2026-10-04",
  buyer: { name: "EL PERNO CIA. LTDA.", identification: "0992877878001" },
  total: "28.75",
  state: "AUTHORIZED",
  transmissionStopped: false,
  documents: { ride: "AVAILABLE", authorizedXml: true, signedXml: true },
  ...overrides,
});
const paged =
  (data: unknown[]): Route =>
  () => ({ status: 200, body: { data, meta: { page: 1, pageSize: 25, total: data.length } } });
const ESTABLISHMENTS = [
  {
    id: "est-1",
    code: "001",
    address: "Quito",
    status: "ACTIVE",
    emissionPoints: [{ id: "pto-1", code: "001", status: "ACTIVE", available: true }],
  },
];

function render(
  routes: Record<string, Route>,
  me: typeof ADMIN_ME | typeof OPERATOR_ME = OPERATOR_ME,
) {
  const calls = mockApi({
    "GET /api/v1/me": () => ({ status: 200, body: { data: me } }),
    "GET /api/v1/establishments": () => ({ status: 200, body: { data: ESTABLISHMENTS } }),
    ...routes,
  });
  renderApp(
    <SessionGate fallback={<p>cargando</p>}>
      <DocumentsScreen />
    </SessionGate>,
  );
  return calls;
}

beforeEach(() => {
  navigation.pathname = "/comprobantes";
  navigation.search = new URLSearchParams();
  navigation.replace.mockReset();
  vi.stubGlobal(
    "URL",
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:ride"), revokeObjectURL: vi.fn() }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Comprobantes", () => {
  it("lista los comprobantes con su estado y el RIDE disponible, en preparación o detenido", async () => {
    render({
      "GET /api/v1/documents": paged([
        item(),
        item({
          id: "doc-2",
          number: "001-001-000000002",
          documents: { ride: "PENDING", authorizedXml: false, signedXml: true },
        }),
        item({
          id: "doc-3",
          number: "001-001-000000003",
          documents: { ride: "STOPPED", authorizedXml: false, signedXml: true },
        }),
        item({
          id: "doc-4",
          number: "001-001-000000004",
          state: "SIGNED",
          documents: { ride: "NOT_APPLICABLE", authorizedXml: false, signedXml: true },
        }),
      ]),
    });
    const table = await screen.findByRole("table", { name: "Comprobantes emitidos" });
    await within(table).findByText("001-001-000000001");
    const row = (number: string) =>
      within(table)
        .getAllByRole("row")
        .find((candidate) => within(candidate).queryByText(number))!;
    expect(
      within(row("001-001-000000001")).getByRole("button", {
        name: "Descargar el RIDE de 001-001-000000001",
      }),
    ).toBeDefined();
    expect(within(row("001-001-000000001")).getByText("Autorizado")).toBeDefined();
    expect(within(row("001-001-000000002")).getByText("En preparación")).toBeDefined();
    expect(within(row("001-001-000000003")).getByText("Detenido")).toBeDefined();
    expect(within(row("001-001-000000004")).queryByRole("button")).toBeNull();
    expect(within(row("001-001-000000001")).getByRole("link").getAttribute("href")).toBe(
      "/facturas/doc-1",
    );
    // Con un solo tipo de comprobante, el filtro de tipo no se muestra.
    expect(screen.queryByLabelText("Tipo de comprobante")).toBeNull();
  });

  it("muestra la carga, la bandeja vacía y el error con reintento", async () => {
    let fail = true;
    render({
      "GET /api/v1/documents": () =>
        fail ? { status: 500, body: errorBody("INTERNAL_ERROR", "x") } : paged([])({}),
    });
    expect(
      (
        await screen.findAllByText("No pudimos cargar los comprobantes.", undefined, {
          timeout: 5_000,
        })
      ).length,
    ).toBeGreaterThan(0);
    fail = false;
    await userEvent.setup().click(screen.getAllByRole("button", { name: "Intentar de nuevo" })[0]!);
    expect((await screen.findAllByText("Todavía no hay comprobantes")).length).toBeGreaterThan(0);
  });

  it("sin permiso explica el acceso", async () => {
    render({ "GET /api/v1/documents": () => ({ status: 403, body: errorBody("FORBIDDEN", "x") }) });
    expect(await screen.findByText("No tienes acceso a Comprobantes")).toBeDefined();
  });

  it("los filtros viven en la URL y llegan a la API", async () => {
    navigation.search = new URLSearchParams(
      "estado=autorizados&desde=2026-10-01&hasta=2026-10-15&identificacion=0992877878001&establecimiento=est-1&punto=pto-1&q=perno",
    );
    const calls = render({ "GET /api/v1/documents": paged([]) });
    expect(
      (await screen.findAllByText("No hay comprobantes que coincidan")).length,
    ).toBeGreaterThan(0);
    const call = calls.find((entry) => entry.key.startsWith("GET /api/v1/documents?"))!;
    const query = new URLSearchParams(call.key.split("?")[1]);
    expect(Object.fromEntries(query)).toMatchObject({
      state: "AUTHORIZED",
      from: "2026-10-01",
      to: "2026-10-15",
      identification: "0992877878001",
      establishmentId: "est-1",
      emissionPointId: "pto-1",
      search: "perno",
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("radio", { name: "Devueltos" }));
    expect(navigation.replace).toHaveBeenLastCalledWith(
      expect.stringContaining("estado=devueltos"),
      { scroll: false },
    );
    await user.click(screen.getAllByRole("button", { name: "Limpiar filtros" })[0]!);
    expect(navigation.replace).toHaveBeenLastCalledWith("/comprobantes", { scroll: false });
  });

  it("un rango invertido se explica en el campo y no consulta", async () => {
    navigation.search = new URLSearchParams("desde=2026-10-15&hasta=2026-10-01");
    const calls = render({ "GET /api/v1/documents": paged([item()]) });
    expect((await screen.findAllByText("Revisa el rango de fechas")).length).toBeGreaterThan(0);
    const hasta = screen.getByLabelText("Hasta");
    expect(hasta.getAttribute("aria-invalid")).toBe("true");
    expect(calls.some((entry) => entry.key.startsWith("GET /api/v1/documents"))).toBe(false);
  });

  it("dos fechas seguidas se acumulan aunque la primera todavía no esté en la URL", async () => {
    render({ "GET /api/v1/documents": paged([item()]) });
    await screen.findAllByText("001-001-000000001");
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-12-31" } });
    fireEvent.change(screen.getByLabelText("Hasta"), { target: { value: "2026-01-01" } });
    const query = new URLSearchParams(navigation.replace.mock.lastCall![0].split("?")[1]);
    expect(Object.fromEntries(query)).toEqual({ desde: "2026-12-31", hasta: "2026-01-01" });
  });

  it("descarga el RIDE desde la fila con su aviso", async () => {
    const calls = render({
      "GET /api/v1/documents": paged([item()]),
      "GET /api/v1/documents/doc-1/ride": () => ({ status: 200, body: "%PDF" }),
    });
    const table = await screen.findByRole("table", { name: "Comprobantes emitidos" });
    const button = await within(table).findByRole("button", {
      name: "Descargar el RIDE de 001-001-000000001",
    });
    await userEvent.setup().click(button);
    expect(await screen.findByText("Descargaste el RIDE.")).toBeDefined();
    await waitFor(() =>
      expect(calls.some((entry) => entry.key === "GET /api/v1/documents/doc-1/ride")).toBe(true),
    );
  });
});
