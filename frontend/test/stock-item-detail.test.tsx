// Detalle del inventario (add-minimal-inventory, tarea 10.2, design D13): acciones según el estado y
// el rol, diálogos con su validación, la clave de idempotencia repetida en el reintento, un solo
// envío ante el doble clic, los 409 explicados, el foco tras cada acción, la confirmación para
// desactivar y el rango inválido del kárdex.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionGate } from "@/components/session";
import { StockItemDetailScreen } from "@/features/inventory/stock-item-detail";
import {
  ADMIN_ME,
  OPERATOR_ME,
  errorBody,
  mockApi,
  navigation,
  renderApp,
  type Route,
} from "./harness";

type State =
  "NOT_TRACKED" | "TRACKED_NOT_INITIALIZED" | "TRACKED_INITIALIZED" | "DISABLED_INITIALIZED";

const detail = (
  state: State,
  balance: string | null = state.endsWith("_INITIALIZED") && state !== "TRACKED_NOT_INITIALIZED"
    ? "5"
    : null,
) => ({
  productId: "prod-1",
  mainCode: "CEM-50",
  auxiliaryCode: null,
  name: "Cemento 50 kg",
  productStatus: "ACTIVE",
  state,
  balance,
  negative: balance !== null && balance.startsWith("-"),
  lastMovementAt: balance === null ? null : "2026-10-03T15:15:00.000Z",
  initializedAt: balance === null ? null : "2026-10-01T13:00:00.000Z",
  initializedByName: balance === null ? null : "Ana Admin",
});
const movement = (overrides: Record<string, unknown> = {}) => ({
  id: "mov-1",
  position: 1,
  type: "INICIAL",
  delta: "5",
  balanceAfter: "5",
  occurredAt: "2026-10-01T13:00:00.000Z",
  origin: "USER",
  actorName: "Ana Admin",
  documentId: null,
  documentNumber: null,
  reason: "Conteo de apertura",
  ...overrides,
});
const paged =
  (data: unknown[]): Route =>
  () => ({ status: 200, body: { data, meta: { page: 1, pageSize: 25, total: data.length } } });
const created =
  (overrides: Record<string, unknown>): Route =>
  () => ({
    status: 201,
    body: { data: movement({ id: "mov-2", position: 2, ...overrides }) },
  });

function render(
  routes: Record<string, Route>,
  me: typeof ADMIN_ME | typeof OPERATOR_ME = ADMIN_ME,
) {
  const calls = mockApi({
    "GET /api/v1/me": () => ({ status: 200, body: { data: me } }),
    "GET /api/v1/inventory/items/prod-1/movements": paged([movement()]),
    ...routes,
  });
  renderApp(
    <SessionGate fallback={<p>cargando</p>}>
      <StockItemDetailScreen productId="prod-1" />
    </SessionGate>,
  );
  return calls;
}
const itemRoute =
  (state: State, balance?: string | null): Route =>
  () => ({
    status: 200,
    body: { data: balance === undefined ? detail(state) : detail(state, balance) },
  });
const posts = (calls: { key: string; body: unknown }[], path: string) =>
  calls.filter((call) => call.key === `POST /api/v1/inventory/items/prod-1/${path}`);

beforeEach(() => {
  navigation.pathname = "/inventario/prod-1";
  navigation.search = new URLSearchParams();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("detalle del inventario", () => {
  it("el operador registra entradas, pero no inicializa, ajusta ni configura", async () => {
    render({ "GET /api/v1/inventory/items/prod-1": itemRoute("TRACKED_INITIALIZED") }, OPERATOR_ME);
    expect(await screen.findByRole("button", { name: "Registrar entrada" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Ajustar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Desactivar control" })).toBeNull();
  });

  it("el operador ve por qué no puede inicializar ni reactivar", async () => {
    render(
      { "GET /api/v1/inventory/items/prod-1": itemRoute("TRACKED_NOT_INITIALIZED") },
      OPERATOR_ME,
    );
    expect(
      await screen.findByText(/Un administrador debe inicializar el inventario/),
    ).toBeDefined();
    expect(screen.queryByRole("button", { name: "Inicializar inventario" })).toBeNull();
    expect(screen.getByText("Sin inicializar: todavía no hay saldo.")).toBeDefined();
  });

  it("el administrador inicializa con el saldo contado y el foco va al saldo", async () => {
    let state: State = "TRACKED_NOT_INITIALIZED";
    const calls = render({
      "GET /api/v1/inventory/items/prod-1": () => ({
        status: 200,
        body: { data: detail(state, state === "TRACKED_INITIALIZED" ? "12.5" : null) },
      }),
      "POST /api/v1/inventory/items/prod-1/initialization": () => {
        state = "TRACKED_INITIALIZED";
        return { status: 201, body: { data: detail("TRACKED_INITIALIZED", "12.5") } };
      },
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Inicializar inventario" }));
    const dialog = await screen.findByRole("dialog", { name: "Inicializar inventario" });
    await user.type(within(dialog).getByLabelText("Saldo inicial"), "12.5");
    await user.click(within(dialog).getByRole("button", { name: "Inicializar" }));
    await waitFor(() =>
      expect(posts(calls, "initialization").map((call) => call.body)).toEqual([
        { quantity: "12.5", note: null },
      ]),
    );
    expect(await screen.findByRole("button", { name: "Registrar entrada" })).toBeDefined();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Saldo" })),
    );
  });

  it("el doble clic registra una sola entrada, y el reintento repite la clave", async () => {
    let fail = true;
    const keys: string[] = [];
    const calls = render({
      "GET /api/v1/inventory/items/prod-1": itemRoute("TRACKED_INITIALIZED"),
      "POST /api/v1/inventory/items/prod-1/entries": (init) => {
        keys.push((init.headers as Record<string, string>)["Idempotency-Key"]!);
        if (fail) return { status: 503, body: errorBody("SERVICE_UNAVAILABLE", "x") };
        return created({ type: "ENTRADA_MANUAL", delta: "10", balanceAfter: "15" })(init);
      },
    });
    // La primera respuesta tarda: el segundo clic llega con la entrada todavía pendiente.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const fetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        if (String(input).endsWith("/entries") && fail) await gate;
        return fetch(input, init);
      }),
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Registrar entrada" }));
    const dialog = await screen.findByRole("dialog", { name: "Registrar entrada" });
    await user.type(within(dialog).getByLabelText("Cantidad"), "10");
    await user.dblClick(within(dialog).getByRole("button", { name: "Registrar entrada" }));
    release();
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Registrar entrada" }).hasAttribute("disabled"),
      ).toBe(false),
    );
    expect(posts(calls, "entries")).toHaveLength(1);
    fail = false;
    await user.click(within(dialog).getByRole("button", { name: "Registrar entrada" }));
    expect(await screen.findByText("Registraste la entrada de 10. Saldo: 15.")).toBeDefined();
    expect(posts(calls, "entries")).toHaveLength(2);
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(keys[1]).toBe(keys[0]);
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Saldo" })),
    );
  });

  it("explica los 409 en el diálogo y conserva lo escrito", async () => {
    render({
      "GET /api/v1/inventory/items/prod-1": itemRoute("TRACKED_INITIALIZED"),
      "POST /api/v1/inventory/items/prod-1/entries": () => ({
        status: 409,
        body: errorBody(
          "STOCK_TRACKING_DISABLED",
          "El control de stock de este producto está desactivado: un administrador debe reactivarlo para registrar movimientos.",
        ),
      }),
      "POST /api/v1/inventory/items/prod-1/adjustments": () => ({
        status: 409,
        body: errorBody("IDEMPOTENCY_KEY_REUSED", "Esta clave de idempotencia ya se usó."),
      }),
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Registrar entrada" }));
    let dialog = await screen.findByRole("dialog", { name: "Registrar entrada" });
    await user.type(within(dialog).getByLabelText("Cantidad"), "3");
    await user.click(within(dialog).getByRole("button", { name: "Registrar entrada" }));
    expect((await within(dialog).findByRole("alert")).textContent).toContain(
      "El control de stock de este producto está desactivado",
    );
    expect((within(dialog).getByLabelText("Cantidad") as HTMLInputElement).value).toBe("3");
    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));

    await user.click(screen.getByRole("button", { name: "Ajustar" }));
    dialog = await screen.findByRole("dialog", { name: "Ajustar existencias" });
    await user.type(within(dialog).getByLabelText("Cantidad"), "1");
    await user.type(within(dialog).getByLabelText("Motivo"), "Merma");
    await user.click(within(dialog).getByRole("button", { name: "Registrar ajuste" }));
    expect((await within(dialog).findByRole("alert")).textContent).toContain(
      "Ya registraste un movimiento desde este diálogo con otros datos",
    );
  });

  it("el ajuste exige motivo, y la dirección pone el signo", async () => {
    const calls = render({
      "GET /api/v1/inventory/items/prod-1": itemRoute("TRACKED_INITIALIZED"),
      "POST /api/v1/inventory/items/prod-1/adjustments": created({
        type: "AJUSTE",
        delta: "-4",
        balanceAfter: "1",
        reason: "Merma",
      }),
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Ajustar" }));
    const dialog = await screen.findByRole("dialog", { name: "Ajustar existencias" });
    await user.type(within(dialog).getByLabelText("Cantidad"), "4");
    await user.click(within(dialog).getByRole("button", { name: "Registrar ajuste" }));
    expect(await within(dialog).findByText("El motivo del ajuste es obligatorio.")).toBeDefined();
    expect(document.activeElement).toBe(within(dialog).getByLabelText("Motivo"));
    expect(posts(calls, "adjustments")).toHaveLength(0);
    await user.type(within(dialog).getByLabelText("Motivo"), "Merma");
    await user.click(within(dialog).getByRole("button", { name: "Registrar ajuste" }));
    await waitFor(() =>
      expect(posts(calls, "adjustments").map((call) => call.body)).toEqual([
        { delta: "-4", reason: "Merma" },
      ]),
    );
  });

  it("desactivar pide confirmación y explica que las facturas emitidas aún descuentan", async () => {
    let state: State = "TRACKED_INITIALIZED";
    const calls = render({
      "GET /api/v1/inventory/items/prod-1": () => ({
        status: 200,
        body: { data: detail(state, "0") },
      }),
      "PUT /api/v1/inventory/items/prod-1/tracking": (init) => {
        const { tracked } = JSON.parse(init.body!) as { tracked: boolean };
        state = tracked ? "TRACKED_INITIALIZED" : "DISABLED_INITIALIZED";
        return { status: 200, body: { data: detail(state, "0") } };
      },
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Desactivar control" }));
    const dialog = await screen.findByRole("dialog", { name: "¿Desactivar el control de stock?" });
    expect(
      within(dialog).getByText(/Las facturas ya emitidas con el control activo/),
    ).toBeDefined();
    await user.click(within(dialog).getByRole("button", { name: "Desactivar control" }));
    expect(await screen.findByRole("button", { name: "Activar control" })).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Activar control" }));
    expect(await screen.findByRole("button", { name: "Registrar entrada" })).toBeDefined();
    expect(
      calls
        .filter((call) => call.key === "PUT /api/v1/inventory/items/prod-1/tracking")
        .map((call) => call.body),
    ).toEqual([{ tracked: false }, { tracked: true }]);
  });

  it("con saldo distinto de cero, explica por qué no se puede desactivar", async () => {
    render({ "GET /api/v1/inventory/items/prod-1": itemRoute("TRACKED_INITIALIZED", "-3") });
    const button = await screen.findByRole("button", { name: "Desactivar control" });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(
      document.getElementById(button.getAttribute("aria-describedby")!)?.textContent,
    ).toContain("el saldo debe ser cero");
    expect(screen.getAllByText("Saldo negativo").length).toBeGreaterThan(0);
  });

  it("el kárdex muestra la factura y el sistema, y un rango invertido no consulta", async () => {
    const calls = render({
      "GET /api/v1/inventory/items/prod-1": itemRoute("TRACKED_INITIALIZED"),
      "GET /api/v1/inventory/items/prod-1/movements": paged([
        movement({
          id: "mov-2",
          position: 2,
          type: "SALIDA_FACTURA",
          delta: "-2",
          balanceAfter: "3",
          origin: "SYSTEM",
          actorName: null,
          documentId: "doc-1",
          documentNumber: "001-001-000000007",
          reason: null,
        }),
        movement(),
      ]),
    });
    const table = await screen.findByRole("table", { name: "Movimientos del producto" });
    const link = await within(table).findByRole("link", { name: "Factura 001-001-000000007" });
    expect(link.getAttribute("href")).toBe("/facturas/doc-1");
    expect(within(table).getByText("Salida por factura")).toBeDefined();
    expect(within(table).getByText("Sistema")).toBeDefined();
    expect(within(table).getByText("-2")).toBeDefined();
    const before = calls.length;
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-10-15" } });
    fireEvent.change(screen.getByLabelText("Hasta"), { target: { value: "2026-10-01" } });
    expect((await screen.findAllByText("Revisa el rango de fechas")).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Hasta").getAttribute("aria-invalid")).toBe("true");
    expect(
      calls
        .slice(before)
        .some((call) => call.key.includes("from=2026-10-15") && call.key.includes("to=2026-10-01")),
    ).toBe(false);
  });
});
