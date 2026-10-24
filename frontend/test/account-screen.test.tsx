import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionGate } from "@/components/session";
import { AccountScreen } from "@/features/account/account-screen";
import { OPERATOR_ME, errorBody, mockApi, navigation, renderApp, type Route } from "./harness";

const PROFILE = {
  name: OPERATOR_ME.name,
  email: OPERATOR_ME.email,
  role: "OPERATOR",
  membershipStatus: "ACTIVE",
  memberSince: "2026-10-01T15:00:00.000Z",
  avatar: null,
  avatarMaxBytes: 524288,
};

function renderAccount(changePassword: Route, routes: Record<string, Route> = {}) {
  const calls = mockApi({
    "GET /api/v1/me": () => ({ status: 200, body: { data: OPERATOR_ME } }),
    "GET /api/v1/me/profile": () => ({ status: 200, body: { data: PROFILE } }),
    "GET /api/v1/company/status": () => ({
      status: 200,
      body: {
        data: {
          environment: "TEST",
          displayName: "Ferretería Andina",
          readiness: { ready: true, checks: [] },
        },
      },
    }),
    "POST /api/auth/change-password": changePassword,
    ...routes,
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
  // La mayoría de las pruebas son del cambio de contraseña, en su pestaña.
  navigation.search = new URLSearchParams("pestana=contrasena");
  navigation.replace.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pantalla Mi cuenta", () => {
  it("la cabecera lleva el nombre, el correo y las insignias de la cuenta (design D8)", async () => {
    navigation.search = new URLSearchParams();
    renderAccount(() => ({ status: 200 }));
    expect(await screen.findByRole("heading", { level: 1, name: "Óscar Operador" })).toBeDefined();
    const badges = await screen.findByRole("list", { name: "Datos de la cuenta" });
    await waitFor(() =>
      expect(Array.from(badges.querySelectorAll("li")).map((item) => item.textContent)).toEqual([
        "Operador",
        "Activa",
        "Ferretería Andina",
        "Cuenta desde octubre de 2026",
      ]),
    );
  });

  it("las pestañas son Datos, Cambiar contraseña y Establecimiento predeterminado, en la dirección", async () => {
    navigation.search = new URLSearchParams();
    const user = userEvent.setup();
    renderAccount(() => ({ status: 200 }));
    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Datos",
      "Cambiar contraseña",
      "Establecimiento predeterminado",
    ]);
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
    tabs[0]!.focus();
    await user.keyboard("{ArrowRight}");
    await waitFor(() => expect(tabs[1]!.getAttribute("aria-selected")).toBe("true"));
    expect(navigation.replace).toHaveBeenLastCalledWith("/mi-cuenta?pestana=contrasena", {
      scroll: false,
    });
    expect(await screen.findByLabelText("Contraseña actual")).toBeDefined();
  });

  it("en Datos, el nombre se edita y el correo, el rol y la empresa son de solo lectura", async () => {
    navigation.search = new URLSearchParams();
    const calls = renderAccount(() => ({ status: 200 }), {
      "PUT /api/v1/me/name": () => ({
        status: 200,
        body: { data: { ...PROFILE, name: "Óscar Ortega" } },
      }),
    });
    const user = userEvent.setup();
    const name = await screen.findByRole("textbox", { name: "Nombre" });
    await waitFor(() => expect((name as HTMLInputElement).value).toBe("Óscar Operador"));
    expect(screen.getByRole("button", { name: "Guardar nombre" })).toHaveProperty("disabled", true);
    expect(
      screen.getByText("Es tu usuario para iniciar sesión; por ahora no se puede cambiar."),
    ).toBeDefined();
    await user.clear(name);
    await user.type(name, "Óscar Ortega");
    await user.click(screen.getByRole("button", { name: "Guardar nombre" }));
    expect(await screen.findByText("Actualizaste tu nombre.")).toBeDefined();
    expect(calls.find((call) => call.key === "PUT /api/v1/me/name")?.body).toEqual({
      name: "Óscar Ortega",
    });
    // La sesión se vuelve a leer: la barra superior y el menú muestran el nombre nuevo.
    await waitFor(() =>
      expect(calls.filter((call) => call.key === "GET /api/v1/me").length).toBeGreaterThan(1),
    );
  });

  it("un nombre rechazado por el servidor se indica junto al campo", async () => {
    navigation.search = new URLSearchParams();
    renderAccount(() => ({ status: 200 }), {
      "PUT /api/v1/me/name": () => ({
        status: 400,
        body: errorBody("VALIDATION_ERROR", "El nombre no puede tener saltos de línea."),
      }),
    });
    const user = userEvent.setup();
    const name = await screen.findByRole("textbox", { name: "Nombre" });
    await waitFor(() => expect((name as HTMLInputElement).value).toBe("Óscar Operador"));
    await user.type(name, " B");
    await user.click(screen.getByRole("button", { name: "Guardar nombre" }));
    expect(await screen.findByText("El nombre no puede tener saltos de línea.")).toBeDefined();
  });

  it("si el perfil no carga, ofrece reintentar sin perder la página", async () => {
    navigation.search = new URLSearchParams();
    renderAccount(() => ({ status: 200 }), {
      "GET /api/v1/me/profile": () => ({ status: 500, body: errorBody("INTERNAL", "x") }),
    });
    expect(
      await screen.findByRole("button", { name: "Intentar de nuevo" }, { timeout: 5_000 }),
    ).toBeDefined();
    expect(screen.getByRole("heading", { level: 1, name: "Óscar Operador" })).toBeDefined();
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
        // Vuelve a la misma pestaña al iniciar sesión otra vez.
        "/iniciar-sesion?siguiente=%2Fmi-cuenta%3Fpestana%3Dcontrasena&motivo=sesion",
      ),
    );
  });
});
