import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionGate } from "@/components/session";
import { AccountScreen } from "@/features/account/account-screen";
import {
  ADMIN_ME,
  OPERATOR_ME,
  errorBody,
  mockApi,
  navigation,
  renderApp,
  type Route,
} from "./harness";

const ESTABLISHMENTS = [
  {
    id: "e1",
    code: "001",
    address: "Quito",
    status: "ACTIVE",
    emissionPoints: [
      { id: "p1", code: "001", status: "ACTIVE", available: true },
      { id: "p2", code: "002", status: "INACTIVE", available: false },
    ],
  },
  {
    id: "e2",
    code: "002",
    address: "Guayaquil",
    status: "INACTIVE",
    emissionPoints: [{ id: "p3", code: "001", status: "ACTIVE", available: false }],
  },
];
const defaultOf = (point: { id: string; code: string; status: string }, available: boolean) => ({
  establishment: { id: "e1", code: "001", address: "Quito", status: "ACTIVE" },
  emissionPoint: point,
  available,
});

function renderAccount(
  current: () => unknown,
  options: {
    establishments?: unknown[];
    put?: Route;
    me?: typeof ADMIN_ME | typeof OPERATOR_ME;
  } = {},
) {
  const calls = mockApi({
    "GET /api/v1/me": () => ({ status: 200, body: { data: options.me ?? OPERATOR_ME } }),
    "GET /api/v1/me/default-emission-point": () => ({ status: 200, body: { data: current() } }),
    "GET /api/v1/establishments": () => ({
      status: 200,
      body: { data: options.establishments ?? ESTABLISHMENTS },
    }),
    ...(options.put ? { "PUT /api/v1/me/default-emission-point": options.put } : {}),
  });
  renderApp(
    <SessionGate fallback={<p>cargando</p>}>
      <AccountScreen />
    </SessionGate>,
  );
  return calls;
}

beforeEach(() => {
  navigation.pathname = "/mi-cuenta";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("punto de emisión predeterminado en Mi cuenta (design D8 y D14)", () => {
  for (const me of [ADMIN_ME, OPERATOR_ME]) {
    it(`${me.role} elige un punto disponible agrupado por establecimiento`, async () => {
      let current: unknown = null;
      const calls = renderAccount(() => current, {
        me,
        put: (init) => {
          current = defaultOf({ id: "p1", code: "001", status: "ACTIVE" }, true);
          expect(JSON.parse(init.body!)).toEqual({ emissionPointId: "p1" });
          return { status: 200, body: { data: current } };
        },
      });
      const user = userEvent.setup();
      const select = await screen.findByLabelText("Punto de emisión");
      const options = within(select)
        .getAllByRole("option")
        .map((option) => option.textContent);
      expect(options).toEqual(["Sin predeterminado", "001-001"]);
      expect(within(select).getByRole("group", { name: "001 · Quito" })).toBeDefined();
      const save = screen.getByRole("button", { name: "Guardar punto predeterminado" });
      expect((save as HTMLButtonElement).disabled).toBe(true);
      await user.selectOptions(select, "p1");
      await user.click(save);
      expect(await screen.findByText("Guardaste tu punto predeterminado: 001-001.")).toBeDefined();
      expect(calls.some((call) => call.key === "PUT /api/v1/me/default-emission-point")).toBe(true);
    });
  }

  it("indica un predeterminado que dejó de estar disponible", async () => {
    renderAccount(() => defaultOf({ id: "p2", code: "002", status: "INACTIVE" }, false));
    expect(
      await screen.findByText("Tu punto predeterminado (001-002) no está disponible; elige otro."),
    ).toBeDefined();
    const unavailable = screen.getByRole("option", { name: "001-002 (no disponible)" });
    expect((unavailable as HTMLOptionElement).disabled).toBe(true);
  });

  it("quita el predeterminado", async () => {
    let current: unknown = defaultOf({ id: "p1", code: "001", status: "ACTIVE" }, true);
    renderAccount(() => current, {
      put: () => {
        current = null;
        return { status: 200, body: { data: null } };
      },
    });
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText("Punto de emisión"), "");
    await user.click(screen.getByRole("button", { name: "Guardar punto predeterminado" }));
    expect(await screen.findByText("Quitaste tu punto predeterminado.")).toBeDefined();
  });

  it("sin puntos disponibles lo explica", async () => {
    renderAccount(() => null, { establishments: [] });
    expect(await screen.findByText("Aún no hay puntos de emisión disponibles.")).toBeDefined();
  });

  it("si el punto dejó de estar disponible al guardar, lo informa y conserva la elección", async () => {
    renderAccount(() => null, {
      put: () => ({
        status: 409,
        body: errorBody("EMISSION_POINT_UNAVAILABLE", "Ese punto de emisión no está disponible."),
      }),
    });
    const user = userEvent.setup();
    const select = await screen.findByLabelText("Punto de emisión");
    await user.selectOptions(select, "p1");
    await user.click(screen.getByRole("button", { name: "Guardar punto predeterminado" }));
    expect(await screen.findByText("Ese punto de emisión no está disponible.")).toBeDefined();
    await waitFor(() => expect((select as HTMLSelectElement).value).toBe("p1"));
  });
});
