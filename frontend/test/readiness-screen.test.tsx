import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionGate } from "@/components/session";
import { ReadinessScreen } from "@/features/home/readiness-screen";
import { ADMIN_ME, OPERATOR_ME, errorBody, mockApi, navigation, renderApp } from "./harness";

type Check = { key: string; status: "MET" | "PENDING" };
const respond =
  (checks: Check[], ready = false) =>
  () => ({
    status: 200,
    body: { data: { environment: "TEST", displayName: null, readiness: { ready, checks } } },
  });
const NEW_COMPANY: Check[] = [
  { key: "TAXPAYER_DATA", status: "PENDING" },
  { key: "EMISSION_POINT", status: "PENDING" },
  { key: "SIGNING_CERTIFICATE", status: "PENDING" },
];
const MINIMUM: Check[] = [
  { key: "TAXPAYER_DATA", status: "MET" },
  { key: "EMISSION_POINT", status: "MET" },
  { key: "SIGNING_CERTIFICATE", status: "PENDING" },
];

function renderScreen(me: typeof ADMIN_ME | typeof OPERATOR_ME, status: () => unknown) {
  mockApi({
    "GET /api/v1/me": () => ({ status: 200, body: { data: me } }),
    "GET /api/v1/company/status": status as () => { status: number; body: unknown },
  });
  return renderApp(
    <SessionGate fallback={<p>cargando</p>}>
      <ReadinessScreen />
    </SessionGate>,
  );
}

beforeEach(() => {
  navigation.pathname = "/";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Inicio: preparación para emitir (design D9 y D14)", () => {
  it("una empresa nueva no puede emitir y el administrador va al primer requisito", async () => {
    renderScreen(ADMIN_ME, respond(NEW_COMPANY));
    expect(await screen.findByText("Aún no puede emitir")).toBeDefined();
    const primary = screen.getByRole("link", { name: "Registrar los datos de la empresa" });
    expect(primary.getAttribute("href")).toBe("/configuracion/empresa");
    expect(screen.getByRole("link", { name: "Configurar" }).getAttribute("href")).toBe(
      "/configuracion/establecimientos",
    );
    expect(screen.getByText("Disponible próximamente.")).toBeDefined();
    expect(screen.getByText("Ambiente vigente: Pruebas")).toBeDefined();
  });

  it("con la configuración mínima solo falta la firma, sin acción para resolverla", async () => {
    renderScreen(ADMIN_ME, respond(MINIMUM));
    await screen.findByText("Aún no puede emitir");
    expect(screen.getByText("Registrados.")).toBeDefined();
    expect(screen.getByText("Hay al menos un punto de emisión disponible.")).toBeDefined();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("el operador ve los requisitos sin enlaces y a quién pedírselo", async () => {
    renderScreen(OPERATOR_ME, respond(NEW_COMPANY));
    await screen.findByText("Aún no puede emitir");
    expect(screen.queryByRole("link")).toBeNull();
    expect(
      screen.getByText("Pide a un administrador que complete la configuración."),
    ).toBeDefined();
  });

  it("ante un error ofrece reintentar", async () => {
    renderScreen(ADMIN_ME, () => ({ status: 403, body: errorBody("FORBIDDEN", "Sin permiso.") }));
    expect(await screen.findByRole("button", { name: /Intentar de nuevo/ })).toBeDefined();
  });
});
