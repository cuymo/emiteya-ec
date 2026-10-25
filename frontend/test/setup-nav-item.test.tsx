// «Primeros pasos» en la barra lateral y su página (redesign-dashboard-indicators, tarea 4.1, con la
// decisión del propietario del 2026-10-24): la opción debajo de Inicio, con el número de pendientes,
// solo mientras la empresa no pueda emitir; y la página con los requisitos y el enlace a resolverlos
// según el rol. La barra superior no lleva ningún botón.
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

describe("Primeros pasos en la barra lateral", () => {
  const nav = () => screen.getByRole("navigation", { name: "Navegación principal" });

  it("con requisitos pendientes aparece debajo de Inicio, con cuántos faltan", async () => {
    api({ routes: { "GET /api/v1/company/status": () => status(["SIGNING_CERTIFICATE"]) } });
    renderShell();
    const link = await within(
      await screen.findByRole("navigation", { name: "Navegación principal" }),
    ).findByRole("link", { name: "Primeros pasos, 1 pendiente" });
    expect(link.getAttribute("href")).toBe("/primeros-pasos");
    const labels = within(nav())
      .getAllByRole("link")
      .map((item) => item.getAttribute("href"));
    expect(labels.slice(0, 2)).toEqual(["/", "/primeros-pasos"]);
    expect(screen.queryByRole("link", { name: /Falta configurar/ })).toBeNull();
  });

  it("con la empresa lista no aparece", async () => {
    api({ routes: { "GET /api/v1/company/status": () => status([]) } });
    renderShell();
    await screen.findByText("contenido");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(within(nav()).queryByRole("link", { name: /Primeros pasos/ })).toBeNull();
  });

  it("queda marcada como el destino actual en su página", async () => {
    navigation.pathname = "/primeros-pasos";
    api({ routes: { "GET /api/v1/company/status": () => status(["SIGNING_CERTIFICATE"]) } });
    renderShell();
    const sidebar = await screen.findByRole("navigation", { name: "Navegación principal" });
    const link = await within(sidebar).findByRole("link", { name: "Primeros pasos, 1 pendiente" });
    expect(link.getAttribute("aria-current")).toBe("page");
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
