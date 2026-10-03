import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionGate } from "@/components/session";
import { CertificateNotice } from "@/features/signing/certificate-notice";
import { ADMIN_ME, OPERATOR_ME, mockApi, renderApp } from "./harness";

function renderNotice(
  validity: Record<string, unknown>,
  me: typeof ADMIN_ME | typeof OPERATOR_ME = ADMIN_ME,
) {
  mockApi({
    "GET /api/v1/me": () => ({ status: 200, body: { data: me } }),
    "GET /api/v1/signing-certificate/validity": () => ({ status: 200, body: { data: validity } }),
  });
  renderApp(
    <SessionGate fallback={<p>cargando</p>}>
      <CertificateNotice />
      <p>contenido</p>
    </SessionGate>,
  );
}

const NOT_AFTER = "2026-11-12T05:00:00.000Z";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("aviso de vencimiento de la firma (design D8 y D14)", () => {
  it("por vencer: fecha y días, con el enlace para el administrador", async () => {
    renderNotice({ state: "EXPIRING", usable: true, notAfter: NOT_AFTER, daysToExpiry: 9 });
    const notice = await screen.findByRole("status");
    expect(notice.textContent).toContain(
      "La firma electrónica vence el 12/11/2026 (faltan 9 días).",
    );
    expect(screen.getByRole("link", { name: "Ir a Firma electrónica" }).getAttribute("href")).toBe(
      "/configuracion/firma",
    );
  });

  it("vencida, y el operador sabe a quién pedírselo, sin enlace", async () => {
    renderNotice(
      { state: "EXPIRED", usable: false, notAfter: NOT_AFTER, daysToExpiry: -2 },
      OPERATOR_ME,
    );
    const notice = await screen.findByRole("status");
    expect(notice.textContent).toContain(
      "La firma electrónica venció el 12/11/2026: no se puede emitir.",
    );
    expect(notice.textContent).toContain("Pide a un administrador que la renueve.");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("no disponible: hay que volver a cargarla", async () => {
    renderNotice({
      state: "KEY_UNAVAILABLE",
      usable: false,
      notAfter: NOT_AFTER,
      daysToExpiry: 40,
    });
    expect((await screen.findByRole("status")).textContent).toContain(
      "no está disponible: hay que volver a cargarla",
    );
  });

  it("lejos del vencimiento o sin firma no hay aviso", async () => {
    renderNotice({ state: "VALID", usable: true, notAfter: NOT_AFTER, daysToExpiry: 200 });
    await screen.findByText("contenido");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("falta 1 día y vence hoy", async () => {
    renderNotice({ state: "EXPIRING", usable: true, notAfter: NOT_AFTER, daysToExpiry: 1 });
    expect((await screen.findByRole("status")).textContent).toContain("(falta 1 día)");
  });
});
