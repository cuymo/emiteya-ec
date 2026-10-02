import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginScreen } from "@/features/auth/login-screen";
import { safeNextPath } from "@/lib/auth-client";
import { ADMIN_ME, errorBody, mockApi, navigation, renderApp } from "./harness";

const unauthenticated = () => ({
  status: 401,
  body: errorBody("UNAUTHENTICATED", "Inicia sesión para continuar."),
});

beforeEach(() => {
  navigation.search = new URLSearchParams("siguiente=/configuracion/usuarios");
  navigation.replace.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function submit(email: string, password: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Correo"), email);
  await user.type(screen.getByLabelText("Contraseña"), password);
  await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));
}

describe("pantalla Iniciar sesión", () => {
  it("indica que un administrador restablece la contraseña, sin recuperación por correo", () => {
    mockApi({ "GET /api/v1/me": unauthenticated });
    renderApp(<LoginScreen />);
    expect(
      screen.getByText("¿Olvidaste tu contraseña? Pide a un administrador que la restablezca."),
    ).toBeDefined();
    expect(screen.getByRole("heading", { name: "Iniciar sesión" })).toBeDefined();
    expect(screen.getByLabelText("Correo").getAttribute("autocomplete")).toBe("username");
    expect(screen.getByLabelText("Contraseña").getAttribute("autocomplete")).toBe(
      "current-password",
    );
  });

  it("valida los campos antes de enviar", async () => {
    const calls = mockApi({ "GET /api/v1/me": unauthenticated });
    renderApp(<LoginScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }));
    expect(await screen.findByText("Escribe tu correo.")).toBeDefined();
    expect(calls.some((call) => call.key.includes("sign-in"))).toBe(false);
  });

  it("muestra el mensaje genérico ante credenciales incorrectas y limpia la contraseña", async () => {
    mockApi({
      "GET /api/v1/me": unauthenticated,
      "POST /api/auth/sign-in/email": () => ({
        status: 401,
        body: { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" },
      }),
    });
    renderApp(<LoginScreen />);
    await submit("ana@empresa.ec", "incorrecta-123");
    expect((await screen.findByRole("alert")).textContent).toBe(
      "El correo o la contraseña no son correctos.",
    );
    expect((screen.getByLabelText("Contraseña") as HTMLInputElement).value).toBe("");
  });

  it("explica el límite de intentos", async () => {
    mockApi({
      "GET /api/v1/me": unauthenticated,
      "POST /api/auth/sign-in/email": () => ({
        status: 429,
        body: { message: "Too many requests" },
      }),
    });
    renderApp(<LoginScreen />);
    await submit("ana@empresa.ec", "contrasena-1");
    expect((await screen.findByRole("alert")).textContent).toContain("Demasiados intentos");
  });

  it("tras iniciar sesión vuelve a la URL de origen", async () => {
    let signedIn = false;
    mockApi({
      "GET /api/v1/me": () =>
        signedIn ? { status: 200, body: { data: ADMIN_ME } } : unauthenticated(),
      "POST /api/auth/sign-in/email": () => {
        signedIn = true;
        return { status: 200, body: { token: "t" } };
      },
    });
    renderApp(<LoginScreen />);
    await submit("ana@empresa.ec", "contrasena-1");
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/configuracion/usuarios"));
  });

  it("con una sesión activa redirige sin pedir credenciales", async () => {
    mockApi({ "GET /api/v1/me": () => ({ status: 200, body: { data: ADMIN_ME } }) });
    renderApp(<LoginScreen />);
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/configuracion/usuarios"));
  });

  it("tras una sesión vencida muestra 'Tu sesión terminó'", () => {
    navigation.search = new URLSearchParams("siguiente=/mi-cuenta&motivo=sesion");
    mockApi({ "GET /api/v1/me": unauthenticated });
    renderApp(<LoginScreen />);
    expect(screen.getByRole("status").textContent).toContain("Tu sesión terminó");
  });

  it("permite pegar la contraseña y mostrarla", async () => {
    mockApi({ "GET /api/v1/me": unauthenticated });
    renderApp(<LoginScreen />);
    const user = userEvent.setup();
    const field = screen.getByLabelText("Contraseña") as HTMLInputElement;
    await user.click(field);
    await user.paste("pegada-desde-el-gestor");
    expect(field.value).toBe("pegada-desde-el-gestor");
    await user.click(screen.getByRole("button", { name: "Mostrar contraseña" }));
    expect(field.type).toBe("text");
  });
});

describe("ruta de regreso segura", () => {
  it("acepta rutas internas y rechaza otros orígenes", () => {
    expect(safeNextPath("/configuracion/usuarios?q=a")).toBe("/configuracion/usuarios?q=a");
    expect(safeNextPath("//malicioso.example")).toBe("/");
    expect(safeNextPath("/\\malicioso.example")).toBe("/");
    expect(safeNextPath("https://malicioso.example")).toBe("/");
    expect(safeNextPath("/iniciar-sesion")).toBe("/");
    expect(safeNextPath(null)).toBe("/");
  });
});
