// Guías de remisión (add-shipping-guides, tarea 12.1, design D25): lista con número, destinatarios
// ("N destinatarios" o el nombre), transportista, fechas y estado; carga, vacío, error con reintento,
// sin permiso, búsqueda y filtro de estado en la URL, y los borradores en curso con su eliminación.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { SessionGate } from "@/components/session";
import { ShippingGuidesScreen } from "@/features/shipping-guides/shipping-guides-screen";
import {
  ADMIN_ME,
  OPERATOR_ME,
  errorBody,
  mockApi,
  navigation,
  renderApp,
  type Route,
} from "./harness";
import { guideDraftSummary, guideSummary } from "./shipping-guide-fixtures";

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
    "GET /api/v1/shipping-guides/drafts": paged([]),
    ...routes,
  });
  renderApp(<SessionGate fallback={<p>cargando</p>}>{ui}</SessionGate>);
  return calls;
}

beforeEach(() => {
  navigation.pathname = "/guias-remision";
  navigation.search = new URLSearchParams();
  navigation.replace.mockReset();
  navigation.push.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pantalla Guías de remisión", () => {
  it("lista número, destinatarios, transportista, fechas y estado, con enlace al detalle", async () => {
    render(<ShippingGuidesScreen />, {
      "GET /api/v1/shipping-guides": paged([
        guideSummary(),
        guideSummary({
          id: "gr-2",
          documentNumber: "001-001-000000006",
          recipients: { count: 1, name: "María Pérez" },
          carrierName: "EMPRESA DE PRUEBA S.A.",
          state: "MANUAL_REVIEW",
        }),
      ]),
    });
    const table = await screen.findByRole("table", { name: "Guías de remisión emitidas" });
    const row = (number: string) =>
      within(table)
        .getAllByRole("row")
        .find((candidate) => within(candidate).queryByText(number))!;
    await within(table).findByText("001-001-000000005");
    expect(within(row("001-001-000000005")).getByRole("link").getAttribute("href")).toBe(
      "/guias-remision/gr-1",
    );
    expect(within(row("001-001-000000005")).getByText("2 destinatarios")).toBeDefined();
    expect(within(row("001-001-000000005")).getByText("TRANSPORTES ANDINOS S.A.")).toBeDefined();
    expect(within(row("001-001-000000005")).getByText("Inicio 06/10/2026")).toBeDefined();
    expect(within(row("001-001-000000005")).getByText("Autorizado")).toBeDefined();
    // Un solo destinatario se muestra por su nombre; sin importes.
    expect(within(row("001-001-000000006")).getByText("María Pérez")).toBeDefined();
    expect(within(row("001-001-000000006")).getByText("Requiere revisión")).toBeDefined();
    expect(within(table).queryByText(/USD/)).toBeNull();
    expect(screen.getByRole("link", { name: "Nueva guía de remisión" }).getAttribute("href")).toBe(
      "/guias-remision/borradores/nueva",
    );
  });

  it("muestra la carga mientras llegan las guías", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    render(<ShippingGuidesScreen />, {
      "GET /api/v1/shipping-guides": paged([guideSummary()]),
    });
    const fetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        if (input.startsWith("/api/v1/shipping-guides?")) await gate;
        return fetch(input, init);
      }),
    );
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).not.toBeNull());
    release();
    expect(await screen.findByRole("table", { name: "Guías de remisión emitidas" })).toBeDefined();
  });

  it("vacía ofrece crear la primera; el error se reintenta", async () => {
    let fail = true;
    render(<ShippingGuidesScreen />, {
      "GET /api/v1/shipping-guides": () =>
        fail ? { status: 500, body: errorBody("INTERNAL_ERROR", "x") } : paged([])({}),
    });
    expect(
      (
        await screen.findAllByText("No pudimos cargar las guías de remisión.", undefined, {
          timeout: 5_000,
        })
      ).length,
    ).toBeGreaterThan(0);
    fail = false;
    await userEvent.setup().click(screen.getAllByRole("button", { name: "Intentar de nuevo" })[0]!);
    expect((await screen.findAllByText("Todavía no hay guías de remisión")).length).toBeGreaterThan(
      0,
    );
  });

  it("vacía: la única principal está en el encabezado y el vacío la repite en outline (D11)", async () => {
    render(<ShippingGuidesScreen />, { "GET /api/v1/shipping-guides": paged([]) });
    await waitFor(() =>
      expect(
        screen.getAllByRole("link", { name: "Nueva guía de remisión" }).length,
      ).toBeGreaterThan(1),
    );
    const variants = screen
      .getAllByRole("link", { name: "Nueva guía de remisión" })
      .map((link) => link.getAttribute("data-variant"));
    expect(variants.filter((variant) => variant === "primary")).toHaveLength(1);
    expect(variants.filter((variant) => variant !== "primary").every((v) => v === "outline")).toBe(
      true,
    );
  });

  it("sin permiso explica el acceso", async () => {
    render(<ShippingGuidesScreen />, {
      "GET /api/v1/shipping-guides": () => ({
        status: 403,
        body: errorBody("FORBIDDEN", "x"),
      }),
    });
    expect(await screen.findByText("No tienes acceso a Guías de remisión")).toBeDefined();
  });

  it("la búsqueda y el estado viven en la URL y llegan a la API", async () => {
    navigation.search = new URLSearchParams("q=1710034065&estado=revision");
    const calls = render(<ShippingGuidesScreen />, {
      "GET /api/v1/shipping-guides": paged([]),
    });
    expect((await screen.findAllByText("No hay guías que coincidan")).length).toBeGreaterThan(0);
    const call = calls.find((entry) => entry.key.startsWith("GET /api/v1/shipping-guides?"))!;
    expect(Object.fromEntries(new URLSearchParams(call.key.split("?")[1]))).toMatchObject({
      search: "1710034065",
      state: "MANUAL_REVIEW",
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("radio", { name: "Devueltas" }));
    expect(navigation.replace).toHaveBeenLastCalledWith(
      expect.stringContaining("estado=devueltas"),
      { scroll: false },
    );
    await user.click(screen.getAllByRole("button", { name: "Limpiar filtros" })[0]!);
    expect(navigation.replace).toHaveBeenLastCalledWith("/guias-remision", { scroll: false });
  });

  it("muestra los borradores en curso con su enlace y los elimina con confirmación", async () => {
    let drafts = [guideDraftSummary()];
    const calls = render(<ShippingGuidesScreen />, {
      "GET /api/v1/shipping-guides": paged([]),
      "GET /api/v1/shipping-guides/drafts": () => paged(drafts)({}),
      "DELETE /api/v1/shipping-guides/drafts/grd-1": () => {
        drafts = [];
        return { status: 204 };
      },
    });
    const panel = await screen.findByRole("region", { name: "Borradores en curso" });
    expect(
      within(panel).getByRole("link", { name: "Guía con TRANSPORTES ANDINOS S.A." }),
    ).toHaveProperty("href", expect.stringContaining("/guias-remision/borradores/grd-1"));
    expect(
      within(panel).getByText(/2 destinatarios · 3 detalles · Desde el 06\/10\/2026/),
    ).toBeDefined();
    const user = userEvent.setup();
    await user.click(
      within(panel).getByRole("button", {
        name: "Eliminar el borrador: Guía con TRANSPORTES ANDINOS S.A.",
      }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Eliminar borrador" });
    await user.click(within(dialog).getByRole("button", { name: "Eliminar" }));
    expect(await screen.findByText("Eliminaste el borrador.")).toBeDefined();
    expect(calls.some((call) => call.key === "DELETE /api/v1/shipping-guides/drafts/grd-1")).toBe(
      true,
    );
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Borradores en curso" })).toBeNull(),
    );
  });
});
