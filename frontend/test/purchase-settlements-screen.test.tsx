// Liquidaciones de compra (add-purchase-settlements, tarea 12.1, design D24): lista con número,
// proveedor, fecha, importe total y estado; carga, vacío, error con reintento, sin permiso, búsqueda
// y filtro de estado en la URL, y los borradores en curso con su eliminación.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { SessionGate } from "@/components/session";
import { PurchaseSettlementsScreen } from "@/features/purchase-settlements/purchase-settlements-screen";
import {
  ADMIN_ME,
  OPERATOR_ME,
  errorBody,
  mockApi,
  navigation,
  renderApp,
  type Route,
} from "./harness";
import { settlementSummary } from "./purchase-settlement-fixtures";

// La política vigente da los permisos de la liquidación a los dos roles: se retiran para probarlos.
const permissions = vi.hoisted(() => ({ deny: new Set<string>() }));
vi.mock("@/lib/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/permissions")>();
  return {
    ...actual,
    canSee: (...args: Parameters<typeof actual.canSee>) =>
      !permissions.deny.has(args[1]) && actual.canSee(...args),
  };
});

const paged =
  (data: unknown[]): Route =>
  () => ({ status: 200, body: { data, meta: { page: 1, pageSize: 25, total: data.length } } });
const DRAFT_SUMMARY = {
  id: "lcd-1",
  version: 3,
  supplierName: "María Quishpe",
  lineCount: 2,
  previewTotal: "106.00",
  updatedAt: "2026-10-07T14:30:00.000Z",
};

function render(
  ui: ReactNode,
  routes: Record<string, Route>,
  me: typeof ADMIN_ME | typeof OPERATOR_ME = OPERATOR_ME,
) {
  const calls = mockApi({
    "GET /api/v1/me": () => ({ status: 200, body: { data: me } }),
    "GET /api/v1/purchase-settlements/drafts": paged([]),
    ...routes,
  });
  renderApp(<SessionGate fallback={<p>cargando</p>}>{ui}</SessionGate>);
  return calls;
}

beforeEach(() => {
  permissions.deny.clear();
  navigation.pathname = "/liquidaciones-compra";
  navigation.search = new URLSearchParams();
  navigation.replace.mockReset();
  navigation.push.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pantalla Liquidaciones de compra", () => {
  it("lista número, proveedor, fecha, importe total y estado, con enlace al detalle", async () => {
    render(<PurchaseSettlementsScreen />, {
      "GET /api/v1/purchase-settlements": paged([
        settlementSummary(),
        settlementSummary({
          id: "lc-2",
          documentNumber: "001-001-000000004",
          supplierIdentification: "AB1234567",
          supplierName: "Juan Pérez",
          total: "12.50",
          state: "MANUAL_REVIEW",
        }),
      ]),
    });
    const table = await screen.findByRole("table", { name: "Liquidaciones de compra emitidas" });
    const row = (number: string) =>
      within(table)
        .getAllByRole("row")
        .find((candidate) => within(candidate).queryByText(number))!;
    await within(table).findByText("001-001-000000003");
    const first = row("001-001-000000003");
    expect(within(first).getByRole("link").getAttribute("href")).toBe("/liquidaciones-compra/lc-1");
    expect(within(first).getByText("María Quishpe")).toBeDefined();
    expect(within(first).getByText("0102030405")).toBeDefined();
    expect(within(first).getByText("07/10/2026")).toBeDefined();
    expect(within(first).getByText("USD 106,00")).toBeDefined();
    expect(within(first).getByText("Autorizado")).toBeDefined();
    expect(within(row("001-001-000000004")).getByText("Juan Pérez")).toBeDefined();
    expect(within(row("001-001-000000004")).getByText("Requiere revisión")).toBeDefined();
    expect(
      screen.getByRole("link", { name: "Nueva liquidación de compra" }).getAttribute("href"),
    ).toBe("/liquidaciones-compra/borradores/nueva");
  });

  it("muestra la carga mientras llegan las liquidaciones", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    render(<PurchaseSettlementsScreen />, {
      "GET /api/v1/purchase-settlements": paged([settlementSummary()]),
    });
    const fetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        if (input.startsWith("/api/v1/purchase-settlements?")) await gate;
        return fetch(input, init);
      }),
    );
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).not.toBeNull());
    release();
    expect(
      await screen.findByRole("table", { name: "Liquidaciones de compra emitidas" }),
    ).toBeDefined();
  });

  it("vacía explica cuándo se emite y ofrece crear la primera; el error se reintenta", async () => {
    let fail = true;
    render(<PurchaseSettlementsScreen />, {
      "GET /api/v1/purchase-settlements": () =>
        fail ? { status: 500, body: errorBody("INTERNAL_ERROR", "x") } : paged([])({}),
    });
    expect(
      (
        await screen.findAllByText("No pudimos cargar las liquidaciones de compra.", undefined, {
          timeout: 5_000,
        })
      ).length,
    ).toBeGreaterThan(0);
    fail = false;
    await userEvent.setup().click(screen.getAllByRole("button", { name: "Intentar de nuevo" })[0]!);
    expect(
      (await screen.findAllByText("Todavía no hay liquidaciones de compra")).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(/art\. 13, letra c/).length).toBeGreaterThan(0);
  });

  it("sin permiso explica el acceso", async () => {
    render(<PurchaseSettlementsScreen />, {
      "GET /api/v1/purchase-settlements": () => ({
        status: 403,
        body: errorBody("FORBIDDEN", "x"),
      }),
    });
    expect(await screen.findByText("No tienes acceso a Liquidaciones de compra")).toBeDefined();
  });

  it("la búsqueda y el estado viven en la URL y llegan a la API", async () => {
    navigation.search = new URLSearchParams("q=pérez&estado=revision");
    const calls = render(<PurchaseSettlementsScreen />, {
      "GET /api/v1/purchase-settlements": paged([]),
    });
    expect(
      (await screen.findAllByText("No hay liquidaciones que coincidan")).length,
    ).toBeGreaterThan(0);
    const call = calls.find((entry) => entry.key.startsWith("GET /api/v1/purchase-settlements?"))!;
    expect(Object.fromEntries(new URLSearchParams(call.key.split("?")[1]))).toMatchObject({
      search: "pérez",
      state: "MANUAL_REVIEW",
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("radio", { name: "Devueltas" }));
    expect(navigation.replace).toHaveBeenLastCalledWith(
      expect.stringContaining("estado=devueltas"),
      { scroll: false },
    );
    await user.click(screen.getAllByRole("button", { name: "Limpiar filtros" })[0]!);
    expect(navigation.replace).toHaveBeenLastCalledWith("/liquidaciones-compra", {
      scroll: false,
    });
  });

  it("muestra los borradores en curso con su enlace y los elimina con confirmación", async () => {
    let drafts = [DRAFT_SUMMARY];
    const calls = render(<PurchaseSettlementsScreen />, {
      "GET /api/v1/purchase-settlements": paged([]),
      "GET /api/v1/purchase-settlements/drafts": () => paged(drafts)({}),
      "DELETE /api/v1/purchase-settlements/drafts/lcd-1": () => {
        drafts = [];
        return { status: 204 };
      },
    });
    const panel = await screen.findByRole("region", { name: "Borradores en curso" });
    expect(within(panel).getByRole("link", { name: "Liquidación a María Quishpe" })).toHaveProperty(
      "href",
      expect.stringContaining("/liquidaciones-compra/borradores/lcd-1"),
    );
    expect(within(panel).getByText(/2 líneas · USD 106,00/)).toBeDefined();
    const user = userEvent.setup();
    await user.click(
      within(panel).getByRole("button", {
        name: "Eliminar el borrador: Liquidación a María Quishpe",
      }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Eliminar borrador" });
    await user.click(within(dialog).getByRole("button", { name: "Eliminar" }));
    expect(await screen.findByText("Eliminaste el borrador.")).toBeDefined();
    expect(
      calls.some((call) => call.key === "DELETE /api/v1/purchase-settlements/drafts/lcd-1"),
    ).toBe(true);
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Borradores en curso" })).toBeNull(),
    );
  });

  it("sin purchaseSettlements.draft no ofrece crear ni muestra los borradores", async () => {
    permissions.deny.add("purchaseSettlements.draft");
    const calls = render(<PurchaseSettlementsScreen />, {
      "GET /api/v1/purchase-settlements": paged([settlementSummary()]),
    });
    await screen.findByRole("table", { name: "Liquidaciones de compra emitidas" });
    expect(screen.queryByRole("link", { name: "Nueva liquidación de compra" })).toBeNull();
    expect(
      calls.some((call) => call.key.startsWith("GET /api/v1/purchase-settlements/drafts")),
    ).toBe(false);
  });
});
