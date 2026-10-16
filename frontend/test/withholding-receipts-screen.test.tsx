// Retenciones (add-withholding-receipts, tarea 12.1, design D24): lista con número, proveedor,
// período, total retenido y estado; carga, vacío, error con reintento, sin permiso, filtros de
// estado y período en la URL y los borradores en curso con su eliminación.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { SessionGate } from "@/components/session";
import { WithholdingReceiptsScreen } from "@/features/withholding-receipts/withholding-receipts-screen";
import {
  ADMIN_ME,
  OPERATOR_ME,
  errorBody,
  mockApi,
  navigation,
  renderApp,
  type Route,
} from "./harness";
import { withholdingDraftSummary, withholdingSummary } from "./withholding-fixtures";
import { chooseFilter } from "./filters";

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
    "GET /api/v1/withholding-receipts/drafts": paged([]),
    ...routes,
  });
  renderApp(<SessionGate fallback={<p>cargando</p>}>{ui}</SessionGate>);
  return calls;
}

beforeEach(() => {
  navigation.pathname = "/retenciones";
  navigation.search = new URLSearchParams();
  navigation.replace.mockReset();
  navigation.push.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pantalla Retenciones", () => {
  it("lista número, proveedor, período, total retenido y estado, con enlace al detalle", async () => {
    render(<WithholdingReceiptsScreen />, {
      "GET /api/v1/withholding-receipts": paged([
        withholdingSummary(),
        withholdingSummary({
          id: "ret-2",
          documentNumber: "001-001-000000005",
          fiscalPeriod: "09/2026",
          supportCount: 3,
          state: "MANUAL_REVIEW",
          total: "120.00",
        }),
      ]),
    });
    const table = await screen.findByRole("table", { name: "Retenciones emitidas" });
    const row = (number: string) =>
      within(table)
        .getAllByRole("row")
        .find((candidate) => within(candidate).queryByText(number))!;
    await within(table).findByText("001-001-000000004");
    expect(within(row("001-001-000000004")).getByRole("link").getAttribute("href")).toBe(
      "/retenciones/ret-1",
    );
    expect(within(row("001-001-000000004")).getByText("PROVEEDORA DEL SUR S.A.")).toBeDefined();
    expect(within(row("001-001-000000004")).getByText("Octubre de 2026")).toBeDefined();
    expect(within(row("001-001-000000004")).getByText("1 documento")).toBeDefined();
    expect(within(row("001-001-000000004")).getByText("$3,25")).toBeDefined();
    expect(within(row("001-001-000000004")).getByText("Autorizado")).toBeDefined();
    expect(within(row("001-001-000000005")).getByText("Septiembre de 2026")).toBeDefined();
    expect(within(row("001-001-000000005")).getByText("3 documentos")).toBeDefined();
    expect(within(row("001-001-000000005")).getByText("Requiere revisión")).toBeDefined();
    expect(screen.getByRole("link", { name: "Nueva retención" }).getAttribute("href")).toBe(
      "/retenciones/borradores/nueva",
    );
  });

  it("muestra la carga mientras llegan las retenciones", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    render(<WithholdingReceiptsScreen />, {
      "GET /api/v1/withholding-receipts": paged([withholdingSummary()]),
    });
    const fetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        if (input.startsWith("/api/v1/withholding-receipts?")) await gate;
        return fetch(input, init);
      }),
    );
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).not.toBeNull());
    release();
    expect(await screen.findByRole("table", { name: "Retenciones emitidas" })).toBeDefined();
  });

  it("vacía ofrece crear la primera; el error se reintenta", async () => {
    let fail = true;
    render(<WithholdingReceiptsScreen />, {
      "GET /api/v1/withholding-receipts": () =>
        fail ? { status: 500, body: errorBody("INTERNAL_ERROR", "x") } : paged([])({}),
    });
    expect(
      (
        await screen.findAllByText("No pudimos cargar las retenciones.", undefined, {
          timeout: 5_000,
        })
      ).length,
    ).toBeGreaterThan(0);
    fail = false;
    await userEvent.setup().click(screen.getAllByRole("button", { name: "Intentar de nuevo" })[0]!);
    expect((await screen.findAllByText("Todavía no hay retenciones")).length).toBeGreaterThan(0);
  });

  it("vacía: la única principal está en el encabezado y el vacío la repite en outline (D11)", async () => {
    render(<WithholdingReceiptsScreen />, { "GET /api/v1/withholding-receipts": paged([]) });
    await waitFor(() =>
      expect(screen.getAllByRole("link", { name: "Nueva retención" }).length).toBeGreaterThan(1),
    );
    const variants = screen
      .getAllByRole("link", { name: "Nueva retención" })
      .map((link) => link.getAttribute("data-variant"));
    expect(variants.filter((variant) => variant === "primary")).toHaveLength(1);
    expect(variants.filter((variant) => variant !== "primary").every((v) => v === "outline")).toBe(
      true,
    );
  });

  it("sin permiso explica el acceso", async () => {
    render(<WithholdingReceiptsScreen />, {
      "GET /api/v1/withholding-receipts": () => ({
        status: 403,
        body: errorBody("FORBIDDEN", "x"),
      }),
    });
    expect(await screen.findByText("No tienes acceso a Retenciones")).toBeDefined();
  });

  it("la búsqueda, el estado y el período viven en la URL y llegan a la API", async () => {
    navigation.search = new URLSearchParams("q=sur&estado=revision&periodo=2026-09");
    const calls = render(<WithholdingReceiptsScreen />, {
      "GET /api/v1/withholding-receipts": paged([]),
    });
    expect((await screen.findAllByText("No hay retenciones que coincidan")).length).toBeGreaterThan(
      0,
    );
    const call = calls.find((entry) => entry.key.startsWith("GET /api/v1/withholding-receipts?"))!;
    expect(Object.fromEntries(new URLSearchParams(call.key.split("?")[1]))).toMatchObject({
      search: "sur",
      state: "MANUAL_REVIEW",
      fiscalPeriod: "09/2026",
    });
    expect(screen.getByRole("combobox", { name: "Período fiscal" }).textContent).toContain(
      "Septiembre de 2026",
    );
    await chooseFilter("Período fiscal", "Agosto de 2026");
    expect(navigation.replace).toHaveBeenLastCalledWith(
      expect.stringContaining("periodo=2026-08"),
      { scroll: false },
    );
    await chooseFilter("Estado", "Devueltas");
    expect(navigation.replace).toHaveBeenLastCalledWith(
      expect.stringContaining("estado=devueltas"),
      { scroll: false },
    );
    await userEvent.setup().click(screen.getAllByRole("button", { name: "Limpiar filtros" })[0]!);
    expect(navigation.replace).toHaveBeenLastCalledWith("/retenciones", { scroll: false });
  });

  it("muestra los borradores en curso con su enlace y los elimina con confirmación", async () => {
    let drafts = [withholdingDraftSummary()];
    const calls = render(<WithholdingReceiptsScreen />, {
      "GET /api/v1/withholding-receipts": paged([]),
      "GET /api/v1/withholding-receipts/drafts": () => paged(drafts)({}),
      "DELETE /api/v1/withholding-receipts/drafts/retd-1": () => {
        drafts = [];
        return { status: 204 };
      },
    });
    const panel = await screen.findByRole("region", { name: "Borradores en curso" });
    expect(
      within(panel).getByRole("link", { name: "Retención a PROVEEDORA DEL SUR S.A." }),
    ).toHaveProperty("href", expect.stringContaining("/retenciones/borradores/retd-1"));
    expect(within(panel).getByText(/1 documento · 2 retenciones ·/)).toBeDefined();
    expect(within(panel).getByText("$3,25")).toBeDefined();
    const user = userEvent.setup();
    await user.click(
      within(panel).getByRole("button", {
        name: "Eliminar el borrador de la retención a PROVEEDORA DEL SUR S.A.",
      }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Eliminar borrador" });
    await user.click(within(dialog).getByRole("button", { name: "Eliminar" }));
    expect(await screen.findByText("Eliminaste el borrador.")).toBeDefined();
    expect(
      calls.some((call) => call.key === "DELETE /api/v1/withholding-receipts/drafts/retd-1"),
    ).toBe(true);
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Borradores en curso" })).toBeNull(),
    );
  });
});
