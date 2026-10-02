import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionGate } from "@/components/session";
import { EnvironmentScreen } from "@/features/company/environment-screen";
import { ADMIN_ME, mockApi, navigation, renderApp } from "./harness";

const STATUS = {
  environment: "TEST",
  displayName: "Andina",
  readiness: {
    ready: false,
    checks: [
      { key: "TAXPAYER_DATA", status: "MET" },
      { key: "EMISSION_POINT", status: "MET" },
      { key: "SIGNING_CERTIFICATE", status: "PENDING" },
    ],
  },
};
const TAXPAYER = {
  configured: true,
  version: 3,
  environment: "TEST",
  taxIdentityLocked: false,
  profile: {
    ruc: "1790012345001",
    legalName: "Comercial Andina S.A.",
    tradeName: null,
    headOfficeAddress: "Quito",
    phone: null,
    email: null,
    accountingRequired: true,
    specialTaxpayerNumber: null,
    withholdingAgentResolution: null,
    largeTaxpayer: false,
    rimpeCategory: null,
    providerRuc: null,
  },
  logo: null,
  logoMaxBytes: 524288,
  updatedAt: "2026-10-02T12:00:00.000Z",
};

function renderEnvironment(taxpayer: Record<string, unknown>) {
  const calls = mockApi({
    "GET /api/v1/me": () => ({ status: 200, body: { data: ADMIN_ME } }),
    "GET /api/v1/taxpayer": () => ({ status: 200, body: { data: taxpayer } }),
    "GET /api/v1/company/status": () => ({ status: 200, body: { data: STATUS } }),
    "PUT /api/v1/taxpayer/environment": () => ({
      status: 200,
      body: { data: { ...taxpayer, version: 4, environment: "PRODUCTION" } },
    }),
  });
  renderApp(
    <SessionGate fallback={<p>cargando</p>}>
      <EnvironmentScreen />
    </SessionGate>,
  );
  return calls;
}

beforeEach(() => {
  navigation.pathname = "/configuracion/ambiente";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Ambiente (design D6 y D14)", () => {
  it("cancelar el paso a Producción no cambia nada", async () => {
    const calls = renderEnvironment(TAXPAYER);
    const user = userEvent.setup();
    expect(await screen.findByText("Pendiente: Firma electrónica.")).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Cambiar a Producción" }));
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(calls.some((call) => call.key.startsWith("PUT"))).toBe(false);
  });

  it("pasar a Producción exige escribir el RUC y envía la versión de partida", async () => {
    const calls = renderEnvironment(TAXPAYER);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Cambiar a Producción" }));
    const dialog = screen.getByRole("dialog");
    const confirm = Array.from(dialog.querySelectorAll("button")).find(
      (button) => button.textContent === "Cambiar a Producción",
    ) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await user.type(screen.getByLabelText("RUC de la empresa"), "1790012345001");
    await user.click(confirm);
    expect(await screen.findByText("La empresa está ahora en Producción.")).toBeDefined();
    expect(calls.find((call) => call.key === "PUT /api/v1/taxpayer/environment")?.body).toEqual({
      environment: "PRODUCTION",
      expectedVersion: 3,
    });
  });

  it("volver a Pruebas es un paso", async () => {
    const calls = renderEnvironment({ ...TAXPAYER, environment: "PRODUCTION" });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Volver a Pruebas" }));
    expect(screen.queryByLabelText("RUC de la empresa")).toBeNull();
    const dialog = screen.getByRole("dialog");
    const confirm = Array.from(dialog.querySelectorAll("button")).find(
      (button) => button.textContent === "Volver a Pruebas",
    ) as HTMLButtonElement;
    await user.click(confirm);
    await screen.findByText(/La empresa está ahora en/);
    expect(calls.find((call) => call.key === "PUT /api/v1/taxpayer/environment")?.body).toEqual({
      environment: "TEST",
      expectedVersion: 3,
    });
  });

  it("sin datos registrados la acción está deshabilitada y explica por qué", async () => {
    renderEnvironment({ ...TAXPAYER, configured: false, version: null, profile: null });
    const action = await screen.findByRole("button", { name: "Cambiar a Producción" });
    expect((action as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Registra primero los datos de la empresa/)).toBeDefined();
  });
});
