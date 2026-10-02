import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell, ShellSkeleton } from "@/components/app-shell";
import { SessionGate } from "@/components/session";
import { ADMIN_ME, OPERATOR_ME, errorBody, mockApi, navigation, renderApp } from "./harness";

function renderShell() {
  return renderApp(
    <SessionGate fallback={<ShellSkeleton />}>
      <AppShell>
        <p>contenido</p>
      </AppShell>
    </SessionGate>,
  );
}

beforeEach(() => {
  navigation.pathname = "/configuracion/usuarios";
  navigation.search = new URLSearchParams("q=ana");
  navigation.replace.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("shell autenticado", () => {
  it("verifica la sesión sin pantalla en blanco y luego muestra cabecera, contenido y enlace para saltar", async () => {
    mockApi({ "GET /api/v1/me": () => ({ status: 200, body: { data: ADMIN_ME } }) });
    renderShell();
    expect(screen.getByRole("status").textContent).toContain("Verificando la sesión");
    await screen.findByText("contenido");
    expect(screen.getByRole("main").textContent).toContain("contenido");
    expect(screen.getByRole("link", { name: "Saltar al contenido" }).getAttribute("href")).toBe(
      "#contenido",
    );
    expect(screen.getByRole("button", { name: "Cuenta de Ana Admin" })).toBeDefined();
  });

  it("el administrador ve el destino Usuarios en Configuración, marcado como actual", async () => {
    mockApi({ "GET /api/v1/me": () => ({ status: 200, body: { data: ADMIN_ME } }) });
    renderShell();
    const link = await screen.findByRole("link", { name: "Usuarios" });
    expect(link.getAttribute("href")).toBe("/configuracion/usuarios");
    expect(link.getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("Configuración")).toBeDefined();
  });

  it("el administrador ve Empresa, Ambiente, Establecimientos y Secuenciales en Configuración", async () => {
    mockApi({ "GET /api/v1/me": () => ({ status: 200, body: { data: ADMIN_ME } }) });
    renderShell();
    expect((await screen.findByRole("link", { name: "Empresa" })).getAttribute("href")).toBe(
      "/configuracion/empresa",
    );
    expect(screen.getByRole("link", { name: "Ambiente" }).getAttribute("href")).toBe(
      "/configuracion/ambiente",
    );
    expect(screen.getByRole("link", { name: "Establecimientos" }).getAttribute("href")).toBe(
      "/configuracion/establecimientos",
    );
    expect(screen.getByRole("link", { name: "Secuenciales" }).getAttribute("href")).toBe(
      "/configuracion/secuenciales",
    );
  });

  it("el operador no ve el destino Usuarios", async () => {
    mockApi({ "GET /api/v1/me": () => ({ status: 200, body: { data: OPERATOR_ME } }) });
    renderShell();
    await screen.findByText("contenido");
    expect(screen.queryByRole("link", { name: "Usuarios" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Empresa" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Ambiente" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Establecimientos" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Secuenciales" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Abrir menú" })).toBeNull();
  });

  it("sin sesión lleva al inicio de sesión conservando la URL, sin aviso de sesión vencida", async () => {
    mockApi({
      "GET /api/v1/me": () => ({
        status: 401,
        body: errorBody("UNAUTHENTICATED", "Inicia sesión para continuar."),
      }),
    });
    renderShell();
    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith(
        "/iniciar-sesion?siguiente=%2Fconfiguracion%2Fusuarios%3Fq%3Dana",
      ),
    );
    expect(screen.queryByText("contenido")).toBeNull();
  });

  it("un fallo distinto de 401 al cargar la cuenta ofrece reintentar", async () => {
    let calls = 0;
    mockApi({
      "GET /api/v1/me": () =>
        ++calls === 1
          ? { status: 503, body: errorBody("UNAVAILABLE", "x") }
          : { status: 200, body: { data: ADMIN_ME } },
    });
    renderShell();
    const retry = await screen.findByRole(
      "button",
      { name: "Intentar de nuevo" },
      { timeout: 5_000 },
    );
    fireEvent.click(retry);
    await screen.findByText("contenido");
  });

  it("el selector cambia entre tema oscuro y claro, también con las flechas", async () => {
    mockApi({ "GET /api/v1/me": () => ({ status: 200, body: { data: ADMIN_ME } }) });
    renderShell();
    const dark = await screen.findByRole("radio", { name: "Oscuro" });
    await act(async () => {
      fireEvent.click(dark);
    });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "Claro" }));
    });
    await act(async () => {
      fireEvent.keyDown(screen.getByRole("radiogroup", { name: "Tema" }), { key: "ArrowRight" });
    });
    expect(screen.getByRole("radio", { name: "Oscuro" }).getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Oscuro" }));
  });
});
