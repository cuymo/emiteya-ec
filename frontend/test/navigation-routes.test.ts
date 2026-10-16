// Modelo de rutas canónico (adopt-premium-design-foundation-and-shell, design D10 y D15; spec
// web-application-shell): cada página del frontend encaja, la visibilidad por rol, el destino actual
// de las pantallas internas, las migas jerárquicas, la creación rápida por permiso y la paridad del
// permiso de cada pantalla con el que comprueba su pantalla.
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import type { Permission } from "@/lib/permissions";
import {
  breadcrumbsFor,
  CREATE_ACTIONS,
  permissionsOf,
  resolveRoute,
  visibleCreateActions,
  visibleGroups,
} from "@/lib/navigation/routes";

const APP = join(__dirname, "..", "src", "app");

/** URL de cada `page.tsx`, sin grupos de rutas y con identificadores de ejemplo. */
function pageUrls(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return pageUrls(path);
    if (name !== "page.tsx") return [];
    const segments = relative(APP, directory)
      .split(sep)
      .filter((segment) => segment && !segment.startsWith("("))
      .map((segment) => (segment.startsWith("[") ? "x1" : segment));
    return [`/${segments.join("/")}`];
  });
}

const AUTHENTICATED = pageUrls(join(APP, "(app)"));

const labels = (can: ReturnType<typeof permissionsOf>) =>
  visibleGroups(can).map((group) => [
    group.label,
    group.destinations.map((destination) => destination.label),
  ]);

describe("modelo de rutas", () => {
  it("cada una de las 41 páginas autenticadas encaja con un destino o una pantalla interna", () => {
    // Las 42 páginas del frontend menos el inicio de sesión, que queda fuera del shell.
    expect(AUTHENTICATED).toHaveLength(41);
    expect(pageUrls(join(APP, "(auth)"))).toEqual(["/iniciar-sesion"]);
    for (const url of AUTHENTICATED) {
      expect(resolveRoute(url), url).not.toBeNull();
    }
  });

  it("el administrador ve todos los grupos y destinos, en el orden de la spec", () => {
    expect(labels(permissionsOf("ADMIN"))).toEqual([
      ["Inicio", ["Inicio"]],
      // Corrección del control de calidad UX (design D25): Borradores pasa a Ventas como «Borradores
      // de facturas» y Comprobantes se llama «Archivo de comprobantes»; las rutas no cambian.
      ["Ventas", ["Facturas", "Borradores de facturas", "Notas de crédito", "Notas de débito"]],
      ["Compras", ["Liquidaciones de compra", "Retenciones"]],
      ["Logística", ["Guías de remisión", "Inventario"]],
      ["Documentos", ["Archivo de comprobantes"]],
      ["Maestros", ["Terceros", "Productos"]],
      ["Análisis", ["Reportes"]],
      [
        "Configuración",
        [
          "Empresa",
          "Ambiente",
          "Establecimientos",
          "Secuenciales",
          "Firma electrónica",
          "Catálogos fiscales",
          "Usuarios",
          "Portabilidad de datos",
        ],
      ],
    ]);
  });

  it("el operador ve los mismos grupos hasta Análisis y en Configuración solo Catálogos fiscales", () => {
    const groups = labels(permissionsOf("OPERATOR"));
    expect(groups.slice(0, 7)).toEqual(labels(permissionsOf("ADMIN")).slice(0, 7));
    expect(groups.at(-1)).toEqual(["Configuración", ["Catálogos fiscales"]]);
  });

  it("un grupo sin destinos visibles no aparece", () => {
    const groups = visibleGroups((permission) => permission === "invoices.read");
    expect(groups.map((group) => group.label)).toEqual(["Inicio", "Ventas"]);
  });

  it("marca el destino de las pantallas internas", () => {
    const destination = (url: string) => resolveRoute(url)?.destination.label;
    expect(destination("/facturas/abc")).toBe("Facturas");
    expect(destination("/notas-credito/borradores/d1")).toBe("Notas de crédito");
    expect(destination("/notas-credito/borradores/nueva")).toBe("Notas de crédito");
    // El editor de facturas pertenece a Facturas, antes y después del primer guardado
    // (productize-invoice-editor-and-composition-foundation, D12 y PO-1; sustituye a la D25 de
    // adopt-premium-design-foundation-and-shell, que lo colgaba de Borradores de facturas).
    expect(destination("/borradores/nuevo")).toBe("Facturas");
    expect(destination("/borradores/d-1")).toBe("Facturas");
    expect(resolveRoute("/borradores/nuevo")?.group?.label).toBe("Ventas");
    expect(resolveRoute("/borradores")?.destination.href).toBe("/borradores");
    expect(resolveRoute("/comprobantes")?.destination.label).toBe("Archivo de comprobantes");
    expect(destination("/inventario/p1")).toBe("Inventario");
    expect(destination("/")).toBe("Inicio");
    expect(destination("/mi-cuenta")).toBe("Mi cuenta");
  });

  it("una ruta sin patrón conserva su destino por prefijo y no se guarda", () => {
    const route = resolveRoute("/facturas/abc/otra");
    expect(route?.destination.label).toBe("Facturas");
    expect(route?.permission).toBeNull();
    expect(resolveRoute("/nada-que-ver")).toBeNull();
  });
});

describe("migas", () => {
  const crumbs = (url: string, record?: string) =>
    breadcrumbsFor(resolveRoute(url), record).map((crumb) =>
      crumb.current
        ? `[${crumb.label}]`
        : crumb.href
          ? `${crumb.label}→${crumb.href}`
          : crumb.label,
    );

  it("una pantalla interna muestra su grupo, su destino como enlace y la pantalla actual", () => {
    expect(crumbs("/facturas/abc")).toEqual([
      "Ventas",
      "Facturas→/facturas",
      "[Detalle de factura]",
    ]);
    expect(crumbs("/facturas/abc", "001-001-000000123")).toEqual([
      "Ventas",
      "Facturas→/facturas",
      "[001-001-000000123]",
    ]);
    expect(crumbs("/notas-credito/borradores/d1")).toEqual([
      "Ventas",
      "Notas de crédito→/notas-credito",
      "[Borrador de nota de crédito]",
    ]);
    expect(crumbs("/inventario/p1", "Tornillo 3/8")).toEqual([
      "Logística",
      "Inventario→/inventario",
      "[Tornillo 3/8]",
    ]);
    // productize-invoice-editor-and-composition-foundation, D12 y PO-1.
    expect(crumbs("/borradores/nuevo")).toEqual([
      "Ventas",
      "Facturas→/facturas",
      "[Nueva factura]",
    ]);
    expect(crumbs("/borradores/d-1")).toEqual([
      "Ventas",
      "Facturas→/facturas",
      "[Borrador de factura]",
    ]);
  });

  it("un destino muestra su grupo y su nombre; Inicio y Mi cuenta, solo su nombre", () => {
    expect(crumbs("/configuracion/empresa")).toEqual(["Configuración", "[Empresa]"]);
    expect(crumbs("/facturas")).toEqual(["Ventas", "[Facturas]"]);
    expect(crumbs("/comprobantes")).toEqual(["Documentos", "[Archivo de comprobantes]"]);
    expect(crumbs("/")).toEqual(["[Inicio]"]);
    expect(crumbs("/mi-cuenta")).toEqual(["[Mi cuenta]"]);
    expect(crumbs("/nada-que-ver")).toEqual([]);
  });
});

describe("creación rápida", () => {
  it("administrador y operador ven las seis pantallas de creación existentes", () => {
    for (const role of ["ADMIN", "OPERATOR"] as const) {
      expect(visibleCreateActions(permissionsOf(role)).map((action) => action.href)).toEqual([
        "/borradores/nuevo",
        "/notas-credito/borradores/nueva",
        "/notas-debito/borradores/nueva",
        "/retenciones/borradores/nueva",
        "/guias-remision/borradores/nueva",
        "/liquidaciones-compra/borradores/nueva",
      ]);
    }
  });

  it("una acción sin permiso de borrador no aparece", () => {
    const actions = visibleCreateActions((permission) => permission !== "withholdings.draft");
    expect(actions.map((action) => action.label)).not.toContain("Nueva retención");
    expect(actions).toHaveLength(CREATE_ACTIONS.length - 1);
  });

  it("cada acción lleva a una página que existe", () => {
    for (const action of CREATE_ACTIONS) {
      expect(AUTHENTICATED, action.href).toContain(action.href);
    }
  });
});

describe("paridad de permisos con las pantallas", () => {
  // Permiso que comprueba cada pantalla interna (`canSee` en su componente), revisado a mano.
  const SCREENS: Record<string, Permission> = {
    "/facturas/x1": "invoices.read",
    "/borradores/nuevo": "invoices.draft",
    "/borradores/x1": "invoices.draft",
    "/notas-credito/x1": "creditNotes.read",
    "/notas-credito/borradores/nueva": "creditNotes.draft",
    "/notas-credito/borradores/x1": "creditNotes.draft",
    "/notas-debito/x1": "debitNotes.read",
    "/notas-debito/borradores/nueva": "debitNotes.draft",
    "/notas-debito/borradores/x1": "debitNotes.draft",
    "/retenciones/x1": "withholdings.read",
    "/retenciones/borradores/nueva": "withholdings.draft",
    "/retenciones/borradores/x1": "withholdings.draft",
    "/guias-remision/x1": "shippingGuides.read",
    "/guias-remision/borradores/nueva": "shippingGuides.draft",
    "/guias-remision/borradores/x1": "shippingGuides.draft",
    "/liquidaciones-compra/x1": "purchaseSettlements.read",
    "/liquidaciones-compra/borradores/nueva": "purchaseSettlements.draft",
    "/liquidaciones-compra/borradores/x1": "purchaseSettlements.draft",
    "/inventario/x1": "inventory.read",
  };

  it("cada pantalla interna exige el permiso que comprueba su pantalla", () => {
    for (const [url, permission] of Object.entries(SCREENS)) {
      expect(resolveRoute(url)?.permission, url).toBe(permission);
    }
  });

  it("cada destino exige el permiso con que la navegación lo muestra", () => {
    for (const group of visibleGroups(() => true)) {
      for (const destination of group.destinations) {
        expect(resolveRoute(destination.href)?.permission).toBe(destination.permission);
      }
    }
  });
});
