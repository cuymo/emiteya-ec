// Configuración en una página con pestañas: las secciones que el rol ve, en el orden de la
// navegación, cada una un enlace a su dirección con la actual marcada, el panel con el ancho que pide
// su pantalla y `/configuracion` llevando a la primera pestaña.
import { screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionGate } from "@/components/session";
import {
  ConfigurationIndex,
  ConfigurationLayout,
} from "@/features/configuration/configuration-layout";
import { ADMIN_ME, OPERATOR_ME, mockApi, navigation, renderApp } from "./harness";

function renderLayout(me: typeof ADMIN_ME | typeof OPERATOR_ME, child = <p>panel</p>) {
  mockApi({ "GET /api/v1/me": () => ({ status: 200, body: { data: me } }) });
  return renderApp(
    <SessionGate fallback={<p>cargando</p>}>
      <ConfigurationLayout>{child}</ConfigurationLayout>
    </SessionGate>,
  );
}

const tabs = () => screen.getByRole("navigation", { name: "Secciones de configuración" });

beforeEach(() => {
  navigation.pathname = "/configuracion/usuarios";
  navigation.search = new URLSearchParams();
  navigation.replace.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Configuración en pestañas", () => {
  it("el administrador ve las ocho secciones en orden, con la actual marcada", async () => {
    renderLayout(ADMIN_ME);
    await screen.findByText("panel");
    const links = within(tabs()).getAllByRole("link");
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Usuarios", "/configuracion/usuarios"],
      ["Empresa", "/configuracion/empresa"],
      ["Establecimientos", "/configuracion/establecimientos"],
      ["Firma electrónica", "/configuracion/firma"],
      ["Correos", "/configuracion/correos"],
      ["Catálogos fiscales", "/configuracion/catalogos-fiscales"],
      ["Ambiente", "/configuracion/ambiente"],
      ["Portabilidad de datos", "/configuracion/portabilidad"],
    ]);
    expect(
      within(tabs()).getByRole("link", { name: "Usuarios" }).getAttribute("aria-current"),
    ).toBe("page");
    expect(
      within(tabs()).getByRole("link", { name: "Empresa" }).getAttribute("aria-current"),
    ).toBeNull();
  });

  it("el operador solo ve Catálogos fiscales", async () => {
    navigation.pathname = "/configuracion/catalogos-fiscales";
    renderLayout(OPERATOR_ME);
    await screen.findByText("panel");
    expect(
      within(tabs())
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Catálogos fiscales"]);
  });

  it("el panel toma el ancho que declara la pantalla, y las pestañas la columna entera", async () => {
    renderLayout(ADMIN_ME, <section data-panel-width="form">formulario</section>);
    const panel = (await screen.findByText("formulario")).closest(
      "[data-slot=configuration-panel]",
    ) as HTMLElement;
    expect(panel.className.split(/\s+/)).toEqual(
      expect.arrayContaining([
        "has-data-[panel-width=form]:max-w-form",
        "has-data-[panel-width=reading]:max-w-reading",
      ]),
    );
    expect(tabs().closest("[data-slot=configuration-panel]")).toBeNull();
  });

  it("con espacio, las secciones van en una columna vertical a la izquierda, como una barra lateral", async () => {
    renderLayout(ADMIN_ME, <section data-panel-width="form">formulario</section>);
    await screen.findByText("formulario");
    // Decisión del propietario, 2026-10-23: en una fila desplazable solo en una pantalla angosta.
    const layout = tabs().parentElement as HTMLElement;
    expect(layout.className).toContain("@settings-nav:grid-cols-settings-nav");
    expect(tabs().className).toContain("@settings-nav:flex-col");
    expect(tabs().className).toContain("@settings-nav:sticky");
    const current = within(tabs()).getByRole("link", { name: "Usuarios" });
    expect(current.getAttribute("aria-current")).toBe("page");
    expect(current.className).toContain("@settings-nav:aria-[current=page]:bg-active");
    expect(current.className).toContain("@settings-nav:justify-start");
  });

  it("con espacio, la columna lleva el fondo de la barra lateral y llega hasta el pie de la ventana", async () => {
    renderLayout(ADMIN_ME, <section data-panel-width="form">formulario</section>);
    await screen.findByText("formulario");
    // Decisión del propietario, 2026-10-24.
    expect(tabs().className).toContain("@settings-nav:bg-sidebar");
    expect(tabs().className).toContain(
      "@settings-nav:min-h-[calc(100dvh-var(--configuration-nav-top,9rem))]",
    );
    // Donde empieza la columna, más el margen inferior del contenido, por el CSSOM.
    expect(tabs().style.getPropertyValue("--configuration-nav-top")).toMatch(/^\d+px$/);
  });

  it("/configuracion lleva a la primera pestaña que el rol ve", async () => {
    navigation.pathname = "/configuracion";
    renderLayout(OPERATOR_ME, <ConfigurationIndex />);
    await screen.findByRole("status");
    await vi.waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith("/configuracion/catalogos-fiscales"),
    );
  });
});
