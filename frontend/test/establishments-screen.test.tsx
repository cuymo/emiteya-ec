import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionGate } from "@/components/session";
import { EstablishmentsScreen } from "@/features/establishments/establishments-screen";
import {
  ADMIN_ME,
  OPERATOR_ME,
  errorBody,
  mockApi,
  navigation,
  renderApp,
  type Route,
} from "./harness";

type Point = { id: string; code: string; status: "ACTIVE" | "INACTIVE"; available: boolean };
type Establishment = {
  id: string;
  code: string;
  address: string;
  status: "ACTIVE" | "INACTIVE";
  emissionPoints: Point[];
};

const QUITO: Establishment = {
  id: "e1",
  code: "001",
  address: "Av. Amazonas N24-03, Quito",
  status: "ACTIVE",
  emissionPoints: [{ id: "p1", code: "001", status: "ACTIVE", available: true }],
};

function renderScreen(
  list: () => Establishment[],
  routes: Record<string, Route> = {},
  me = ADMIN_ME as typeof ADMIN_ME | typeof OPERATOR_ME,
) {
  const calls = mockApi({
    "GET /api/v1/me": () => ({ status: 200, body: { data: me } }),
    "GET /api/v1/establishments": () => ({ status: 200, body: { data: list() } }),
    ...routes,
  });
  renderApp(
    <SessionGate fallback={<p>cargando</p>}>
      <EstablishmentsScreen />
    </SessionGate>,
  );
  return calls;
}

beforeEach(() => {
  navigation.pathname = "/configuracion/establecimientos";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Establecimientos (design D14)", () => {
  it("desde el estado vacío crea el primer establecimiento", async () => {
    let list: Establishment[] = [];
    const calls = renderScreen(() => list, {
      "POST /api/v1/establishments": () => {
        list = [{ ...QUITO, emissionPoints: [] }];
        return { status: 201, body: { data: list[0] } };
      },
    });
    const user = userEvent.setup();
    expect(
      await screen.findByText("Crea tu primer establecimiento para poder emitir"),
    ).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Crear establecimiento" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Código"), "001");
    await user.type(within(dialog).getByLabelText("Dirección"), QUITO.address);
    await user.click(within(dialog).getByRole("button", { name: "Crear establecimiento" }));
    expect(await screen.findByText("Creaste el establecimiento 001.")).toBeDefined();
    expect(calls.find((call) => call.key === "POST /api/v1/establishments")?.body).toEqual({
      code: "001",
      address: QUITO.address,
    });
    expect(await screen.findByText("Establecimiento 001")).toBeDefined();
    expect(screen.getByText(/Sin puntos de emisión/)).toBeDefined();
  });

  it("un código duplicado se muestra en su campo y conserva los valores", async () => {
    renderScreen(() => [QUITO], {
      "POST /api/v1/establishments": () => ({
        status: 409,
        body: errorBody(
          "ESTABLISHMENT_CODE_TAKEN",
          "Ya existe un establecimiento con el código 001.",
        ),
      }),
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Crear establecimiento" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Código"), "001");
    await user.type(within(dialog).getByLabelText("Dirección"), "Otra");
    await user.click(within(dialog).getByRole("button", { name: "Crear establecimiento" }));
    expect(
      await within(dialog).findByText("Ya existe un establecimiento con el código 001."),
    ).toBeDefined();
    expect((within(dialog).getByLabelText("Dirección") as HTMLInputElement).value).toBe("Otra");
  });

  it("valida el código de tres dígitos en el cliente", async () => {
    renderScreen(() => [QUITO]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Crear establecimiento" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Código"), "1");
    await user.type(within(dialog).getByLabelText("Dirección"), "Quito");
    await user.click(within(dialog).getByRole("button", { name: "Crear establecimiento" }));
    expect(
      await within(dialog).findByText("El código debe tener exactamente tres dígitos."),
    ).toBeDefined();
  });

  it("muestra puntos con su disponibilidad y agrega uno", async () => {
    const calls = renderScreen(() => [QUITO], {
      "POST /api/v1/establishments/e1/emission-points": () => ({
        status: 201,
        body: { data: { id: "p2", code: "002", status: "ACTIVE", available: true } },
      }),
    });
    const user = userEvent.setup();
    expect(await screen.findByText("Punto 001-001")).toBeDefined();
    expect(screen.getByText("Disponible")).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Agregar punto de emisión" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/Establecimiento 001 · Av. Amazonas/)).toBeDefined();
    await user.type(within(dialog).getByLabelText("Código del punto"), "002");
    await user.click(within(dialog).getByRole("button", { name: "Agregar punto" }));
    expect(await screen.findByText("Agregaste el punto de emisión 001-002.")).toBeDefined();
    expect(
      calls.find((call) => call.key.startsWith("POST /api/v1/establishments/e1"))?.body,
    ).toEqual({
      code: "002",
    });
  });

  it("corrige la dirección con el código como etiqueta", async () => {
    const calls = renderScreen(() => [QUITO], {
      "PUT /api/v1/establishments/e1": () => ({
        status: 200,
        body: { data: { ...QUITO, address: "Av. 6 de Diciembre, Quito" } },
      }),
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Corregir la dirección" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Establecimiento 001")).toBeDefined();
    expect(within(dialog).queryByLabelText("Código")).toBeNull();
    const address = within(dialog).getByLabelText("Dirección");
    await user.clear(address);
    await user.type(address, "Av. 6 de Diciembre, Quito");
    await user.click(within(dialog).getByRole("button", { name: "Guardar dirección" }));
    expect(
      await screen.findByText("Actualizaste la dirección del establecimiento 001."),
    ).toBeDefined();
    expect(calls.find((call) => call.key === "PUT /api/v1/establishments/e1")?.body).toEqual({
      address: "Av. 6 de Diciembre, Quito",
    });
  });

  it("desactiva en un paso y Deshacer lo reactiva", async () => {
    const statuses: unknown[] = [];
    renderScreen(() => [QUITO], {
      "PUT /api/v1/establishments/e1/status": (init) => {
        const { status } = JSON.parse(init.body!) as { status: "ACTIVE" | "INACTIVE" };
        statuses.push(status);
        return {
          status: 200,
          body: {
            data: {
              ...QUITO,
              status,
              emissionPoints: [{ ...QUITO.emissionPoints[0]!, available: status === "ACTIVE" }],
            },
          },
        };
      },
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Desactivar establecimiento" }));
    expect(
      await screen.findByText(
        "Desactivaste el establecimiento 001. Sus puntos de emisión dejaron de estar disponibles.",
      ),
    ).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Deshacer" }));
    await waitFor(() => expect(statuses).toEqual(["INACTIVE", "ACTIVE"]));
  });

  it("un punto activo de un establecimiento inactivo no está disponible y lo explica", async () => {
    renderScreen(() => [
      {
        ...QUITO,
        status: "INACTIVE",
        emissionPoints: [{ id: "p1", code: "001", status: "ACTIVE", available: false }],
      },
    ]);
    expect(await screen.findByText("No disponible")).toBeDefined();
    expect(screen.getByText("El establecimiento está inactivo")).toBeDefined();
    expect(screen.getByRole("button", { name: "Reactivar establecimiento" })).toBeDefined();
  });

  it("el operador ve el estado sin permiso", async () => {
    renderScreen(() => [], {}, OPERATOR_ME);
    expect(await screen.findByText("No tienes permiso para ver esta sección")).toBeDefined();
  });
});
