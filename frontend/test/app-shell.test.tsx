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
    expect(screen.getByRole("link", { name: "Firma electrónica" }).getAttribute("href")).toBe(
      "/configuracion/firma",
    );
    expect(screen.getByRole("link", { name: "Catálogos fiscales" }).getAttribute("href")).toBe(
      "/configuracion/catalogos-fiscales",
    );
  });

  it("el operador solo ve Catálogos fiscales en Configuración, que consulta (add-fiscal-catalogs)", async () => {
    mockApi({ "GET /api/v1/me": () => ({ status: 200, body: { data: OPERATOR_ME } }) });
    renderShell();
    await screen.findByText("contenido");
    expect(screen.queryByRole("link", { name: "Usuarios" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Empresa" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Ambiente" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Establecimientos" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Secuenciales" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Firma electrónica" })).toBeNull();
    expect(
      (await screen.findByRole("link", { name: "Catálogos fiscales" })).getAttribute("href"),
    ).toBe("/configuracion/catalogos-fiscales");
  });

  it("administrador y operador ven Terceros y Productos en Operación (add-parties-and-products)", async () => {
    for (const me of [ADMIN_ME, OPERATOR_ME]) {
      mockApi({ "GET /api/v1/me": () => ({ status: 200, body: { data: me } }) });
      const view = renderShell();
      await screen.findByText("contenido");
      expect(screen.getByText("Operación")).toBeDefined();
      expect(screen.getByRole("link", { name: "Terceros" }).getAttribute("href")).toBe("/terceros");
      expect(screen.getByRole("link", { name: "Productos" }).getAttribute("href")).toBe(
        "/productos",
      );
      view.unmount();
      vi.unstubAllGlobals();
    }
  });

  it("administrador y operador ven Inventario en Operación (add-minimal-inventory)", async () => {
    for (const me of [ADMIN_ME, OPERATOR_ME]) {
      mockApi({ "GET /api/v1/me": () => ({ status: 200, body: { data: me } }) });
      const view = renderShell();
      await screen.findByText("contenido");
      expect(screen.getByRole("link", { name: "Inventario" }).getAttribute("href")).toBe(
        "/inventario",
      );
      view.unmount();
      vi.unstubAllGlobals();
    }
  });

  it("administrador y operador ven Facturas y Borradores en Operación (add-invoice-emission)", async () => {
    for (const me of [ADMIN_ME, OPERATOR_ME]) {
      mockApi({ "GET /api/v1/me": () => ({ status: 200, body: { data: me } }) });
      const view = renderShell();
      await screen.findByText("contenido");
      expect(screen.getByRole("link", { name: "Facturas" }).getAttribute("href")).toBe("/facturas");
      expect(screen.getByRole("link", { name: "Borradores" }).getAttribute("href")).toBe(
        "/borradores",
      );
      view.unmount();
      vi.unstubAllGlobals();
    }
  });

  it("administrador y operador ven Comprobantes en Operación (add-document-archive)", async () => {
    for (const me of [ADMIN_ME, OPERATOR_ME]) {
      mockApi({ "GET /api/v1/me": () => ({ status: 200, body: { data: me } }) });
      const view = renderShell();
      await screen.findByText("contenido");
      expect(screen.getByRole("link", { name: "Comprobantes" }).getAttribute("href")).toBe(
        "/comprobantes",
      );
      view.unmount();
      vi.unstubAllGlobals();
    }
  });

  it("administrador y operador ven Notas de débito en Operación (add-debit-notes)", async () => {
    for (const me of [ADMIN_ME, OPERATOR_ME]) {
      mockApi({ "GET /api/v1/me": () => ({ status: 200, body: { data: me } }) });
      const view = renderShell();
      await screen.findByText("contenido");
      expect(screen.getByRole("link", { name: "Notas de débito" }).getAttribute("href")).toBe(
        "/notas-debito",
      );
      view.unmount();
      vi.unstubAllGlobals();
    }
  });

  it("administrador y operador ven Retenciones en Operación (add-withholding-receipts)", async () => {
    for (const me of [ADMIN_ME, OPERATOR_ME]) {
      mockApi({ "GET /api/v1/me": () => ({ status: 200, body: { data: me } }) });
      const view = renderShell();
      await screen.findByText("contenido");
      expect(screen.getByRole("link", { name: "Retenciones" }).getAttribute("href")).toBe(
        "/retenciones",
      );
      view.unmount();
      vi.unstubAllGlobals();
    }
  });

  it("administrador y operador ven Guías de remisión en Operación (add-shipping-guides)", async () => {
    for (const me of [ADMIN_ME, OPERATOR_ME]) {
      mockApi({ "GET /api/v1/me": () => ({ status: 200, body: { data: me } }) });
      const view = renderShell();
      await screen.findByText("contenido");
      expect(screen.getByRole("link", { name: "Guías de remisión" }).getAttribute("href")).toBe(
        "/guias-remision",
      );
      view.unmount();
      vi.unstubAllGlobals();
    }
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
