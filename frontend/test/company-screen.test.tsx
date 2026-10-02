import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionGate } from "@/components/session";
import { CompanyScreen } from "@/features/company/company-screen";
import {
  ADMIN_ME,
  OPERATOR_ME,
  errorBody,
  mockApi,
  navigation,
  renderApp,
  type Route,
} from "./harness";

const PROFILE = {
  ruc: "1790012345001",
  legalName: "Comercial Andina S.A.",
  tradeName: null,
  headOfficeAddress: "Av. Amazonas N24-03, Quito",
  phone: null,
  email: null,
  accountingRequired: true,
  specialTaxpayerNumber: null,
  withholdingAgentResolution: null,
  largeTaxpayer: false,
  rimpeCategory: null,
  providerRuc: null,
};
const EMPTY = {
  configured: false,
  version: null,
  environment: "TEST",
  taxIdentityLocked: false,
  profile: null,
  logo: null,
  logoMaxBytes: 524288,
  updatedAt: null,
};
const view = (overrides: Record<string, unknown> = {}) => ({
  ...EMPTY,
  configured: true,
  version: 1,
  profile: PROFILE,
  updatedAt: "2026-10-02T12:00:00.000Z",
  ...overrides,
});

function renderCompany(
  taxpayer: () => unknown,
  put?: Route,
  me: typeof ADMIN_ME | typeof OPERATOR_ME = ADMIN_ME,
) {
  const calls = mockApi({
    "GET /api/v1/me": () => ({ status: 200, body: { data: me } }),
    "GET /api/v1/taxpayer": () => ({ status: 200, body: { data: taxpayer() } }),
    ...(put ? { "PUT /api/v1/taxpayer": put } : {}),
  });
  renderApp(
    <SessionGate fallback={<p>cargando</p>}>
      <CompanyScreen />
    </SessionGate>,
  );
  return calls;
}

beforeEach(() => {
  navigation.pathname = "/configuracion/empresa";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Empresa (design D14)", () => {
  it("primer registro: formulario vacío, contabilidad sin preselección y logo no disponible", async () => {
    renderCompany(() => EMPTY);
    expect(await screen.findByText("Registra los datos con que tu empresa emitirá.")).toBeDefined();
    expect(screen.getAllByRole("radio", { checked: false }).length).toBeGreaterThanOrEqual(2);
    expect(
      screen.getByText("Registra primero los datos de la empresa para cargar el logo."),
    ).toBeDefined();
    expect(screen.queryByText(/Versión/)).toBeNull();
  });

  it("valida en el cliente con las reglas del contrato y conserva los valores", async () => {
    const calls = renderCompany(
      () => EMPTY,
      () => ({ status: 200, body: { data: view() } }),
    );
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("RUC"), "123");
    await user.click(screen.getByRole("button", { name: "Guardar datos" }));
    expect(
      await screen.findByText("El RUC debe tener 13 dígitos y terminar en 001."),
    ).toBeDefined();
    expect(screen.getByText("La razón social es obligatoria.")).toBeDefined();
    expect(
      screen.getByText("Indica si la empresa está obligada a llevar contabilidad."),
    ).toBeDefined();
    expect((screen.getByLabelText("RUC") as HTMLInputElement).value).toBe("123");
    expect(calls.some((call) => call.key.startsWith("PUT"))).toBe(false);
  });

  it("registra los datos con los opcionales vacíos como null y la versión de partida", async () => {
    const calls = renderCompany(
      () => EMPTY,
      () => ({ status: 200, body: { data: view() } }),
    );
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("RUC"), PROFILE.ruc);
    await user.type(screen.getByLabelText("Razón social"), PROFILE.legalName);
    await user.type(screen.getByLabelText("Dirección matriz"), PROFILE.headOfficeAddress);
    await user.click(screen.getByRole("radio", { name: "Sí" }));
    await user.click(screen.getByLabelText("Es agente de retención"));
    await user.type(screen.getByLabelText("Número de resolución de agente de retención"), "123");
    await user.click(screen.getByRole("button", { name: "Guardar datos" }));
    await screen.findByText("Guardaste los datos de la empresa (versión 1).");
    const put = calls.find((call) => call.key === "PUT /api/v1/taxpayer");
    expect(put?.body).toEqual({
      ...PROFILE,
      withholdingAgentResolution: "123",
      expectedVersion: null,
    });
  });

  it("revela el número al marcar la casilla y lo exige", async () => {
    renderCompany(() => view());
    const user = userEvent.setup();
    expect(await screen.findByText("Versión 1")).toBeDefined();
    expect(screen.queryByLabelText("Número de contribuyente especial")).toBeNull();
    await user.click(screen.getByLabelText("Es contribuyente especial"));
    await user.click(screen.getByRole("button", { name: "Guardar datos" }));
    expect(await screen.findByText("Escribe el número de contribuyente especial.")).toBeDefined();
  });

  it("con la identidad bloqueada el RUC es una etiqueta con su explicación", async () => {
    renderCompany(() => view({ taxIdentityLocked: true }));
    expect(await screen.findByText(/El RUC ya no puede cambiar en esta empresa/)).toBeDefined();
    expect(screen.queryByLabelText("RUC")).toBeNull();
    expect(screen.getByText(PROFILE.ruc)).toBeDefined();
  });

  it("ante un conflicto de versión pide recargar y parte de la versión vigente", async () => {
    let current = view();
    const calls = renderCompany(
      () => current,
      () => ({
        status: 409,
        body: errorBody("CONFIG_VERSION_CONFLICT", "Otro administrador cambió los datos."),
      }),
    );
    const user = userEvent.setup();
    const name = await screen.findByLabelText("Razón social");
    await user.clear(name);
    await user.type(name, "Otra S.A.");
    await user.click(screen.getByRole("button", { name: "Guardar datos" }));
    expect(
      await screen.findByText(
        "Otro administrador cambió los datos. Recarga para ver la versión vigente.",
      ),
    ).toBeDefined();
    current = view({ version: 2, profile: { ...PROFILE, legalName: "Andina Cía. Ltda." } });
    await user.click(screen.getByRole("button", { name: "Recargar" }));
    await waitFor(() =>
      expect((screen.getByLabelText("Razón social") as HTMLInputElement).value).toBe(
        "Andina Cía. Ltda.",
      ),
    );
    expect(calls.filter((call) => call.key === "GET /api/v1/taxpayer").length).toBeGreaterThan(1);
  });

  it("el operador ve el estado sin permiso", async () => {
    renderCompany(() => EMPTY, undefined, OPERATOR_ME);
    expect(await screen.findByText("No tienes permiso para ver esta sección")).toBeDefined();
  });

  it("muestra el logo vigente con su tipo y tamaño", async () => {
    renderCompany(() =>
      view({
        version: 2,
        logo: { mimeType: "image/png", sizeBytes: 4096, sha256: "a".repeat(64) },
      }),
    );
    expect(await screen.findByAltText("Logo vigente de la empresa")).toBeDefined();
    expect(screen.getByText("PNG · 4 KB")).toBeDefined();
    expect(screen.getByText("PNG o JPEG, hasta 512 KB.")).toBeDefined();
  });
});
