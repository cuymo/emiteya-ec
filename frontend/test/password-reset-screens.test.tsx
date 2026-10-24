// Recuperar la contraseña y poner una nueva (add-password-reset-by-email, design D2 y D6): la misma
// respuesta exista o no la cuenta, el token leído del fragmento y quitado de la dirección, la
// política de contraseñas del servidor junto a su campo y el enlace vencido que ofrece pedir otro.
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ForgotPasswordScreen } from "@/features/auth/forgot-password-screen";
import {
  ResetPasswordScreen,
  forgetCapturedToken,
  tokenFromHash,
} from "@/features/auth/reset-password-screen";
import { mockApi, renderApp } from "./harness";

const ok = () => ({ status: 200, body: { status: true } });

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("recuperar la contraseña", () => {
  it("envía el correo y muestra siempre la misma respuesta, con el vencimiento", async () => {
    const calls = mockApi({ "POST /api/auth/request-password-reset": ok });
    const user = userEvent.setup();
    renderApp(<ForgotPasswordScreen />);
    expect(screen.getByRole("heading", { name: "Recuperar tu contraseña" })).toBeDefined();
    await user.type(screen.getByLabelText("Correo"), " ana@empresa.ec ");
    await user.click(screen.getByRole("button", { name: "Enviar enlace" }));
    expect(await screen.findByRole("heading", { name: "Revisa tu correo" })).toBeDefined();
    expect(screen.getByRole("status").textContent).toContain("Vence en 30 minutos");
    expect(screen.getByRole("status").textContent).toContain("administrador");
    const sent = calls.find((call) => call.key === "POST /api/auth/request-password-reset");
    expect(sent?.body).toEqual({ email: "ana@empresa.ec" });
    expect(
      screen.getAllByRole("link", { name: "Volver a iniciar sesión" })[0]!.getAttribute("href"),
    ).toBe("/iniciar-sesion");
  });

  it("valida el correo antes de enviar", async () => {
    const calls = mockApi({ "POST /api/auth/request-password-reset": ok });
    const user = userEvent.setup();
    renderApp(<ForgotPasswordScreen />);
    await user.click(screen.getByRole("button", { name: "Enviar enlace" }));
    expect(await screen.findByText("Escribe tu correo.")).toBeDefined();
    expect(calls.some((call) => call.key.includes("request-password-reset"))).toBe(false);
  });

  it("el límite de intentos se explica sin revelar la cuenta", async () => {
    mockApi({
      "POST /api/auth/request-password-reset": () => ({ status: 429, body: { code: "TOO_MANY" } }),
    });
    const user = userEvent.setup();
    renderApp(<ForgotPasswordScreen />);
    await user.type(screen.getByLabelText("Correo"), "ana@empresa.ec");
    await user.click(screen.getByRole("button", { name: "Enviar enlace" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Demasiados intentos");
  });
});

describe("poner una contraseña nueva", () => {
  beforeEach(() => forgetCapturedToken());

  it("lee el token del fragmento", () => {
    expect(tokenFromHash("#token=abc%2Bdef")).toBe("abc+def");
    expect(tokenFromHash("")).toBeNull();
    expect(tokenFromHash("#otra=1")).toBeNull();
  });

  it("usa el token del enlace, lo quita de la dirección y avisa que cerró las sesiones", async () => {
    window.history.replaceState(null, "", "/restablecer-contrasena#token=tok-123");
    const calls = mockApi({ "POST /api/auth/reset-password": ok });
    const user = userEvent.setup();
    renderApp(<ResetPasswordScreen />);
    expect(
      await screen.findByRole("heading", { name: "Poner una contraseña nueva" }),
    ).toBeDefined();
    expect(window.location.hash).toBe("");
    await user.type(screen.getByLabelText("Contraseña nueva"), "contrasena-nueva-1");
    await user.type(screen.getByLabelText("Repite la contraseña nueva"), "contrasena-nueva-1");
    await user.click(screen.getByRole("button", { name: "Guardar contraseña" }));
    expect(await screen.findByRole("heading", { name: "Tu contraseña cambió" })).toBeDefined();
    expect(screen.getByRole("status").textContent).toContain("Cerramos las sesiones abiertas");
    const sent = calls.find((call) => call.key === "POST /api/auth/reset-password");
    expect(sent?.body).toEqual({ token: "tok-123", newPassword: "contrasena-nueva-1" });
  });

  it("las contraseñas deben coincidir, y la política del servidor va junto a su campo", async () => {
    window.history.replaceState(null, "", "/restablecer-contrasena#token=tok-123");
    mockApi({
      "POST /api/auth/reset-password": () => ({
        status: 400,
        body: { code: "PASSWORD_POLICY", message: "La contraseña tiene al menos 12 caracteres." },
      }),
    });
    const user = userEvent.setup();
    renderApp(<ResetPasswordScreen />);
    await screen.findByRole("heading", { name: "Poner una contraseña nueva" });
    await user.type(screen.getByLabelText("Contraseña nueva"), "corta");
    await user.type(screen.getByLabelText("Repite la contraseña nueva"), "otra");
    await user.click(screen.getByRole("button", { name: "Guardar contraseña" }));
    expect(await screen.findByText("Las contraseñas no coinciden.")).toBeDefined();
    await user.clear(screen.getByLabelText("Repite la contraseña nueva"));
    await user.type(screen.getByLabelText("Repite la contraseña nueva"), "corta");
    await user.click(screen.getByRole("button", { name: "Guardar contraseña" }));
    expect(await screen.findByText("La contraseña tiene al menos 12 caracteres.")).toBeDefined();
  });

  it("un enlace vencido o usado ofrece pedir otro", async () => {
    window.history.replaceState(null, "", "/restablecer-contrasena#token=usado");
    mockApi({
      "POST /api/auth/reset-password": () => ({ status: 400, body: { code: "INVALID_TOKEN" } }),
    });
    const user = userEvent.setup();
    renderApp(<ResetPasswordScreen />);
    await screen.findByRole("heading", { name: "Poner una contraseña nueva" });
    await user.type(screen.getByLabelText("Contraseña nueva"), "contrasena-nueva-1");
    await user.type(screen.getByLabelText("Repite la contraseña nueva"), "contrasena-nueva-1");
    await user.click(screen.getByRole("button", { name: "Guardar contraseña" }));
    expect(await screen.findByRole("heading", { name: "El enlace ya no sirve" })).toBeDefined();
    expect(screen.getByRole("link", { name: "Pedir otro enlace" }).getAttribute("href")).toBe(
      "/recuperar-contrasena",
    );
  });

  it("sin token en la dirección, explica que el enlace ya no sirve", async () => {
    window.history.replaceState(null, "", "/restablecer-contrasena");
    mockApi({});
    renderApp(<ResetPasswordScreen />);
    expect(await screen.findByRole("heading", { name: "El enlace ya no sirve" })).toBeDefined();
  });
});
