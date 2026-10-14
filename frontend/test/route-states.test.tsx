// Estados de ruta y destino no permitido (spec web-application-shell; adopt-premium-design-foundation-
// and-shell, design D11 y D16): carga y error dentro del shell, dirección inexistente fuera de él y la
// guarda síncrona que nunca monta el contenido protegido ni pide sus datos.
import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ScreenError from "@/app/(app)/error";
import Loading from "@/app/(app)/loading";
import NotFound from "@/app/not-found";
import { UsersScreen } from "@/features/users/users-screen";
import { OPERATOR_ME, mockApi, navigation, renderApp } from "./harness";
import { TEST_NOTICE, api, renderShell } from "./shell-harness";

beforeEach(() => {
  navigation.pathname = "/facturas";
  navigation.search = new URLSearchParams();
  navigation.replace.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const mainNav = () => screen.getByRole("navigation", { name: "Navegación principal" });

describe("carga de una pantalla", () => {
  it("anuncia la carga en el contenido y deja visibles la navegación y el aviso de ambiente", async () => {
    api();
    renderShell({ children: <Loading /> });
    expect((await screen.findByText("Cargando la pantalla")).getAttribute("role")).toBe("status");
    expect(within(mainNav()).getByRole("link", { name: "Facturas" })).toBeDefined();
    expect(await screen.findByText(TEST_NOTICE)).toBeDefined();
  });
});

describe("error inesperado en una pantalla", () => {
  it("muestra un mensaje comprensible, permite reintentar y sigue navegable", async () => {
    const retry = vi.fn();
    api();
    renderShell({
      children: (
        <ScreenError
          error={Object.assign(new Error("TypeError: cannot read 'total' of undefined"), {
            digest: "1234567890",
          })}
          retry={retry}
        />
      ),
    });
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByRole("heading", { level: 1 }).textContent).toBe(
      "No pudimos mostrar esta pantalla",
    );
    fireEvent.click(within(alert).getByRole("button", { name: "Intentar de nuevo" }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(within(mainNav()).getByRole("link", { name: "Productos" })).toBeDefined();
  });

  it("no muestra el mensaje técnico, la traza ni el identificador", async () => {
    api();
    renderShell({
      children: (
        <ScreenError
          error={Object.assign(new Error("TypeError: cannot read 'total' of undefined"), {
            digest: "1234567890",
          })}
          retry={() => {}}
        />
      ),
    });
    await screen.findByRole("alert");
    expect(document.body.textContent).not.toContain("TypeError");
    expect(document.body.textContent).not.toContain("1234567890");
  });
});

describe("dirección inexistente", () => {
  it("dice que la página no existe, con la marca y un enlace a Inicio, sin pedir datos", () => {
    const calls = mockApi({});
    renderApp(<NotFound />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Esta página no existe");
    expect(screen.getByRole("link", { name: "Ir a Inicio" }).getAttribute("href")).toBe("/");
    expect(screen.getByText("EmiteYa")).toBeDefined();
    expect(calls).toEqual([]);
  });
});

describe("destino no permitido", () => {
  it("un operador en Usuarios ve que no tiene acceso y no se pide la lista de usuarios", async () => {
    const calls = api({ me: OPERATOR_ME });
    navigation.pathname = "/configuracion/usuarios";
    renderShell({ children: <UsersScreen /> });
    expect(
      (await screen.findByRole("heading", { level: 1, name: "No tienes acceso a esta sección" }))
        .textContent,
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ir a Inicio" }).getAttribute("href")).toBe("/");
    expect(calls.some((call) => call.key.startsWith("GET /api/v1/users"))).toBe(false);
  });

  it("el contenido de un destino no permitido nunca se monta", async () => {
    let mounted = false;
    function Sequences() {
      mounted = true;
      return <p>Secuenciales</p>;
    }
    api({ me: OPERATOR_ME });
    navigation.pathname = "/configuracion/secuenciales";
    renderShell({ children: <Sequences /> });
    await screen.findByRole("heading", { level: 1, name: "No tienes acceso a esta sección" });
    expect(mounted).toBe(false);
  });

  it("un destino permitido se muestra como hasta ahora", async () => {
    api({ me: OPERATOR_ME });
    navigation.pathname = "/configuracion/catalogos-fiscales";
    renderShell();
    expect(await screen.findByText("contenido")).toBeDefined();
    expect(screen.queryByText("No tienes acceso a esta sección")).toBeNull();
  });
});
