import { act, screen, waitFor, within } from "@testing-library/react";
import { focusManager } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell, ShellSkeleton } from "@/components/shell/app-shell";
import { SessionGate } from "@/components/session";
import { EnvironmentBanner } from "@/features/company/environment-notice";
import { ShellCompanyContext } from "@/features/company/shell-company-context";
import { ADMIN_ME, OPERATOR_ME, errorBody, mockApi, navigation, renderApp } from "./harness";

const status = (environment: "TEST" | "PRODUCTION") => ({
  status: 200,
  body: {
    data: {
      environment,
      displayName: "Andina",
      readiness: {
        ready: false,
        checks: [
          { key: "TAXPAYER_DATA", status: "MET" },
          { key: "EMISSION_POINT", status: "MET" },
          { key: "SIGNING_CERTIFICATE", status: "PENDING" },
        ],
      },
    },
  },
});

function renderShell() {
  return renderApp(
    <SessionGate fallback={<ShellSkeleton />}>
      <AppShell
        company={<ShellCompanyContext />}
        environment={<EnvironmentBanner />}
        notices={null}
      >
        <p>contenido</p>
      </AppShell>
    </SessionGate>,
  );
}

const banner = () => document.querySelector("[data-slot=environment-banner]");

beforeEach(() => {
  navigation.pathname = "/";
  navigation.search = new URLSearchParams();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// Decisión del propietario sobre la cabecera (2026-10-16): el aviso del ambiente es una franja de
// ancho completo encima de la barra superior, dentro de su bloque fijo.
describe("aviso del ambiente", () => {
  it("en Pruebas, una franja encima de la barra dice que no hay validez tributaria, sin cerrarse", async () => {
    mockApi({
      "GET /api/v1/me": () => ({ status: 200, body: { data: OPERATOR_ME } }),
      "GET /api/v1/company/status": () => status("TEST"),
    });
    renderShell();
    const strip = await screen.findByText(/Estás en el ambiente de Pruebas/);
    const element = strip.closest("[data-slot=environment-banner]") as HTMLElement;
    expect(element.textContent).toContain(
      "los comprobantes que emitas no tienen validez tributaria",
    );
    // Encima de la fila de la barra, dentro del mismo bloque fijo.
    const header = screen.getByRole("banner");
    expect(header.firstElementChild).toBe(element);
    // Texto e icono: el icono es decorativo y el texto lleva la información.
    expect(element.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByRole("button", { name: /cerrar/i })).toBeNull();
    // Un operador no puede cambiar el ambiente: no se le ofrece.
    expect(within(element).queryByRole("link")).toBeNull();
  });

  it("a un administrador le ofrece ir a Configuración › Ambiente", async () => {
    mockApi({
      "GET /api/v1/me": () => ({ status: 200, body: { data: ADMIN_ME } }),
      "GET /api/v1/company/status": () => status("TEST"),
    });
    renderShell();
    await screen.findByText(/Estás en el ambiente de Pruebas/);
    expect(
      within(banner() as HTMLElement)
        .getByRole("link", { name: "Cambiar ambiente" })
        .getAttribute("href"),
    ).toBe("/configuracion/ambiente");
  });

  it("en Producción no hay franja ni indicador", async () => {
    mockApi({
      "GET /api/v1/me": () => ({ status: 200, body: { data: OPERATOR_ME } }),
      "GET /api/v1/company/status": () => status("PRODUCTION"),
    });
    renderShell();
    await screen.findByText("contenido");
    await screen.findByText("Andina");
    expect(banner()).toBeNull();
    expect(screen.queryByText(/Pruebas/)).toBeNull();
  });

  it("ante un error dice que no está confirmado y nunca supone Producción", async () => {
    mockApi({
      "GET /api/v1/me": () => ({ status: 200, body: { data: ADMIN_ME } }),
      "GET /api/v1/company/status": () => ({ status: 503, body: errorBody("X", "Caído") }),
    });
    renderShell();
    expect(
      await screen.findByText("No pudimos confirmar el ambiente.", {}, { timeout: 4000 }),
    ).toBeDefined();
    expect(banner()!.textContent).toContain("Vuelve a cargar la pantalla antes de emitir");
    expect(screen.queryByText(/Producción/)).toBeNull();
  });

  it("al volver a la ventana muestra el ambiente nuevo sin volver a iniciar sesión", async () => {
    let environment: "TEST" | "PRODUCTION" = "TEST";
    mockApi({
      "GET /api/v1/me": () => ({ status: 200, body: { data: OPERATOR_ME } }),
      "GET /api/v1/company/status": () => status(environment),
    });
    renderShell();
    await screen.findByText(/Estás en el ambiente de Pruebas/);
    environment = "PRODUCTION";
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() => expect(banner()).toBeNull());
    focusManager.setFocused(undefined);
  });
});
