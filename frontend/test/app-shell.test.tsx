// Shell autenticado (spec web-application-shell; adopt-premium-design-foundation-and-shell, grupo 7).
// Conserva cada comportamiento del shell anterior (sesión, destinos por rol, destino actual, tema,
// errores) con la arquitectura de información nueva, y cubre los escenarios del shell premium:
// contexto de la empresa, ambiente, navegación adaptable, migas, cuenta y saltar al contenido.
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBreadcrumbLabel } from "@/components/shell/breadcrumb-label";
import { ADMIN_ME, OPERATOR_ME, errorBody, mockApi, navigation } from "./harness";
import { api, renderShell } from "./shell-harness";
import { resetViewport, setViewportWidth } from "./viewport";

const sidebar = () => screen.getByRole("complementary", { name: "Barra lateral" });
const mainNav = () => screen.getByRole("navigation", { name: "Navegación principal" });

beforeEach(() => {
  navigation.pathname = "/configuracion/usuarios";
  navigation.search = new URLSearchParams("q=ana");
  navigation.replace.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetViewport();
  document.cookie = "sidebar_state=; max-age=0; path=/";
});

describe("shell autenticado: comportamiento conservado", () => {
  it("verifica la sesión sin pantalla en blanco y luego muestra cabecera, contenido y enlace para saltar", async () => {
    api();
    renderShell();
    expect(screen.getByRole("status").textContent).toContain("Verificando la sesión");
    await screen.findByText("contenido");
    expect(screen.getByRole("main").textContent).toContain("contenido");
    expect(screen.getByRole("link", { name: "Saltar al contenido" }).getAttribute("href")).toBe(
      "#contenido",
    );
    expect(screen.getByRole("button", { name: "Cuenta de Ana Admin" })).toBeDefined();
  });

  it("Configuración es un solo enlace de la barra, actual en cualquiera de sus pestañas", async () => {
    api();
    renderShell();
    await screen.findByText("contenido");
    expect(sidebar().contains(mainNav())).toBe(true);
    const link = within(mainNav()).getByRole("link", { name: "Configuración" });
    // Lleva a la primera pestaña que el rol ve.
    expect(link.getAttribute("href")).toBe("/configuracion/usuarios");
    expect(link.getAttribute("aria-current")).toBe("page");
    // Sus secciones no están en la barra ni se pliegan: son pestañas de la página.
    for (const name of ["Empresa", "Usuarios", "Portabilidad de datos"]) {
      expect(within(mainNav()).queryByRole("link", { name })).toBeNull();
    }
    expect(within(mainNav()).queryByRole("button", { name: "Configuración" })).toBeNull();
  });

  it("fuera de Configuración su enlace no es el actual", async () => {
    api();
    navigation.pathname = "/facturas";
    renderShell();
    await screen.findByText("contenido");
    const link = within(mainNav()).getByRole("link", { name: "Configuración" });
    expect(link.getAttribute("aria-current")).toBeNull();
    expect(within(mainNav()).getByRole("link", { name: "Facturas" })).toBeDefined();
  });

  it("al operador, Configuración lo lleva a Catálogos fiscales, la única pestaña que ve", async () => {
    api({ me: OPERATOR_ME });
    navigation.pathname = "/configuracion/catalogos-fiscales";
    renderShell();
    await screen.findByText("contenido");
    expect(
      within(mainNav()).getByRole("link", { name: "Configuración" }).getAttribute("href"),
    ).toBe("/configuracion/catalogos-fiscales");
  });

  it("administrador y operador ven los destinos operativos en sus grupos nuevos", async () => {
    // Antes estaban todos en «Operación»; ahora Ventas, Compras, Logística, Documentos, Maestros y
    // Análisis (arquitectura de información aprobada).
    const destinations: Record<string, string> = {
      Inicio: "/",
      Facturas: "/facturas",
      // Comprobantes se llama «Archivo de comprobantes» (design D25). Los borradores de factura
      // van en la lista de Facturas (unify-drafts-into-document-lists, design D6).
      "Notas de crédito": "/notas-credito",
      "Notas de débito": "/notas-debito",
      "Liquidaciones de compra": "/liquidaciones-compra",
      Retenciones: "/retenciones",
      "Guías de remisión": "/guias-remision",
      Inventario: "/inventario",
      "Archivo de comprobantes": "/comprobantes",
      Terceros: "/terceros",
      Productos: "/productos",
      Reportes: "/reportes",
    };
    for (const me of [ADMIN_ME, OPERATOR_ME]) {
      api({ me });
      navigation.pathname = "/";
      const view = renderShell();
      await screen.findByText("contenido");
      for (const label of [
        "Ventas",
        "Compras",
        "Logística",
        "Documentos",
        "Maestros",
        "Análisis",
      ]) {
        expect(within(mainNav()).getByText(label)).toBeDefined();
      }
      for (const [name, href] of Object.entries(destinations)) {
        expect(within(mainNav()).getByRole("link", { name }).getAttribute("href")).toBe(href);
      }
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

  it("la interfaz va siempre en claro y no ofrece elegir el tema", async () => {
    // Decisión del propietario, 2026-10-22: siempre el tema claro, sin control de tema.
    const user = userEvent.setup();
    setViewportWidth(1280);
    api();
    renderShell();
    await user.click(await screen.findByRole("button", { name: "Cuenta de Ana Admin" }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).queryAllByRole("menuitemradio")).toEqual([]);
    expect(within(menu).queryByText("Tema")).toBeNull();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});

describe("nombre del producto", () => {
  it("el shell identifica el producto como EmiteYa y nunca como Facturador SRI", async () => {
    api();
    renderShell();
    await screen.findByText("contenido");
    expect(within(sidebar()).getByRole("link", { name: "EmiteYa" }).getAttribute("href")).toBe("/");
    expect(document.body.textContent).not.toContain("Facturador SRI");
  });
});

describe("contexto de la empresa", () => {
  it("muestra el nombre comercial de la empresa de la sesión, sin selector", async () => {
    api({ displayName: "Ferretería Andina" });
    renderShell();
    const name = await screen.findByText("Ferretería Andina");
    const context = name.closest("[data-slot=company-context]") as HTMLElement;
    expect(context).not.toBeNull();
    // Va dentro de la identidad, que abre el menú de cuenta (decisión del propietario, 2026-10-22),
    // y nunca ofrece cambiar de empresa.
    const identity = context.closest("button") as HTMLElement;
    expect(identity.getAttribute("aria-label")).toBe("Cuenta de Ana Admin");
    expect(identity.getAttribute("aria-describedby")).toBe(context.closest("[id]:not(button)")?.id);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryByText(/cambiar de empresa/i)).toBeNull();
  });

  it("muestra el nombre que da el sistema; sin datos registrados no supone ninguno", async () => {
    // `displayName` ya es el nombre comercial o, si no hay, la razón social (`/company/status`).
    api({ displayName: null });
    renderShell();
    expect(await screen.findByText("Empresa sin datos registrados")).toBeDefined();
    expect(document.querySelector("[data-slot=company-context]")).toBeNull();
  });

  it("si el contexto no puede obtenerse, lo indica sin mostrar un nombre", async () => {
    api({ companyFails: true });
    renderShell();
    expect(
      await screen.findByText("No pudimos confirmar la empresa", {}, { timeout: 4000 }),
    ).toBeDefined();
    expect(document.querySelector("[data-slot=company-context]")).toBeNull();
  });

  it("solo muestra la empresa de la sesión, ninguna otra", async () => {
    api({ displayName: "Ferretería Andina" });
    renderShell();
    await screen.findByText("Ferretería Andina");
    expect(document.querySelectorAll("[data-slot=company-context]")).toHaveLength(1);
  });
});

describe("ambiente fiscal visible", () => {
  const strip = () => screen.findByText(/Estás en el ambiente de Pruebas/);

  it("la franja de Pruebas sigue visible con la barra colapsada, sin forma de cerrarla", async () => {
    const user = userEvent.setup();
    setViewportWidth(1280);
    api();
    renderShell();
    await strip();
    await user.click(screen.getByRole("button", { name: "Contraer barra lateral" }));
    expect(screen.getByText(/Estás en el ambiente de Pruebas/)).toBeDefined();
    expect(screen.queryByRole("button", { name: /cerrar/i })).toBeNull();
  });

  it("en móvil la franja sigue visible al abrir y cerrar la navegación", async () => {
    const user = userEvent.setup();
    setViewportWidth(390);
    api();
    renderShell();
    await strip();
    await user.click(screen.getByRole("button", { name: "Abrir navegación" }));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText(/Estás en el ambiente de Pruebas/)).toBeDefined();
  });

  it("la franja va dentro del bloque fijo de la barra superior, encima de su fila", async () => {
    api();
    renderShell();
    await strip();
    const header = screen.getByRole("banner");
    expect(header.firstElementChild?.getAttribute("data-slot")).toBe("environment-banner");
    expect(
      header.querySelector("[data-slot=topbar-row] [data-slot=environment-banner]"),
    ).toBeNull();
  });

  it("Producción no lleva franja", async () => {
    api({ environment: "PRODUCTION" });
    renderShell();
    await screen.findByText("contenido");
    await waitFor(() => expect(screen.queryByText(/Pruebas/)).toBeNull());
    expect(document.querySelector("[data-slot=environment-banner]")).toBeNull();
  });

  it("el aviso de la firma convive con la franja de Pruebas", async () => {
    api({
      validity: {
        state: "EXPIRING",
        usable: true,
        notAfter: "2026-10-20T23:59:59.000Z",
        daysToExpiry: 6,
      },
    });
    renderShell();
    await strip();
    expect(await screen.findByText(/La firma electrónica vence el/)).toBeDefined();
    expect(screen.getByText(/Estás en el ambiente de Pruebas/)).toBeDefined();
  });
});

describe("barra superior estable", () => {
  it("dos zonas: las migas a la izquierda, sin título, y el contexto global a la derecha", async () => {
    api();
    navigation.pathname = "/borradores/nuevo";
    renderShell();
    await screen.findByText("contenido");
    const header = screen.getByRole("banner");
    expect(
      [...header.querySelectorAll("[data-slot=topbar-row] > [data-slot^=topbar-]")].map((zone) =>
        zone.getAttribute("data-slot"),
      ),
    ).toEqual(["topbar-start", "topbar-end"]);
    const start = header.querySelector("[data-slot=topbar-start]") as HTMLElement;
    const crumbs = within(start).getByRole("navigation", { name: "Ruta de navegación" });
    // La pantalla actual solo está en las migas: la barra no repite el título de la pantalla.
    expect(within(crumbs).getByText("Nueva factura").getAttribute("aria-current")).toBe("page");
    expect(within(start).getAllByText("Nueva factura")).toHaveLength(1);
    expect(within(header).queryByRole("heading")).toBeNull();
    expect(within(header).queryByRole("radiogroup", { name: "Tema" })).toBeNull();
    // Cada zona en una sola fila: sin saltos de línea.
    for (const zone of header.querySelectorAll("[data-slot=topbar-row] > [data-slot^=topbar-]"))
      expect(zone.className.split(/\s+/)).not.toContain("flex-wrap");
  });

  it("un nombre largo se recorta sin desplazar al resto y sigue completo para la asistencia", async () => {
    const name = "Distribuidora Ferretera de la Sierra Centro y Sur Compañía Limitada";
    api({ displayName: name });
    renderShell();
    const context = (await screen.findByText(name)).closest(
      "[data-slot=company-context]",
    ) as HTMLElement;
    expect(context.getAttribute("title")).toBe(name);
    expect(context.textContent!.endsWith(`Empresa: ${name}`)).toBe(true);
    expect(screen.getByText(name).className.split(/\s+/)).toContain("truncate");
    // El hueco de la empresa está acotado: 7rem en móvil y 14rem desde 768 px.
    expect(context.parentElement!.className.split(/\s+/)).toEqual(
      expect.arrayContaining(["max-w-28", "md:max-w-56", "min-w-0"]),
    );
  });
});

describe("destino actual", () => {
  it("marca exactamente un destino como actual", async () => {
    api();
    navigation.pathname = "/retenciones";
    renderShell();
    await screen.findByText("contenido");
    const current = within(mainNav())
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");
    expect(current.map((link) => link.textContent)).toEqual(["Retenciones"]);
  });

  it("en una pantalla interna marca su destino, también con la barra colapsada", async () => {
    api();
    navigation.pathname = "/notas-credito/borradores/d1";
    renderShell({ sidebarDefaultOpen: false });
    await screen.findByText("contenido");
    expect(
      within(mainNav())
        .getByRole("link", { name: "Notas de crédito" })
        .getAttribute("aria-current"),
    ).toBe("page");
  });
});

describe("navegación adaptable", () => {
  it("colapsa la barra, guarda la preferencia y se renderiza colapsada al recargar", async () => {
    const user = userEvent.setup();
    setViewportWidth(1280);
    api();
    const view = renderShell();
    await screen.findByText("contenido");
    const toggle = screen.getByRole("button", { name: "Contraer barra lateral" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    await user.click(toggle);
    expect(document.cookie).toContain("sidebar_state=false");
    expect(
      screen.getByRole("button", { name: "Expandir barra lateral" }).getAttribute("aria-expanded"),
    ).toBe("false");
    view.unmount();
    // El layout lee la cookie y pasa el estado: la barra vuelve colapsada.
    renderShell({ sidebarDefaultOpen: false });
    await screen.findByText("contenido");
    expect(screen.getByRole("button", { name: "Expandir barra lateral" })).toBeDefined();
  });

  it("colapsada, cada destino conserva su nombre y lo muestra como ayuda al enfocarlo", async () => {
    setViewportWidth(1280);
    api();
    renderShell({ sidebarDefaultOpen: false });
    await screen.findByText("contenido");
    const facturas = within(mainNav()).getByRole("link", { name: "Facturas" });
    act(() => facturas.focus());
    expect((await screen.findByRole("tooltip")).textContent).toContain("Facturas");
  });

  it("en móvil abre un panel con los mismos destinos que se cierra al elegir uno", async () => {
    const user = userEvent.setup();
    setViewportWidth(390);
    api({ me: OPERATOR_ME });
    navigation.pathname = "/";
    renderShell();
    await screen.findByText("contenido");
    // El botón se llamaba «Abrir menú» y usaba el icono del panel lateral; ahora es «Abrir
    // navegación», con el icono de menú (design D29).
    const menu = screen.getByRole("button", { name: "Abrir navegación" });
    expect(menu.querySelector("svg.lucide-menu")).not.toBeNull();
    expect(menu.querySelector("svg.lucide-panel-left")).toBeNull();
    await user.click(menu);
    const panel = await screen.findByRole("dialog", { name: "Menú" });
    // Los grupos se pliegan en móvil; se abren para elegir un destino.
    await user.click(within(panel).getByRole("button", { name: "Ventas" }));
    await user.click(within(panel).getByRole("link", { name: "Facturas" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(menu);
  });

  it("en móvil el panel se cierra con su botón visible y devuelve el foco al menú", async () => {
    const user = userEvent.setup();
    setViewportWidth(390);
    api();
    navigation.pathname = "/";
    renderShell();
    await screen.findByText("contenido");
    const menu = screen.getByRole("button", { name: "Abrir navegación" });
    await user.click(menu);
    await user.click(await screen.findByRole("button", { name: "Cerrar menú" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(menu);
  });
});

describe("migas", () => {
  const breadcrumb = () => screen.queryAllByRole("navigation", { name: "Ruta de navegación" });

  function RecordLabel({ label }: { label: string }) {
    useBreadcrumbLabel(label);
    return <p>contenido</p>;
  }

  it("una pantalla interna muestra el destino como enlace y el registro como página actual", async () => {
    api();
    navigation.pathname = "/facturas/abc";
    renderShell({ children: <RecordLabel label="001-001-000000123" /> });
    await screen.findByText("contenido");
    const [nav] = breadcrumb();
    expect(within(nav!).getByRole("link", { name: "Facturas" }).getAttribute("href")).toBe(
      "/facturas",
    );
    expect(within(nav!).getByText("001-001-000000123").getAttribute("aria-current")).toBe("page");
  });

  it("mientras no hay registro, la miga final es la de la ruta", async () => {
    api();
    navigation.pathname = "/facturas/abc";
    renderShell();
    await screen.findByText("contenido");
    expect(within(breadcrumb()[0]!).getByText("Detalle de factura")).toBeDefined();
  });

  it("van en la barra superior, debajo del título, y nunca en el contenido", async () => {
    api();
    for (const path of [
      "/facturas/abc",
      "/configuracion/empresa",
      "/notas-credito/borradores/x",
      "/borradores/nuevo",
      "/borradores/d-1",
    ]) {
      navigation.pathname = path;
      const view = renderShell();
      await screen.findByText("contenido");
      const navs = breadcrumb();
      expect(navs, path).toHaveLength(1);
      expect(navs[0]!.closest("header"), path).not.toBeNull();
      expect(navs[0]!.closest("main"), path).toBeNull();
      view.unmount();
    }
  });

  it("un destino de primer nivel muestra Inicio, su grupo y su nombre", async () => {
    api();
    navigation.pathname = "/facturas";
    renderShell();
    await screen.findByText("contenido");
    const [nav] = breadcrumb();
    expect(within(nav!).getByRole("link", { name: "Inicio" }).getAttribute("href")).toBe("/");
    expect(within(nav!).getByText("Ventas")).toBeDefined();
    expect(within(nav!).getByText("Facturas").getAttribute("aria-current")).toBe("page");
  });

  it("Configuración es una sección de las migas", async () => {
    api();
    navigation.pathname = "/configuracion/empresa";
    renderShell();
    await screen.findByText("contenido");
    const [nav] = breadcrumb();
    expect(within(nav!).getByText("Configuración")).toBeDefined();
    expect(within(nav!).getByText("Empresa").getAttribute("aria-current")).toBe("page");
  });
});

describe("menú de cuenta", () => {
  it("muestra nombre, rol, Mi cuenta y Cerrar sesión", async () => {
    const user = userEvent.setup();
    setViewportWidth(1280);
    api({ me: OPERATOR_ME });
    navigation.pathname = "/";
    renderShell();
    await user.click(await screen.findByRole("button", { name: `Cuenta de ${OPERATOR_ME.name}` }));
    const menu = await screen.findByRole("menu");
    expect(menu.textContent).toContain(OPERATOR_ME.name);
    expect(menu.textContent).toContain("Operador");
    expect(within(menu).getByRole("menuitem", { name: "Mi cuenta" }).getAttribute("href")).toBe(
      "/mi-cuenta",
    );
    expect(within(menu).getByRole("menuitem", { name: "Cerrar sesión" })).toBeDefined();
    // Sin grupo de tema: la interfaz va siempre en claro.
    expect(within(menu).queryAllByRole("menuitemradio")).toEqual([]);
  });

  it("cerrar sesión termina la sesión una sola vez y lleva al inicio de sesión", async () => {
    const user = userEvent.setup();
    const calls = api();
    navigation.pathname = "/";
    renderShell();
    const account = await screen.findByRole("button", { name: "Cuenta de Ana Admin" });
    await user.click(account);
    await user.click(await screen.findByRole("menuitem", { name: "Cerrar sesión" }));
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/iniciar-sesion"));
    expect(calls.filter((call) => call.key.startsWith("POST /api/auth/sign-out"))).toHaveLength(1);
  });

  it("toda la identidad abre el menú de cuenta, también en un teléfono", async () => {
    const user = userEvent.setup();
    setViewportWidth(390);
    api({ displayName: "Ferretería Andina" });
    navigation.pathname = "/";
    renderShell();
    // Un clic en el nombre de la empresa, dentro de la identidad, abre el menú.
    await user.click(await screen.findByText("Ferretería Andina"));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Mi cuenta" })).toBeDefined();
    expect(within(menu).queryAllByRole("menuitemradio")).toEqual([]);
  });
});

describe("saltar al contenido", () => {
  it("es el primer elemento enfocable y apunta al contenido principal", async () => {
    const user = userEvent.setup();
    api();
    renderShell();
    await screen.findByText("contenido");
    await user.tab();
    const skip = screen.getByRole("link", { name: "Saltar al contenido" });
    expect(document.activeElement).toBe(skip);
    const main = screen.getByRole("main");
    expect(main.id).toBe("contenido");
    expect(main.getAttribute("tabindex")).toBe("-1");
  });
});
