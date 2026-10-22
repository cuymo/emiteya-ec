// Notas de débito (add-debit-notes, tarea 11.1, design D23): carga, vacío, error con reintento, sin
// permiso, filtros en la URL y los borradores primero en la misma tabla, con su eliminación.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { SessionGate } from "@/components/session";
import { DebitNotesScreen } from "@/features/debit-notes/debit-notes-screen";
import { debitNoteDraft, debitNoteDraftSummary, debitNoteSummary } from "./debit-note-fixtures";
import {
  ADMIN_ME,
  OPERATOR_ME,
  errorBody,
  mockApi,
  navigation,
  renderApp,
  type Route,
} from "./harness";
import { chooseFilter } from "./filters";

const paged =
  (data: unknown[]): Route =>
  () => ({ status: 200, body: { data, meta: { page: 1, pageSize: 25, total: data.length } } });
/** La lista unificada: los borradores primero y después las notas emitidas. */
const entries =
  (documents: unknown[], drafts: unknown[] = []): Route =>
  () => ({
    status: 200,
    body: {
      data: [
        ...drafts.map((draft) => ({ kind: "DRAFT", draft })),
        ...documents.map((document) => ({ kind: "DOCUMENT", document })),
      ],
      meta: { page: 1, pageSize: 25, total: drafts.length + documents.length },
    },
  });

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

describe("«Nueva nota de débito» sobre la lista (decisión del propietario, 2026-10-22)", () => {
  it("abre el selector encima de la tabla; elegir la factura crea el borrador y abre su editor", async () => {
    let created: unknown;
    render(<DebitNotesScreen />, {
      "GET /api/v1/debit-notes/entries": entries([]),
      "GET /api/v1/debit-notes/eligible-invoices": () => ({
        status: 200,
        body: {
          data: [
            {
              id: "inv-1",
              documentNumber: "001-001-000000001",
              issueDate: "2026-10-01",
              buyerIdentification: "0992877878001",
              buyerName: "EL PERNO CIA. LTDA.",
              total: "66.00",
            },
          ],
          meta: { page: 1, pageSize: 10, total: 1 },
        },
      }),
      "POST /api/v1/debit-notes/drafts": (init) => {
        created = JSON.parse(init.body as string);
        return { status: 201, body: { data: debitNoteDraft({ id: "ndd-9" }) } };
      },
    });
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole("button", { name: "Nueva nota de débito" }))[0]!);
    const dialog = await screen.findByRole("dialog", { name: "Elegir factura" });
    expect(navigation.push).not.toHaveBeenCalled();
    await user.click(await within(dialog).findByText("001-001-000000001"));
    await waitFor(() =>
      expect(navigation.push).toHaveBeenCalledWith("/notas-debito/borradores/ndd-9"),
    );
    expect(created).toEqual({ invoiceId: "inv-1" });
    expect(navigation.replace).not.toHaveBeenCalled();
  });
});

describe("pantalla Notas de débito", () => {
  it("lista número, factura, causas, comprador, valor y estado, con enlace al detalle", async () => {
    render(<DebitNotesScreen />, {
      "GET /api/v1/debit-notes/entries": entries([
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
    const table = await screen.findByRole("table", { name: "Notas de débito y borradores" });
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
    expect(within(row("001-001-000000003")).getByText("$28,00")).toBeDefined();
    expect(within(row("001-001-000000003")).getByText("Autorizado")).toBeDefined();
    expect(within(row("001-001-000000004")).getByText("Intereses de mora")).toBeDefined();
    expect(within(row("001-001-000000004")).getByText("Requiere revisión")).toBeDefined();
    // «Nueva nota de débito» abre su creación sobre la lista: es un botón, no un enlace a otra página.
    expect(screen.getByRole("button", { name: "Nueva nota de débito" })).toBeDefined();
  });

  it("muestra la carga mientras llegan las notas", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    render(<DebitNotesScreen />, {
      "GET /api/v1/debit-notes/entries": entries([debitNoteSummary()]),
    });
    const fetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        if (input.startsWith("/api/v1/debit-notes/entries?")) await gate;
        return fetch(input, init);
      }),
    );
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).not.toBeNull());
    release();
    expect(
      await screen.findByRole("table", { name: "Notas de débito y borradores" }),
    ).toBeDefined();
  });

  it("vacía ofrece crear la primera; el error se reintenta", async () => {
    let fail = true;
    render(<DebitNotesScreen />, {
      "GET /api/v1/debit-notes/entries": () =>
        fail ? { status: 500, body: errorBody("INTERNAL_ERROR", "x") } : entries([])({}),
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
    render(<DebitNotesScreen />, { "GET /api/v1/debit-notes/entries": entries([]) });
    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: "Nueva nota de débito" }).length,
      ).toBeGreaterThan(1),
    );
    const variants = screen
      .getAllByRole("button", { name: "Nueva nota de débito" })
      .map((link) => link.getAttribute("data-variant"));
    expect(variants.filter((variant) => variant === "primary")).toHaveLength(1);
    expect(variants.filter((variant) => variant !== "primary").every((v) => v === "outline")).toBe(
      true,
    );
  });

  it("sin permiso explica el acceso", async () => {
    render(<DebitNotesScreen />, {
      "GET /api/v1/debit-notes/entries": () => ({
        status: 403,
        body: errorBody("FORBIDDEN", "x"),
      }),
    });
    expect(await screen.findByText("No tienes acceso a Notas de débito")).toBeDefined();
  });

  it("la búsqueda, el estado y la causa viven en la URL y llegan a la API", async () => {
    navigation.search = new URLSearchParams("q=perno&estado=revision&causa=intereses");
    const calls = render(<DebitNotesScreen />, {
      "GET /api/v1/debit-notes/entries": entries([]),
    });
    expect((await screen.findAllByText("No hay notas que coincidan")).length).toBeGreaterThan(0);
    const call = calls.find((entry) => entry.key.startsWith("GET /api/v1/debit-notes/entries?"))!;
    expect(Object.fromEntries(new URLSearchParams(call.key.split("?")[1]))).toMatchObject({
      search: "perno",
      state: "MANUAL_REVIEW",
      cause: "LATE_PAYMENT_INTEREST",
    });
    await chooseFilter("Causa", "Costos o gastos posteriores a la factura");
    expect(navigation.replace).toHaveBeenLastCalledWith(expect.stringContaining("causa=costos"), {
      scroll: false,
    });
    await chooseFilter("Estado", "Devueltas");
    expect(navigation.replace).toHaveBeenLastCalledWith(
      expect.stringContaining("estado=devueltas"),
      { scroll: false },
    );
    await userEvent.setup().click(screen.getAllByRole("button", { name: "Limpiar filtros" })[0]!);
    expect(navigation.replace).toHaveBeenLastCalledWith("/notas-debito", { scroll: false });
  });

  it("muestra los borradores primero, con su estado, y los elimina desde su fila", async () => {
    let drafts = [debitNoteDraftSummary()];
    const calls = render(<DebitNotesScreen />, {
      "GET /api/v1/debit-notes/entries": () => entries([debitNoteSummary()], drafts)({}),
      "DELETE /api/v1/debit-notes/drafts/ndd-1": () => {
        drafts = [];
        return { status: 204 };
      },
    });
    const table = await screen.findByRole("table", { name: "Notas de débito y borradores" });
    await within(table).findByRole("link", { name: "Borrador" });
    const [, first, second] = within(table).getAllByRole("row");
    expect(within(first!).getByRole("link", { name: "Borrador" })).toHaveProperty(
      "href",
      expect.stringContaining("/notas-debito/borradores/ndd-1"),
    );
    expect(first!.querySelector('[data-document-state="DRAFT"]')?.textContent).toBe("Borrador");
    expect(second!.querySelector('[data-document-state="DRAFT"]')).toBeNull();
    const user = userEvent.setup();
    await user.click(
      within(first!).getByRole("button", {
        name: "Acciones del borrador de la factura 001-001-000000001",
      }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Eliminar borrador" }));
    const dialog = await screen.findByRole("dialog", { name: "Eliminar borrador" });
    await user.click(within(dialog).getByRole("button", { name: "Eliminar borrador" }));
    expect(await screen.findByText("Eliminaste el borrador.")).toBeDefined();
    expect(calls.some((call) => call.key === "DELETE /api/v1/debit-notes/drafts/ndd-1")).toBe(true);
    await waitFor(() => expect(within(table).queryByRole("link", { name: "Borrador" })).toBeNull());
  });

  it("«Borradores» en el filtro de estado pide DRAFT", async () => {
    navigation.search = new URLSearchParams("estado=borradores");
    const calls = render(<DebitNotesScreen />, {
      "GET /api/v1/debit-notes/entries": entries([], [debitNoteDraftSummary()]),
    });
    await within(
      await screen.findByRole("table", { name: "Notas de débito y borradores" }),
    ).findByRole("link", { name: "Borrador" });
    expect(
      calls.find((call) => call.key.startsWith("GET /api/v1/debit-notes/entries?"))!.key,
    ).toContain("state=DRAFT");
  });
});
