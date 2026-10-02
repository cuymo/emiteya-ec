import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionGate } from "@/components/session";
import { AccountScreen } from "@/features/account/account-screen";
import { OPERATOR_ME, mockApi, navigation, renderApp, type Route } from "./harness";

function renderAccount(changePassword: Route) {
  const calls = mockApi({
    "GET /api/v1/me": () => ({ status: 200, body: { data: OPERATOR_ME } }),
    "POST /api/auth/change-password": changePassword,
  });
  renderApp(
    <SessionGate fallback={<p>cargando</p>}>
      <AccountScreen />
    </SessionGate>,
  );
  return calls;
}

async function change(current: string, next: string) {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Contraseña actual"), current);
  await user.type(screen.getByLabelText("Contraseña nueva"), next);
  await user.click(screen.getByRole("button", { name: "Cambiar contraseña" }));
}

beforeEach(() => {
  navigation.pathname = "/mi-cuenta";
  navigation.search = new URLSearchParams();
  navigation.replace.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pantalla Mi cuenta", () => {
  it("muestra nombre, correo y rol como etiquetas de solo lectura", async () => {
    renderAccount(() => ({ status: 200 }));
    expect(await screen.findByText("Óscar Operador")).toBeDefined();
    expect(screen.getByText("oscar@empresa.ec")).toBeDefined();
    expect(screen.getByText("Operador")).toBeDefined();
    expect(screen.queryByRole("textbox", { name: "Nombre" })).toBeNull();
  });

  it("cambia la contraseña pidiendo invalidar las demás sesiones y avisa del cierre", async () => {
    const calls = renderAccount(() => ({ status: 200, body: { token: "t" } }));
    await change("contrasena-actual-1", "contrasena-nueva-12");
    expect(
      await screen.findByText("Cambiaste tu contraseña. Cerramos tus demás sesiones."),
    ).toBeDefined();
    expect(calls.find((call) => call.key === "POST /api/auth/change-password")?.body).toEqual({
      currentPassword: "contrasena-actual-1",
      newPassword: "contrasena-nueva-12",
      revokeOtherSessions: true,
    });
    await waitFor(() =>
      expect((screen.getByLabelText("Contraseña actual") as HTMLInputElement).value).toBe(""),
    );
  });

  it("una contraseña actual incorrecta se indica junto al campo", async () => {
    renderAccount(() => ({
      status: 400,
      body: { code: "INVALID_PASSWORD", message: "Invalid password" },
    }));
    await change("incorrecta-1", "contrasena-nueva-12");
    expect(await screen.findByText("La contraseña actual no es correcta.")).toBeDefined();
  });

  it("la longitud la valida el servidor y su mensaje indica el valor vigente", async () => {
    renderAccount(() => ({
      status: 400,
      body: {
        code: "PASSWORD_POLICY",
        message: "La contraseña debe tener al menos 16 caracteres.",
      },
    }));
    await change("contrasena-actual-1", "contrasena-15ch");
    expect(
      await screen.findByText("La contraseña debe tener al menos 16 caracteres."),
    ).toBeDefined();
    expect(screen.queryByText(/12 y 128/)).toBeNull();
  });

  it("solo exige que los campos no estén vacíos antes de enviar", async () => {
    const calls = renderAccount(() => ({ status: 200 }));
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Cambiar contraseña" }));
    expect(await screen.findByText("Escribe tu contraseña actual.")).toBeDefined();
    expect(calls.some((call) => call.key.includes("change-password"))).toBe(false);
  });

  it("si la sesión ya no es válida lleva al inicio de sesión con el aviso de sesión vencida", async () => {
    renderAccount(() => ({ status: 401, body: { code: "UNAUTHORIZED", message: "Unauthorized" } }));
    await change("contrasena-actual-1", "contrasena-nueva-12");
    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith(
        "/iniciar-sesion?siguiente=%2Fmi-cuenta&motivo=sesion",
      ),
    );
  });
});
