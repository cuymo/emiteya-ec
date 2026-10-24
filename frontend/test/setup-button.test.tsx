// «Falta configurar» en la barra superior y la página «Primeros pasos» (redesign-dashboard-indicators,
// tarea 4.1): el botón con el número de pendientes solo mientras la empresa no pueda emitir, y la
// página con los requisitos y el enlace a resolverlos según el rol.
import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionGate } from "@/components/session";
import { ReadinessScreen } from "@/features/home/readiness-screen";
import { ADMIN_ME, OPERATOR_ME, mockApi, navigation, renderApp } from "./harness";
import { api, renderShell } from "./shell-harness";

const status = (pending: readonly string[]) => ({
  status: 200,
  body: {
    data: {
      environment: "TEST",
      displayName: "Ferretería Andina",
      readiness: {
        ready: pending.length === 0,
        checks: ["TAXPAYER_DATA", "EMISSION_POINT", "SIGNING_CERTIFICATE"].map((key) => ({
          key,
          status: pending.includes(key) ? "PENDING" : "MET",
        })),
      },
    },
  },
});

beforeEach(() => {
  navigation.pathname = "/facturas";
  window.localStorage.setItem(`emiteya.recorrido.v1:${ADMIN_ME.email}`, "visto");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("«Falta configurar» en la barra superior", () => {
  it("con requisitos pendientes lleva a Primeros pasos y dice cuántos faltan", async () => {
    api({ routes: { "GET /api/v1/company/status": () => status(["SIGNING_CERTIFICATE"]) } });
    renderShell();
    const link = await screen.findByRole("link", {
      name: "Falta configurar: 1 requisito pendiente para emitir",
    });
    expect(link.getAttribute("href")).toBe("/primeros-pasos");
    expect(link.closest("header")).not.toBeNull();
    expect(link.textContent).toContain("Falta configurar");
    expect(link.textContent).toContain("1");
  });

  it("con la empresa lista no se muestra", async () => {
    api({ routes: { "GET /api/v1/company/status": () => status([]) } });
    renderShell();
    await screen.findByText("contenido");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole("link", { name: /Falta configurar/ })).toBeNull();
  });
});

describe("página Primeros pasos", () => {
  function render(me: typeof ADMIN_ME | typeof OPERATOR_ME, pending: readonly string[]) {
    mockApi({
      "GET /api/v1/me": () => ({ status: 200, body: { data: me } }),
      "GET /api/v1/company/status": () => status(pending),
    });
    renderApp(
      <SessionGate fallback={<p>cargando</p>}>
        <ReadinessScreen />
      </SessionGate>,
    );
  }

  it("el administrador ve lo que falta con el enlace para resolverlo", async () => {
    navigation.pathname = "/primeros-pasos";
    render(ADMIN_ME, ["SIGNING_CERTIFICATE"]);
    expect(await screen.findByRole("heading", { level: 1, name: "Primeros pasos" })).toBeDefined();
    const list = await screen.findByRole("list", { name: "Requisitos" });
    expect(within(list).getByText(/Firma electrónica/)).toBeDefined();
    expect(screen.getByText("Aún no puede emitir")).toBeDefined();
    await waitFor(() =>
      expect(screen.getAllByRole("link").map((link) => link.getAttribute("href"))).toContain(
        "/configuracion/firma",
      ),
    );
  });

  it("el operador ve lo que falta sin enlaces, y que lo pida a un administrador", async () => {
    navigation.pathname = "/primeros-pasos";
    render(OPERATOR_ME, ["SIGNING_CERTIFICATE"]);
    expect(
      await screen.findByText("Pide a un administrador que complete la configuración."),
    ).toBeDefined();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("con la empresa lista dice que ya puede emitir", async () => {
    navigation.pathname = "/primeros-pasos";
    render(ADMIN_ME, []);
    expect(await screen.findByText("Lista para emitir")).toBeDefined();
  });
});
