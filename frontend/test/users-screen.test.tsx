import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionGate } from "@/components/session";
import { UsersScreen } from "@/features/users/users-screen";
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

const users = [
  {
    id: "u-ana",
    name: "Ana Admin",
    email: "ana@empresa.ec",
    role: "ADMIN",
    status: "ACTIVE",
    createdAt: "2026-10-01T10:00:00.000Z",
  },
  {
    id: "u-oscar",
    name: "Óscar Operador",
    email: "oscar@empresa.ec",
    role: "OPERATOR",
    status: "ACTIVE",
    createdAt: "2026-10-01T11:00:00.000Z",
  },
  {
    id: "u-ines",
    name: "Inés Inactiva",
    email: "ines@empresa.ec",
    role: "OPERATOR",
    status: "DEACTIVATED",
    createdAt: "2026-10-01T12:00:00.000Z",
  },
] as const;

const list: Route = () => ({
  status: 200,
  body: { data: users, meta: { page: 1, pageSize: 25, total: users.length } },
});

function renderUsers() {
  return renderApp(
    <SessionGate fallback={<p>cargando</p>}>
      <UsersScreen />
    </SessionGate>,
  );
}

/** Abre el menú «Acciones» de la fila de un usuario y devuelve el menú. */
async function openRowActions(name: string) {
  await userEvent.setup().click(screen.getAllByRole("button", { name: `Acciones de ${name}` })[0]!);
  return screen.findByRole("menu");
}

beforeEach(() => {
  navigation.pathname = "/configuracion/usuarios";
  navigation.search = new URLSearchParams();
  navigation.replace.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pantalla Usuarios", () => {
  it("un operador ve el estado sin permiso y no consulta la lista", async () => {
    const calls = mockApi({
      "GET /api/v1/me": () => ({ status: 200, body: { data: OPERATOR_ME } }),
      "GET /api/v1/users": list,
    });
    renderUsers();
    expect(await screen.findByText("No tienes acceso a Usuarios")).toBeDefined();
    expect(calls.some((call) => call.key.startsWith("GET /api/v1/users"))).toBe(false);
    expect(screen.queryByRole("button", { name: "Crear usuario" })).toBeNull();
  });

  it("muestra nombre, correo, rol y estado con insignia de icono y texto, y la paginación común", async () => {
    mockApi({
      "GET /api/v1/me": () => ({ status: 200, body: { data: ADMIN_ME } }),
      "GET /api/v1/users": list,
    });
    renderUsers();
    await screen.findByText("Mostrando 1-3 de 3");
    const table = screen.getByRole("table", { name: "Usuarios de la empresa" });
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((h) => h.textContent);
    expect(headers).toEqual(["Nombre", "Correo", "Rol", "Estado", "Acciones"]);
    expect(within(table).getByText("Óscar Operador")).toBeDefined();
    expect(within(table).getAllByText("Activo")).toHaveLength(2);
    expect(within(table).getByText("Desactivado")).toBeDefined();
    expect(screen.getByText("Mostrando 1-3 de 3")).toBeDefined();
    // Nunca se muestran identificadores internos.
    expect(table.textContent).not.toContain("u-oscar");
  });

  it("la fila propia no ofrece cambiar rol ni estado, y explica por qué", async () => {
    mockApi({
      "GET /api/v1/me": () => ({ status: 200, body: { data: ADMIN_ME } }),
      "GET /api/v1/users": list,
    });
    renderUsers();
    await screen.findByText("Mostrando 1-3 de 3");
    // La fila propia lo dice, sin acciones.
    expect(screen.getAllByText(/Tu cuenta/)[0]!.textContent).toBe(
      "Tu cuenta: no puedes cambiar tu propio acceso",
    );
    expect(screen.queryByRole("button", { name: "Acciones de Ana Admin" })).toBeNull();
    // Un botón «Acciones» con borde por fila, con las opciones con su nombre.
    const oscar = screen.getAllByRole("button", { name: "Acciones de Óscar Operador" })[0]!;
    expect(oscar.textContent).toContain("Acciones");
    expect(
      within(await openRowActions("Óscar Operador"))
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Cambiar rol", "Establecer contraseña", "Desactivar"]);
    await userEvent.setup().keyboard("{Escape}");
    expect(
      within(await openRowActions("Inés Inactiva")).getByRole("menuitem", { name: "Reactivar" }),
    ).toBeDefined();
  });

  it("una página que ya no existe lleva a la última, sin mostrar un intervalo imposible", async () => {
    navigation.search = new URLSearchParams("pagina=3");
    mockApi({
      "GET /api/v1/me": () => ({ status: 200, body: { data: ADMIN_ME } }),
      "GET /api/v1/users": list,
    });
    renderUsers();
    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith("/configuracion/usuarios?pagina=1", {
        scroll: false,
      }),
    );
    expect(screen.queryByText(/Mostrando 51/)).toBeNull();
  });

  it("el filtro de estado filtra desde la primera página", async () => {
    navigation.search = new URLSearchParams("pagina=1");
    mockApi({
      "GET /api/v1/me": () => ({ status: 200, body: { data: ADMIN_ME } }),
      "GET /api/v1/users": list,
    });
    renderUsers();
    await screen.findByText("Mostrando 1-3 de 3");
    await chooseFilter("Estado", "Desactivados");
    expect(navigation.replace).toHaveBeenCalledWith("/configuracion/usuarios?estado=desactivados", {
      scroll: false,
    });
  });

  it("sin coincidencias ofrece limpiar los filtros", async () => {
    navigation.search = new URLSearchParams("q=nadie");
    mockApi({
      "GET /api/v1/me": () => ({ status: 200, body: { data: ADMIN_ME } }),
      "GET /api/v1/users": () => ({
        status: 200,
        body: { data: [], meta: { page: 1, pageSize: 25, total: 0 } },
      }),
    });
    renderUsers();
    expect((await screen.findAllByText("No hay usuarios que coincidan")).length).toBeGreaterThan(0);
    await userEvent.setup().click(screen.getAllByRole("button", { name: "Limpiar filtros" })[0]!);
    expect(navigation.replace).toHaveBeenCalledWith("/configuracion/usuarios", { scroll: false });
  });

  it("un error al cargar mantiene el marco y ofrece reintentar", async () => {
    mockApi({
      "GET /api/v1/me": () => ({ status: 200, body: { data: ADMIN_ME } }),
      "GET /api/v1/users": () => ({ status: 500, body: errorBody("INTERNAL_ERROR", "x") }),
    });
    renderUsers();
    expect(
      (await screen.findAllByText("No pudimos cargar los usuarios.", {}, { timeout: 5_000 }))
        .length,
    ).toBeGreaterThan(0);
    // El pie solo aparece con filas: nunca «0-0 de 0» (data-tables.md).
    expect(screen.queryByText(/Mostrando/)).toBeNull();
  });

  it("crear usuario: valida, conserva los valores ante un correo en uso y usa Operador por defecto", async () => {
    mockApi({
      "GET /api/v1/me": () => ({ status: 200, body: { data: ADMIN_ME } }),
      "GET /api/v1/users": list,
      "POST /api/v1/users": () => ({
        status: 409,
        body: errorBody("EMAIL_IN_USE", "El correo ya está en uso."),
      }),
    });
    renderUsers();
    await screen.findByText("Mostrando 1-3 de 3");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Crear usuario" }));
    const dialog = await screen.findByRole("dialog", { name: "Crear usuario" });
    expect(
      within(dialog)
        .getByRole("radio", { name: /Operador/ })
        .getAttribute("aria-checked"),
    ).toBe("true");
    await user.click(within(dialog).getByRole("button", { name: "Crear usuario" }));
    expect(await within(dialog).findByText("El nombre es obligatorio.")).toBeDefined();
    await user.type(within(dialog).getByLabelText("Nombre"), "Pedro");
    await user.type(within(dialog).getByLabelText("Correo"), "oscar@empresa.ec");
    await user.type(within(dialog).getByLabelText("Contraseña inicial"), "contrasena-inicial-1");
    await user.click(within(dialog).getByRole("button", { name: "Crear usuario" }));
    expect(await within(dialog).findByText("El correo ya está en uso.")).toBeDefined();
    expect((within(dialog).getByLabelText("Nombre") as HTMLInputElement).value).toBe("Pedro");
  });

  it("desactivar es un paso con aviso que permite deshacer", async () => {
    const calls = mockApi({
      "GET /api/v1/me": () => ({ status: 200, body: { data: ADMIN_ME } }),
      "GET /api/v1/users": list,
      "PUT /api/v1/users/u-oscar/status": (init) => {
        const { status } = JSON.parse(init.body ?? "{}") as { status: string };
        return { status: 200, body: { data: { ...users[1], status } } };
      },
    });
    renderUsers();
    await screen.findByText("Mostrando 1-3 de 3");
    const user = userEvent.setup();
    await user.click(
      within(await openRowActions("Óscar Operador")).getByRole("menuitem", { name: "Desactivar" }),
    );
    expect(
      await screen.findByText("Desactivaste a Óscar Operador. Sus sesiones se cerraron."),
    ).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Deshacer" }));
    expect(await screen.findByText("Reactivaste a Óscar Operador.")).toBeDefined();
    const statusCalls = calls
      .filter((call) => call.key === "PUT /api/v1/users/u-oscar/status")
      .map((call) => call.body);
    expect(statusCalls).toEqual([{ status: "DEACTIVATED" }, { status: "ACTIVE" }]);
    await waitFor(() =>
      expect(
        calls.filter((call) => call.key.startsWith("GET /api/v1/users")).length,
      ).toBeGreaterThan(1),
    );
  });
});
