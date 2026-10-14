import { act, screen, waitFor } from "@testing-library/react";
import { focusManager } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell, ShellSkeleton } from "@/components/shell/app-shell";
import { SessionGate } from "@/components/session";
import { EnvironmentBadge, EnvironmentNotice } from "@/features/company/environment-notice";
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
        environment={<EnvironmentBadge />}
        notices={<EnvironmentNotice />}
      >
        <p>contenido</p>
      </AppShell>
    </SessionGate>,
  );
}

const TEST_NOTICE = "Ambiente de Pruebas: los comprobantes no tienen validez tributaria.";

beforeEach(() => {
  navigation.pathname = "/";
  navigation.search = new URLSearchParams();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("aviso de ambiente (design D6)", () => {
  for (const me of [ADMIN_ME, OPERATOR_ME]) {
    it(`en Pruebas, ${me.role} ve la franja persistente y el distintivo, sin forma de cerrarla`, async () => {
      mockApi({
        "GET /api/v1/me": () => ({ status: 200, body: { data: me } }),
        "GET /api/v1/company/status": () => status("TEST"),
      });
      renderShell();
      const notice = await screen.findByText(TEST_NOTICE);
      const strip = notice.closest("[role=status]") as HTMLElement;
      expect(strip).not.toBeNull();
      // El icono de advertencia es decorativo: oculto a tecnologías asistivas, no interactivo, y
      // el texto lleva toda la información (excepción de contraste en ui-review.md).
      expect(strip.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
      expect(strip.querySelectorAll("button, a, input, [tabindex]")).toHaveLength(0);
      // El distintivo es el `Badge` derivado: el texto y el icono decorativo viven en el mismo elemento.
      const badge = screen.getByText("Pruebas").closest("[data-slot=badge]") as HTMLElement;
      expect(badge.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
      expect(screen.getByText("Pruebas")).toBeDefined();
      expect(screen.queryByRole("button", { name: /cerrar/i })).toBeNull();
    });
  }

  it("en Producción no hay franja y el distintivo indica Producción", async () => {
    mockApi({
      "GET /api/v1/me": () => ({ status: 200, body: { data: OPERATOR_ME } }),
      "GET /api/v1/company/status": () => status("PRODUCTION"),
    });
    renderShell();
    await screen.findByText("Producción");
    expect(screen.queryByText(TEST_NOTICE)).toBeNull();
    // Corrección del control de calidad UX (design D27): ya no hay línea móvil de Producción,
    // porque el distintivo se ve a todas las anchuras.
    expect(screen.queryByText("Ambiente de Producción")).toBeNull();
  });

  it("Producción es contexto, no un resultado: distintivo neutro, sin la variante de éxito", async () => {
    mockApi({
      "GET /api/v1/me": () => ({ status: 200, body: { data: ADMIN_ME } }),
      "GET /api/v1/company/status": () => status("PRODUCTION"),
    });
    renderShell();
    const badge = (await screen.findByText("Producción")).closest("[data-slot=badge]")!;
    expect(badge.getAttribute("data-variant")).toBe("emphasis");
    expect(badge.getAttribute("data-variant")).not.toBe("success");
    expect(badge.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  for (const environment of ["TEST", "PRODUCTION"] as const) {
    it(`el distintivo de ${environment} no se oculta en pantallas estrechas`, async () => {
      // Antes llevaba `hidden sm:inline-flex`; ahora se ve a todas las anchuras (design D27). El
      // harness del navegador comprueba además que sigue visible al desplazar en un teléfono.
      mockApi({
        "GET /api/v1/me": () => ({ status: 200, body: { data: ADMIN_ME } }),
        "GET /api/v1/company/status": () => status(environment),
      });
      renderShell();
      const label = environment === "TEST" ? "Pruebas" : "Producción";
      const badge = (await screen.findByText(label)).closest("[data-slot=badge]")!;
      expect(badge.className.split(/\s+/)).not.toContain("hidden");
    });
  }

  it("ante un error no supone Producción", async () => {
    mockApi({
      "GET /api/v1/me": () => ({ status: 200, body: { data: ADMIN_ME } }),
      "GET /api/v1/company/status": () => ({ status: 503, body: errorBody("X", "Caído") }),
    });
    renderShell();
    expect(await screen.findByText(/Ambiente desconocido/, {}, { timeout: 4000 })).toBeDefined();
    expect(screen.queryByText("Producción")).toBeNull();
  });

  it("al volver a la ventana muestra el ambiente nuevo sin volver a iniciar sesión", async () => {
    let environment: "TEST" | "PRODUCTION" = "TEST";
    mockApi({
      "GET /api/v1/me": () => ({ status: 200, body: { data: OPERATOR_ME } }),
      "GET /api/v1/company/status": () => status(environment),
    });
    renderShell();
    await screen.findByText(TEST_NOTICE);
    environment = "PRODUCTION";
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() => expect(screen.queryByText(TEST_NOTICE)).toBeNull());
    expect(screen.getByText("Producción")).toBeDefined();
    focusManager.setFocused(undefined);
  });
});
