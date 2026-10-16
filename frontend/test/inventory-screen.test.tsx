// Inventario (add-minimal-inventory, tarea 10.1, design D13): carga, vacío, error con reintento, sin
// permiso, los cuatro estados (sin cifra antes de inicializar y el negativo con icono y texto) y los
// filtros en la URL.
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionGate } from "@/components/session";
import { InventoryScreen } from "@/features/inventory/inventory-screen";
import { OPERATOR_ME, errorBody, mockApi, navigation, renderApp, type Route } from "./harness";
import { chooseFilter } from "./filters";

const item = (overrides: Record<string, unknown> = {}) => ({
  productId: "prod-1",
  mainCode: "CEM-50",
  auxiliaryCode: null,
  name: "Cemento 50 kg",
  productStatus: "ACTIVE",
  state: "TRACKED_INITIALIZED",
  balance: "8",
  negative: false,
  lastMovementAt: "2026-10-03T15:15:00.000Z",
  ...overrides,
});
const paged =
  (data: unknown[]): Route =>
  () => ({ status: 200, body: { data, meta: { page: 1, pageSize: 25, total: data.length } } });

function render(routes: Record<string, Route>) {
  const calls = mockApi({
    "GET /api/v1/me": () => ({ status: 200, body: { data: OPERATOR_ME } }),
    ...routes,
  });
  renderApp(
    <SessionGate fallback={<p>cargando</p>}>
      <InventoryScreen />
    </SessionGate>,
  );
  return calls;
}

beforeEach(() => {
  navigation.pathname = "/inventario";
  navigation.search = new URLSearchParams();
  navigation.replace.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Inventario", () => {
  it("muestra los cuatro estados: sin cifra antes de inicializar y el negativo con icono y texto", async () => {
    render({
      "GET /api/v1/inventory/items": paged([
        item({
          productId: "prod-1",
          name: "Arena fina",
          state: "TRACKED_NOT_INITIALIZED",
          balance: null,
          lastMovementAt: null,
        }),
        item({ productId: "prod-2", name: "Cemento 50 kg" }),
        item({ productId: "prod-3", name: "Clavos", balance: "-1", negative: true }),
        item({ productId: "prod-4", name: "Pintura", state: "DISABLED_INITIALIZED", balance: "0" }),
      ]),
    });
    const table = await screen.findByRole("table", { name: "Productos con control de stock" });
    await within(table).findByText("Arena fina");
    const row = (name: string) =>
      within(table)
        .getAllByRole("row")
        .find((candidate) => within(candidate).queryByText(name))!;
    expect(within(row("Arena fina")).getByText("Sin inicializar")).toBeDefined();
    expect(within(row("Arena fina")).getByText("Sin saldo")).toBeDefined();
    expect(within(row("Arena fina")).queryByText("0")).toBeNull();
    expect(within(row("Cemento 50 kg")).getByText("Activo")).toBeDefined();
    expect(within(row("Cemento 50 kg")).getByText("8")).toBeDefined();
    expect(within(row("Clavos")).getByText("Saldo negativo")).toBeDefined();
    expect(within(row("Clavos")).getByText("-1")).toBeDefined();
    expect(within(row("Pintura")).getByText("Control desactivado")).toBeDefined();
    expect(within(row("Clavos")).getByRole("link").getAttribute("href")).toBe("/inventario/prod-3");
  });

  it("muestra la carga mientras llega la lista", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    render({ "GET /api/v1/inventory/items": paged([item()]) });
    const fetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        if (String(input).startsWith("/api/v1/inventory/items?")) await gate;
        return fetch(input, init);
      }),
    );
    const table = await screen.findByRole("table", { name: "Productos con control de stock" });
    expect(table.closest("[aria-busy]")?.getAttribute("aria-busy")).toBe("true");
    release();
  });

  it("muestra el vacío con el camino a Productos y el error con reintento", async () => {
    let fail = true;
    render({
      "GET /api/v1/inventory/items": () =>
        fail ? { status: 500, body: errorBody("INTERNAL_ERROR", "x") } : paged([])({}),
    });
    expect(
      (
        await screen.findAllByText("No pudimos cargar el inventario.", undefined, {
          timeout: 5_000,
        })
      ).length,
    ).toBeGreaterThan(0);
    fail = false;
    await userEvent.setup().click(screen.getAllByRole("button", { name: "Intentar de nuevo" })[0]!);
    expect(
      (await screen.findAllByText("Todavía no hay productos con control de stock")).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Ir a Productos" })[0]!.getAttribute("href")).toBe(
      "/productos",
    );
  });

  it("sin permiso explica el acceso", async () => {
    render({
      "GET /api/v1/inventory/items": () => ({ status: 403, body: errorBody("FORBIDDEN", "x") }),
    });
    expect(await screen.findByText("No tienes acceso a Inventario")).toBeDefined();
  });

  it("los filtros viven en la URL y llegan a la API", async () => {
    navigation.search = new URLSearchParams("estado=negativos&q=cem&pagina=2");
    const calls = render({ "GET /api/v1/inventory/items": paged([]) });
    expect((await screen.findAllByText("No hay productos que coincidan")).length).toBeGreaterThan(
      0,
    );
    const call = calls.find((entry) => entry.key.startsWith("GET /api/v1/inventory/items?"))!;
    expect(Object.fromEntries(new URLSearchParams(call.key.split("?")[1]))).toEqual({
      state: "NEGATIVE",
      search: "cem",
      page: "2",
      pageSize: "25",
    });
    const user = userEvent.setup();
    await chooseFilter("Estado", "Sin inicializar");
    expect(navigation.replace).toHaveBeenLastCalledWith(
      "/inventario?estado=sin-inicializar&q=cem",
      { scroll: false },
    );
    await user.click(screen.getAllByRole("button", { name: "Limpiar filtros" })[0]!);
    expect(navigation.replace).toHaveBeenLastCalledWith("/inventario", { scroll: false });
  });
});
