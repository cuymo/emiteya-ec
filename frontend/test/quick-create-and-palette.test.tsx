// Creación rápida y paleta de comandos del shell (spec web-application-shell; adopt-premium-design-
// foundation-and-shell, design D13 y D14): solo navegan, filtran según el rol, se manejan con el
// teclado y devuelven el foco, y la paleta no consulta al servidor mientras se escribe. Corrección
// del control de calidad UX (design D26, tarea 14.7): la paleta declara su alcance, «Buscar pantalla
// o acción», reconoce sinónimos y, sin coincidencias, no afirma que un registro no exista.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalize, paletteFilter } from "@/lib/navigation/palette-filter";
import { MI_CUENTA, NAV_GROUPS } from "@/lib/navigation/routes";
import { OPERATOR_ME, navigation } from "./harness";
import { api, renderShell } from "./shell-harness";
import { resetViewport, setViewportWidth } from "./viewport";

beforeEach(() => {
  navigation.pathname = "/facturas";
  navigation.search = new URLSearchParams();
  navigation.push.mockReset();
  navigation.replace.mockReset();
  setViewportWidth(1280);
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetViewport();
});

const apiCalls = (calls: { key: string }[]) => calls.filter((call) => call.key.includes("/api/"));

describe("creación rápida", () => {
  it("lleva a la pantalla de nueva factura y no crea nada por sí misma", async () => {
    const user = userEvent.setup();
    const calls = api();
    renderShell();
    await screen.findByText("contenido");
    await user.click(screen.getByRole("button", { name: "Nuevo" }));
    const menu = await screen.findByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual([
      "Nueva factura",
      "Nueva nota de crédito",
      "Nueva nota de débito",
      "Nueva retención",
      "Nueva guía de remisión",
      "Nueva liquidación de compra",
    ]);
    const link = within(menu).getByRole("menuitem", { name: "Nueva factura" });
    expect(link.getAttribute("href")).toBe("/borradores/nuevo");
    // Abrirla no envía ninguna petición que cree algo.
    expect(apiCalls(calls).filter((call) => !call.key.startsWith("GET "))).toEqual([]);
  });

  it("la nueva factura, también después del primer guardado, marca Facturas como destino actual", async () => {
    // productize-invoice-editor-and-composition-foundation, D12 y PO-1.
    api();
    for (const path of ["/borradores/nuevo", "/borradores/draft-1"]) {
      navigation.pathname = path;
      const view = renderShell();
      await screen.findByText("contenido");
      const nav = screen.getByRole("navigation", { name: "Navegación principal" });
      const current = within(nav)
        .getAllByRole("link")
        .filter((link) => link.getAttribute("aria-current") === "page");
      expect(
        current.map((link) => link.textContent),
        path,
      ).toEqual(["Facturas"]);
      view.unmount();
    }
  });

  it("abrirla y cerrarla sin elegir no crea nada ni cambia de pantalla", async () => {
    const user = userEvent.setup();
    const calls = api();
    renderShell();
    await screen.findByText("contenido");
    const trigger = screen.getByRole("button", { name: "Nuevo" });
    await user.click(trigger);
    await screen.findByRole("menu");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(document.activeElement).toBe(trigger);
    expect(navigation.push).not.toHaveBeenCalled();
    expect(apiCalls(calls).filter((call) => !call.key.startsWith("GET "))).toEqual([]);
  });

  it("se maneja con el teclado y devuelve el foco al control que la abrió", async () => {
    const user = userEvent.setup();
    api();
    renderShell();
    await screen.findByText("contenido");
    const trigger = screen.getByRole("button", { name: "Nuevo" });
    trigger.focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("menu");
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement?.textContent).toBe("Nueva nota de crédito");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it("colapsada, es un botón de icono con su nombre", async () => {
    api();
    renderShell({ sidebarDefaultOpen: false });
    await screen.findByText("contenido");
    expect(screen.getByRole("button", { name: "Nuevo" }).textContent).toBe("");
  });
});

describe("paleta de comandos", () => {
  it("se abre con Ctrl+K, filtra sin tildes y lleva al destino elegido", async () => {
    const user = userEvent.setup();
    api({ me: OPERATOR_ME });
    renderShell();
    await screen.findByText("contenido");
    await user.keyboard("{Control>}k{/Control}");
    const dialog = await screen.findByRole("dialog", { name: "Paleta de comandos" });
    await user.type(within(dialog).getByRole("combobox"), "credito");
    const option = within(dialog).getByRole("option", { name: /^Notas de crédito/ });
    await user.click(option);
    expect(navigation.push).toHaveBeenCalledWith("/notas-credito");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("ofrece las acciones de creación, que solo navegan", async () => {
    const user = userEvent.setup();
    const calls = api();
    renderShell();
    await screen.findByText("contenido");
    await user.click(screen.getAllByRole("button", { name: "Buscar pantalla o acción" })[0]!);
    const dialog = await screen.findByRole("dialog", { name: "Paleta de comandos" });
    await user.type(within(dialog).getByRole("combobox"), "guia de remision");
    await user.click(within(dialog).getByRole("option", { name: "Nueva guía de remisión" }));
    expect(navigation.push).toHaveBeenCalledWith("/guias-remision/borradores/nueva");
    expect(apiCalls(calls).filter((call) => !call.key.startsWith("GET "))).toEqual([]);
  });

  it("no consulta al servidor mientras se escribe", async () => {
    const user = userEvent.setup();
    const calls = api();
    renderShell();
    await screen.findByText("contenido");
    await user.keyboard("{Control>}k{/Control}");
    const dialog = await screen.findByRole("dialog", { name: "Paleta de comandos" });
    const before = calls.length;
    await user.type(within(dialog).getByRole("combobox"), "productos factura reportes");
    expect(calls.slice(before)).toEqual([]);
  });

  it("sin coincidencias dice que no hay resultados y no ofrece destinos ocultos", async () => {
    const user = userEvent.setup();
    api({ me: OPERATOR_ME });
    renderShell();
    await screen.findByText("contenido");
    await user.keyboard("{Control>}k{/Control}");
    const dialog = await screen.findByRole("dialog", { name: "Paleta de comandos" });
    await user.type(within(dialog).getByRole("combobox"), "usuarios");
    // El texto cambió de «No hay resultados.» a uno que dice qué se buscó (design D26).
    expect(
      within(dialog).getByText("No encontramos una pantalla o acción con ese término."),
    ).toBeDefined();
    expect(within(dialog).queryByRole("option", { name: /Usuarios/ })).toBeNull();
  });

  it("declara su alcance en el disparador redondo y en el campo", async () => {
    const user = userEvent.setup();
    api();
    renderShell();
    await screen.findByText("contenido");
    const triggers = screen.getAllByRole("button", { name: "Buscar pantalla o acción" });
    expect(triggers).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Buscar" })).toBeNull();
    await user.click(triggers[0]!);
    const dialog = await screen.findByRole("dialog", { name: "Paleta de comandos" });
    const input = within(dialog).getByRole("combobox", { name: "Buscar pantalla o acción" });
    expect(input.getAttribute("placeholder")).toBe("Buscar pantalla o acción…");
  });

  it("reconoce sinónimos sin consultar al servidor", async () => {
    const user = userEvent.setup();
    const calls = api();
    renderShell();
    await screen.findByText("contenido");
    await user.keyboard("{Control>}k{/Control}");
    const dialog = await screen.findByRole("dialog", { name: "Paleta de comandos" });
    const input = within(dialog).getByRole("combobox");
    const before = calls.length;
    for (const [query, label] of [
      ["clientes", "Terceros"],
      ["proveedor", "Terceros"],
      ["contraseña", "Mi cuenta"],
      ["IVA", "Catálogos fiscales"],
      ["certificado", "Firma electrónica"],
      ["numeración", "Establecimientos"],
      ["facturas emitidas", "Archivo de comprobantes"],
      ["factura sin emitir", "Borradores de facturas"],
    ] as const) {
      await user.clear(input);
      await user.type(input, query);
      expect(
        within(dialog).getByRole("option", { name: new RegExp(`^${label}`) }),
        query,
      ).toBeDefined();
    }
    expect(calls.slice(before)).toEqual([]);
  });

  it("un número de comprobante o un cliente no producen resultados inventados", async () => {
    const user = userEvent.setup();
    api();
    renderShell();
    await screen.findByText("contenido");
    await user.keyboard("{Control>}k{/Control}");
    const dialog = await screen.findByRole("dialog", { name: "Paleta de comandos" });
    const input = within(dialog).getByRole("combobox");
    for (const query of ["001-001-000000123", "EL PERNO CIA. LTDA."]) {
      await user.clear(input);
      await user.type(input, query);
      expect(within(dialog).queryAllByRole("option"), query).toEqual([]);
      expect(
        within(dialog).getByText("No encontramos una pantalla o acción con ese término."),
      ).toBeDefined();
      expect(within(dialog).queryByText(/no existe/i)).toBeNull();
    }
  });

  it("Escape la cierra y devuelve el foco al disparador", async () => {
    const user = userEvent.setup();
    api();
    renderShell();
    await screen.findByText("contenido");
    const trigger = screen.getAllByRole("button", { name: "Buscar pantalla o acción" })[0]!;
    await user.click(trigger);
    await screen.findByRole("dialog", { name: "Paleta de comandos" });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it("el administrador encuentra los destinos de Configuración y Mi cuenta", async () => {
    const user = userEvent.setup();
    api();
    renderShell();
    await screen.findByText("contenido");
    await user.keyboard("{Control>}k{/Control}");
    const dialog = await screen.findByRole("dialog", { name: "Paleta de comandos" });
    await user.type(within(dialog).getByRole("combobox"), "usuarios");
    expect(within(dialog).getByRole("option", { name: /^Usuarios/ })).toBeDefined();
    await user.clear(within(dialog).getByRole("combobox"));
    await user.type(within(dialog).getByRole("combobox"), "mi cuenta");
    expect(within(dialog).getByRole("option", { name: /^Mi cuenta/ })).toBeDefined();
  });
});

describe("filtro de la paleta", () => {
  it("no distingue mayúsculas ni tildes", () => {
    expect(normalize("  Notas de CRÉDITO ")).toBe("notas de credito");
    expect(paletteFilter("Notas de crédito", "credito")).toBe(1);
    expect(paletteFilter("Guías de remisión", "GUIA")).toBe(1);
  });

  it("puntúa más lo que empieza por lo escrito que lo que solo lo contiene", () => {
    expect(paletteFilter("Facturas", "fact")).toBe(1);
    expect(paletteFilter("Facturas", "tura")).toBe(0.5);
    expect(paletteFilter("Facturas", "xyz")).toBe(0);
  });

  it("también busca en las palabras clave y acepta la búsqueda vacía", () => {
    expect(paletteFilter("Empresa", "configur", ["Configuración"])).toBe(1);
    expect(paletteFilter("Empresa", "")).toBe(1);
  });

  it("los sinónimos viven en el modelo de rutas (design D26)", () => {
    const keywords = (label: string) =>
      [MI_CUENTA, ...NAV_GROUPS.flatMap((group) => group.destinations)].find(
        (destination) => destination.label === label,
      )?.keywords ?? [];
    expect(keywords("Terceros")).toEqual(
      expect.arrayContaining(["clientes", "proveedores", "transportistas", "contactos"]),
    );
    expect(keywords("Catálogos fiscales")).toEqual(
      expect.arrayContaining(["IVA", "ICE", "IRBPNR", "impuestos", "formas de pago"]),
    );
    expect(keywords("Firma electrónica")).toEqual(
      expect.arrayContaining(["certificado", "P12", "PKCS12"]),
    );
    expect(keywords("Mi cuenta")).toEqual(expect.arrayContaining(["contraseña", "password"]));
    expect(keywords("Establecimientos")).toEqual(
      expect.arrayContaining(["secuencial", "numeración", "número"]),
    );
    expect(paletteFilter("Terceros", "CLIENTE", keywords("Terceros"))).toBe(1);
    expect(paletteFilter("Mi cuenta", "contrasena", keywords("Mi cuenta"))).toBe(1);
  });
});
