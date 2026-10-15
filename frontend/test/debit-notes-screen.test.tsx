// Notas de débito (add-debit-notes, tarea 11.1, design D23): carga, vacío, error con reintento, sin
// permiso, filtros en la URL y los borradores en curso con su eliminación.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { SessionGate } from "@/components/session";
import { DebitNotesScreen } from "@/features/debit-notes/debit-notes-screen";
import { debitNoteDraftSummary, debitNoteSummary } from "./debit-note-fixtures";
import {
  ADMIN_ME,
  OPERATOR_ME,
  errorBody,
  mockApi,
  navigation,
  renderApp,
  type Route,
} from "./harness";

const paged =
  (data: unknown[]): Route =>
  () => ({ status: 200, body: { data, meta: { page: 1, pageSize: 25, total: data.length } } });

function render(
  ui: ReactNode,
  routes: Record<string, Route>,
  me: typeof ADMIN_ME | typeof OPERATOR_ME = OPERATOR_ME,
) {
  const calls = mockApi({
    "GET /api/v1/me": () => ({ status: 200, body: { data: me } }),
    "GET /api/v1/debit-notes/drafts": paged([]),
    ...routes,
  });
  renderApp(<SessionGate fallback={<p>cargando</p>}>{ui}</SessionGate>);
  return calls;
}

beforeEach(() => {
  navigation.pathname = "/notas-debito";
  navigation.search = new URLSearchParams();
  navigation.replace.mockReset();
  navigation.push.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pantalla Notas de débito", () => {
  it("lista número, factura, causas, comprador, valor y estado, con enlace al detalle", async () => {
    render(<DebitNotesScreen />, {
      "GET /api/v1/debit-notes": paged([
        debitNoteSummary(),
        debitNoteSummary({
          id: "nd-2",
          documentNumber: "001-001-000000004",
          causes: ["LATE_PAYMENT_INTEREST"],
          state: "MANUAL_REVIEW",
          total: "11.50",
        }),
      ]),
    });
    const table = await screen.findByRole("table", { name: "Notas de débito emitidas" });
    const row = (number: string) =>
      within(table)
        .getAllByRole("row")
        .find((candidate) => within(candidate).queryByText(number))!;
    await within(table).findByText("001-001-000000003");
    expect(within(row("001-001-000000003")).getByRole("link").getAttribute("href")).toBe(
      "/notas-debito/nd-1",
    );
    expect(
      within(row("001-001-000000003")).getByText(
        "Intereses de mora · Costos o gastos posteriores a la factura",
      ),
    ).toBeDefined();
    expect(within(row("001-001-000000003")).getByText("001-001-000000001")).toBeDefined();
    expect(within(row("001-001-000000003")).getByText("USD 28,00")).toBeDefined();
    expect(within(row("001-001-000000003")).getByText("Autorizado")).toBeDefined();
    expect(within(row("001-001-000000004")).getByText("Intereses de mora")).toBeDefined();
    expect(within(row("001-001-000000004")).getByText("Requiere revisión")).toBeDefined();
    expect(screen.getByRole("link", { name: "Nueva nota de débito" }).getAttribute("href")).toBe(
      "/notas-debito/borradores/nueva",
    );
  });

  it("muestra la carga mientras llegan las notas", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    render(<DebitNotesScreen />, { "GET /api/v1/debit-notes": paged([debitNoteSummary()]) });
    const fetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        if (input.startsWith("/api/v1/debit-notes?")) await gate;
        return fetch(input, init);
      }),
    );
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).not.toBeNull());
    release();
    expect(await screen.findByRole("table", { name: "Notas de débito emitidas" })).toBeDefined();
  });

  it("vacía ofrece crear la primera; el error se reintenta", async () => {
    let fail = true;
    render(<DebitNotesScreen />, {
      "GET /api/v1/debit-notes": () =>
        fail ? { status: 500, body: errorBody("INTERNAL_ERROR", "x") } : paged([])({}),
    });
    expect(
      (
        await screen.findAllByText("No pudimos cargar las notas de débito.", undefined, {
          timeout: 5_000,
        })
      ).length,
    ).toBeGreaterThan(0);
    fail = false;
    await userEvent.setup().click(screen.getAllByRole("button", { name: "Intentar de nuevo" })[0]!);
    expect((await screen.findAllByText("Todavía no hay notas de débito")).length).toBeGreaterThan(
      0,
    );
  });

  it("vacía: la única principal está en el encabezado y el vacío la repite en outline (D11)", async () => {
    render(<DebitNotesScreen />, { "GET /api/v1/debit-notes": paged([]) });
    await waitFor(() =>
      expect(screen.getAllByRole("link", { name: "Nueva nota de débito" }).length).toBeGreaterThan(
        1,
      ),
    );
    const variants = screen
      .getAllByRole("link", { name: "Nueva nota de débito" })
      .map((link) => link.getAttribute("data-variant"));
    expect(variants.filter((variant) => variant === "primary")).toHaveLength(1);
    expect(variants.filter((variant) => variant !== "primary").every((v) => v === "outline")).toBe(
      true,
    );
  });

  it("sin permiso explica el acceso", async () => {
    render(<DebitNotesScreen />, {
      "GET /api/v1/debit-notes": () => ({ status: 403, body: errorBody("FORBIDDEN", "x") }),
    });
    expect(await screen.findByText("No tienes acceso a Notas de débito")).toBeDefined();
  });

  it("la búsqueda, el estado y la causa viven en la URL y llegan a la API", async () => {
    navigation.search = new URLSearchParams("q=perno&estado=revision&causa=intereses");
    const calls = render(<DebitNotesScreen />, { "GET /api/v1/debit-notes": paged([]) });
    expect((await screen.findAllByText("No hay notas que coincidan")).length).toBeGreaterThan(0);
    const call = calls.find((entry) => entry.key.startsWith("GET /api/v1/debit-notes?"))!;
    expect(Object.fromEntries(new URLSearchParams(call.key.split("?")[1]))).toMatchObject({
      search: "perno",
      state: "MANUAL_REVIEW",
      cause: "LATE_PAYMENT_INTEREST",
    });
    fireEvent.change(screen.getByLabelText("Causa"), { target: { value: "costos" } });
    expect(navigation.replace).toHaveBeenLastCalledWith(expect.stringContaining("causa=costos"), {
      scroll: false,
    });
    await userEvent.setup().click(screen.getByRole("radio", { name: "Devueltas" }));
    expect(navigation.replace).toHaveBeenLastCalledWith(
      expect.stringContaining("estado=devueltas"),
      { scroll: false },
    );
    await userEvent.setup().click(screen.getAllByRole("button", { name: "Limpiar filtros" })[0]!);
    expect(navigation.replace).toHaveBeenLastCalledWith("/notas-debito", { scroll: false });
  });

  it("muestra los borradores en curso con su enlace y los elimina con confirmación", async () => {
    let drafts = [debitNoteDraftSummary()];
    const calls = render(<DebitNotesScreen />, {
      "GET /api/v1/debit-notes": paged([]),
      "GET /api/v1/debit-notes/drafts": () => paged(drafts)({}),
      "DELETE /api/v1/debit-notes/drafts/ndd-1": () => {
        drafts = [];
        return { status: 204 };
      },
    });
    const panel = await screen.findByRole("region", { name: "Borradores en curso" });
    expect(
      within(panel).getByRole("link", { name: /Nota de débito de la factura 001-001-000000001/ }),
    ).toHaveProperty("href", expect.stringContaining("/notas-debito/borradores/ndd-1"));
    expect(within(panel).getByText(/2 conceptos/)).toBeDefined();
    const user = userEvent.setup();
    await user.click(
      within(panel).getByRole("button", {
        name: "Eliminar el borrador de la factura 001-001-000000001",
      }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Eliminar borrador" });
    await user.click(within(dialog).getByRole("button", { name: "Eliminar" }));
    expect(await screen.findByText("Eliminaste el borrador.")).toBeDefined();
    expect(calls.some((call) => call.key === "DELETE /api/v1/debit-notes/drafts/ndd-1")).toBe(true);
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Borradores en curso" })).toBeNull(),
    );
  });
});
