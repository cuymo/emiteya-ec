import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { focusManager } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell, ShellSkeleton } from "@/components/shell/app-shell";
import { SessionGate } from "@/components/session";
import { EnvironmentIndicator } from "@/features/company/environment-notice";
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
        environment={<EnvironmentIndicator />}
        notices={null}
      >
        <p>contenido</p>
      </AppShell>
    </SessionGate>,
  );
}

const TEST_NOTICE = "Ambiente de Pruebas: los comprobantes no tienen validez tributaria";

beforeEach(() => {
  navigation.pathname = "/";
  navigation.search = new URLSearchParams();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// productize-invoice-editor-and-composition-foundation, design D21: el indicador compacto de la
// barra superior es el aviso persistente del ambiente; ya no hay franja de ancho completo.
describe("indicador del ambiente (design D21)", () => {
  for (const me of [ADMIN_ME, OPERATOR_ME]) {
    it(`en Pruebas, ${me.role} ve «Pruebas» con advertencia, sin forma de cerrarlo ni franja`, async () => {
      mockApi({
        "GET /api/v1/me": () => ({ status: 200, body: { data: me } }),
        "GET /api/v1/company/status": () => status("TEST"),
      });
      renderShell();
      const indicator = await screen.findByRole("button", { name: TEST_NOTICE });
      expect(indicator.textContent).toBe("Pruebas");
      expect(indicator.getAttribute("data-slot")).toBe("environment-indicator");
      // Texto e icono: el icono es decorativo y el texto lleva la información.
      expect(indicator.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
      expect(screen.queryByRole("button", { name: /cerrar/i })).toBeNull();
      expect(screen.queryByText(/los comprobantes no tienen validez tributaria\./)).toBeNull();
      expect(document.querySelector("[role=status] svg")).toBeNull();
    });
  }

  it("lo explica al llegar con el teclado, sin quitarle el foco", async () => {
    mockApi({
      "GET /api/v1/me": () => ({ status: 200, body: { data: OPERATOR_ME } }),
      "GET /api/v1/company/status": () => status("TEST"),
    });
    renderShell();
    const indicator = await screen.findByRole("button", { name: TEST_NOTICE });
    act(() => indicator.focus());
    const explanation = await screen.findByRole("dialog", { name: "Ambiente de Pruebas" });
    expect(explanation.textContent).toContain("no tienen validez tributaria");
    expect(explanation.textContent).toContain("Configuración › Ambiente");
    expect(document.activeElement).toBe(indicator);
    act(() => indicator.blur());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("lo explica al señalarlo con el ratón y al tocarlo, y se cierra con Escape", async () => {
    mockApi({
      "GET /api/v1/me": () => ({ status: 200, body: { data: OPERATOR_ME } }),
      "GET /api/v1/company/status": () => status("TEST"),
    });
    renderShell();
    const indicator = await screen.findByRole("button", { name: TEST_NOTICE });
    fireEvent.pointerEnter(indicator, { pointerType: "mouse" });
    expect(await screen.findByRole("dialog", { name: "Ambiente de Pruebas" })).toBeDefined();
    fireEvent.pointerLeave(indicator, { pointerType: "mouse" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const user = userEvent.setup();
    await user.click(indicator);
    expect(await screen.findByRole("dialog", { name: "Ambiente de Pruebas" })).toBeDefined();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("en Producción no hay indicador de Pruebas, sino el de Producción con texto e icono", async () => {
    mockApi({
      "GET /api/v1/me": () => ({ status: 200, body: { data: OPERATOR_ME } }),
      "GET /api/v1/company/status": () => status("PRODUCTION"),
    });
    renderShell();
    const badge = (await screen.findByText("Producción")).closest(
      "[data-slot=environment-indicator]",
    )!;
    expect(badge.textContent).toBe("Ambiente de Producción");
    expect(badge.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByRole("button", { name: TEST_NOTICE })).toBeNull();
  });

  it("Producción es contexto, no un resultado: neutro, sin la variante de éxito", async () => {
    mockApi({
      "GET /api/v1/me": () => ({ status: 200, body: { data: ADMIN_ME } }),
      "GET /api/v1/company/status": () => status("PRODUCTION"),
    });
    renderShell();
    const badge = (await screen.findByText("Producción")).closest(
      "[data-slot=environment-indicator]",
    )!;
    expect(badge.getAttribute("data-variant")).toBe("emphasis");
    expect(badge.getAttribute("data-variant")).not.toBe("success");
  });

  for (const environment of ["TEST", "PRODUCTION"] as const) {
    it(`el indicador de ${environment} no se oculta en pantallas estrechas`, async () => {
      mockApi({
        "GET /api/v1/me": () => ({ status: 200, body: { data: ADMIN_ME } }),
        "GET /api/v1/company/status": () => status(environment),
      });
      renderShell();
      const label = environment === "TEST" ? "Pruebas" : "Producción";
      const indicator = (await screen.findByText(label)).closest(
        "[data-slot=environment-indicator]",
      )!;
      expect(indicator.className.split(/\s+/)).not.toContain("hidden");
    });
  }

  it("ante un error dice que no está confirmado y nunca supone Producción", async () => {
    mockApi({
      "GET /api/v1/me": () => ({ status: 200, body: { data: ADMIN_ME } }),
      "GET /api/v1/company/status": () => ({ status: 503, body: errorBody("X", "Caído") }),
    });
    renderShell();
    const indicator = await screen.findByRole(
      "button",
      { name: /Ambiente sin confirmar: no pudimos confirmar el ambiente/ },
      { timeout: 4000 },
    );
    expect(indicator.textContent).toBe("Sin confirmar");
    expect(indicator.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByText("Producción")).toBeNull();
  });

  it("al volver a la ventana muestra el ambiente nuevo sin volver a iniciar sesión", async () => {
    let environment: "TEST" | "PRODUCTION" = "TEST";
    mockApi({
      "GET /api/v1/me": () => ({ status: 200, body: { data: OPERATOR_ME } }),
      "GET /api/v1/company/status": () => status(environment),
    });
    renderShell();
    await screen.findByRole("button", { name: TEST_NOTICE });
    environment = "PRODUCTION";
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() => expect(screen.queryByRole("button", { name: TEST_NOTICE })).toBeNull());
    expect(screen.getByText("Producción")).toBeDefined();
    focusManager.setFocused(undefined);
  });
});
