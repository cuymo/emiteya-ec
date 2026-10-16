// Modelo de rutas canónico del shell (adopt-premium-design-foundation-and-shell, design D10 y D15;
// spec web-application-shell). Es la única fuente de la navegación lateral, el destino actual, las
// migas, la paleta de comandos, la creación rápida y la guarda de destino no permitido: ninguno de
// ellos tiene un mapa propio. Los permisos son un espejo de presentación de la política del servidor
// (`lib/permissions.ts`); la API sigue autorizando cada operación. Las palabras clave son sinónimos
// para la paleta de comandos (design D26): ayudan a reconocer un destino, nunca buscan registros.
import {
  BookOpenCheck,
  Building2,
  Contact,
  FileKey,
  FileMinus,
  FilePenLine,
  FilePlus,
  FileSpreadsheet,
  FileText,
  FolderArchive,
  Globe,
  HardDriveDownload,
  House,
  Package,
  ReceiptText,
  Settings,
  ShoppingBasket,
  Store,
  Truck,
  UserRound,
  Users,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "@facturador/contracts";
import { canSee, type Permission } from "@/lib/permissions";

/** Un destino de la navegación. `permission: null` lo ve cualquier usuario con sesión. */
export type Destination = {
  href: string;
  label: string;
  icon: LucideIcon;
  permission: Permission | null;
  /** Sinónimos que la paleta de comandos reconoce (design D26). */
  keywords?: readonly string[];
};

export type NavGroup = {
  id: string;
  label: string;
  /**
   * Una sección que agrupa ajustes; los grupos operativos solo agrupan. En la barra, una sección se
   * pliega fuera de sus pantallas (design D24) y lleva su icono. Los dos aparecen en las migas.
   */
  section: boolean;
  icon?: LucideIcon;
  destinations: Destination[];
};

/** Una pantalla interna de un destino: su detalle o su editor. */
type InternalRoute = {
  pattern: RegExp;
  destination: string;
  leaf: string;
  permission: Permission;
};

export type CreateAction = {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  permission: Permission;
};

export const INICIO: Destination = { href: "/", label: "Inicio", icon: House, permission: null };
/**
 * `/configuracion`: la entrada a las pestañas de Configuración, que lleva a la primera que el rol ve.
 * Sin permiso propio: cada pestaña tiene el suyo.
 */
export const CONFIGURATION_INDEX: Destination = {
  href: "/configuracion",
  label: "Configuración",
  icon: Settings,
  permission: null,
};
export const MI_CUENTA: Destination = {
  href: "/mi-cuenta",
  label: "Mi cuenta",
  icon: UserRound,
  permission: null,
  keywords: ["contraseña", "password", "cuenta", "perfil"],
};

/** Grupos y destinos en el orden de la spec; como máximo dos niveles. */
export const NAV_GROUPS: readonly NavGroup[] = [
  { id: "inicio", label: "Inicio", section: false, destinations: [INICIO] },
  {
    id: "ventas",
    label: "Ventas",
    section: false,
    destinations: [
      { href: "/facturas", label: "Facturas", icon: FileText, permission: "invoices.read" },
      {
        // Solo borradores de factura: los demás comprobantes guardan los suyos en su destino.
        href: "/borradores",
        label: "Borradores de facturas",
        icon: FilePenLine,
        permission: "invoices.draft",
        keywords: ["borradores", "factura pendiente", "factura sin emitir"],
      },
      {
        href: "/notas-credito",
        label: "Notas de crédito",
        icon: FileMinus,
        permission: "creditNotes.read",
      },
      {
        href: "/notas-debito",
        label: "Notas de débito",
        icon: FilePlus,
        permission: "debitNotes.read",
      },
    ],
  },
  {
    id: "compras",
    label: "Compras",
    section: false,
    destinations: [
      {
        href: "/liquidaciones-compra",
        label: "Liquidaciones de compra",
        icon: ShoppingBasket,
        permission: "purchaseSettlements.read",
      },
      {
        href: "/retenciones",
        label: "Retenciones",
        icon: ReceiptText,
        permission: "withholdings.read",
      },
    ],
  },
  {
    id: "logistica",
    label: "Logística",
    section: false,
    destinations: [
      {
        href: "/guias-remision",
        label: "Guías de remisión",
        icon: Truck,
        permission: "shippingGuides.read",
      },
      { href: "/inventario", label: "Inventario", icon: Warehouse, permission: "inventory.read" },
    ],
  },
  {
    id: "documentos",
    label: "Documentos",
    section: false,
    destinations: [
      {
        // Vista transversal de los comprobantes de todos los tipos.
        href: "/comprobantes",
        label: "Archivo de comprobantes",
        icon: FolderArchive,
        permission: "archive.read",
        keywords: ["comprobantes", "documentos", "archivo", "facturas emitidas"],
      },
    ],
  },
  {
    id: "maestros",
    label: "Maestros",
    section: false,
    destinations: [
      {
        href: "/terceros",
        label: "Terceros",
        icon: Contact,
        permission: "parties.read",
        keywords: [
          "clientes",
          "cliente",
          "proveedores",
          "proveedor",
          "transportistas",
          "transportista",
          "contactos",
          "terceros",
        ],
      },
      { href: "/productos", label: "Productos", icon: Package, permission: "products.read" },
    ],
  },
  {
    id: "analisis",
    label: "Análisis",
    section: false,
    destinations: [
      { href: "/reportes", label: "Reportes", icon: FileSpreadsheet, permission: "reports.read" },
    ],
  },
  {
    id: "configuracion",
    label: "Configuración",
    section: true,
    icon: Settings,
    // Orden de las pestañas (decisión del propietario, 2026-10-16): Usuarios primero; la entrada
    // `/configuracion` lleva a la primera que el rol ve.
    destinations: [
      {
        href: "/configuracion/usuarios",
        label: "Usuarios",
        icon: Users,
        permission: "users.read",
      },
      {
        href: "/configuracion/empresa",
        label: "Empresa",
        icon: Building2,
        permission: "taxpayer.read",
      },
      {
        // Los puntos de emisión llevan sus secuenciales (antes, su propia pestaña).
        href: "/configuracion/establecimientos",
        label: "Establecimientos",
        icon: Store,
        permission: "establishments.manage",
        keywords: ["punto de emisión", "secuencial", "numeración", "número"],
      },
      {
        href: "/configuracion/firma",
        label: "Firma electrónica",
        icon: FileKey,
        permission: "certificate.read",
        keywords: ["certificado", "firma", "P12", "PKCS12"],
      },
      {
        href: "/configuracion/catalogos-fiscales",
        label: "Catálogos fiscales",
        icon: BookOpenCheck,
        permission: "fiscalCatalogs.read",
        keywords: ["IVA", "ICE", "IRBPNR", "impuestos", "formas de pago", "retenciones"],
      },
      {
        href: "/configuracion/ambiente",
        label: "Ambiente",
        icon: Globe,
        permission: "environment.change",
      },
      {
        href: "/configuracion/portabilidad",
        label: "Portabilidad de datos",
        icon: HardDriveDownload,
        permission: "dataPortability.export",
      },
    ],
  },
];

/** Pantallas internas de los comprobantes: detalle, nuevo borrador y borrador. */
function documentRoutes(
  base: string,
  noun: string,
  permissions: { read: Permission; draft: Permission },
  newLabel: string,
): InternalRoute[] {
  return [
    {
      pattern: new RegExp(`^${base}/borradores/nueva$`),
      destination: base,
      leaf: newLabel,
      permission: permissions.draft,
    },
    {
      pattern: new RegExp(`^${base}/borradores/[^/]+$`),
      destination: base,
      leaf: `Borrador de ${noun}`,
      permission: permissions.draft,
    },
    {
      pattern: new RegExp(`^${base}/[^/]+$`),
      destination: base,
      leaf: `Detalle de ${noun}`,
      permission: permissions.read,
    },
  ];
}

/** El orden importa: las rutas específicas van antes que las de identificador. */
export const INTERNAL_ROUTES: readonly InternalRoute[] = [
  {
    pattern: /^\/facturas\/[^/]+$/,
    destination: "/facturas",
    leaf: "Detalle de factura",
    permission: "invoices.read",
  },
  // El editor de facturas pertenece a Facturas, antes y después del primer guardado, que cambia
  // `/borradores/nuevo` por `/borradores/{id}` (design D12, PO-1). Borradores de facturas sigue
  // siendo la lista para retomarlos.
  {
    pattern: /^\/borradores\/nuevo$/,
    destination: "/facturas",
    leaf: "Nueva factura",
    permission: "invoices.draft",
  },
  {
    pattern: /^\/borradores\/[^/]+$/,
    destination: "/facturas",
    leaf: "Borrador de factura",
    permission: "invoices.draft",
  },
  ...documentRoutes(
    "/notas-credito",
    "nota de crédito",
    { read: "creditNotes.read", draft: "creditNotes.draft" },
    "Nueva nota de crédito",
  ),
  ...documentRoutes(
    "/notas-debito",
    "nota de débito",
    { read: "debitNotes.read", draft: "debitNotes.draft" },
    "Nueva nota de débito",
  ),
  ...documentRoutes(
    "/retenciones",
    "retención",
    { read: "withholdings.read", draft: "withholdings.draft" },
    "Nueva retención",
  ),
  ...documentRoutes(
    "/guias-remision",
    "guía de remisión",
    { read: "shippingGuides.read", draft: "shippingGuides.draft" },
    "Nueva guía de remisión",
  ),
  ...documentRoutes(
    "/liquidaciones-compra",
    "liquidación de compra",
    { read: "purchaseSettlements.read", draft: "purchaseSettlements.draft" },
    "Nueva liquidación de compra",
  ),
  {
    pattern: /^\/inventario\/[^/]+$/,
    destination: "/inventario",
    leaf: "Detalle de inventario",
    permission: "inventory.read",
  },
];

/** Creación rápida: solo lleva a las pantallas de creación existentes; nunca crea ni emite. */
export const CREATE_ACTIONS: readonly CreateAction[] = [
  {
    id: "factura",
    label: "Nueva factura",
    href: "/borradores/nuevo",
    icon: FileText,
    permission: "invoices.draft",
  },
  {
    id: "nota-credito",
    label: "Nueva nota de crédito",
    href: "/notas-credito/borradores/nueva",
    icon: FileMinus,
    permission: "creditNotes.draft",
  },
  {
    id: "nota-debito",
    label: "Nueva nota de débito",
    href: "/notas-debito/borradores/nueva",
    icon: FilePlus,
    permission: "debitNotes.draft",
  },
  {
    id: "retencion",
    label: "Nueva retención",
    href: "/retenciones/borradores/nueva",
    icon: ReceiptText,
    permission: "withholdings.draft",
  },
  {
    id: "guia-remision",
    label: "Nueva guía de remisión",
    href: "/guias-remision/borradores/nueva",
    icon: Truck,
    permission: "shippingGuides.draft",
  },
  {
    id: "liquidacion-compra",
    label: "Nueva liquidación de compra",
    href: "/liquidaciones-compra/borradores/nueva",
    icon: ShoppingBasket,
    permission: "purchaseSettlements.draft",
  },
];

/** Decide si un permiso está concedido; las pruebas pueden pasar un conjunto sintético. */
export type PermissionCheck = (permission: Permission) => boolean;

export function permissionsOf(role: Role | undefined): PermissionCheck {
  return (permission) => canSee(role, permission);
}

const allowed = (can: PermissionCheck, permission: Permission | null) =>
  permission === null || can(permission);

/** Los grupos con sus destinos visibles; un grupo sin destinos visibles no aparece. */
export function visibleGroups(can: PermissionCheck): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    destinations: group.destinations.filter((destination) => allowed(can, destination.permission)),
  })).filter((group) => group.destinations.length > 0);
}

/** Las secciones de Configuración que el rol ve, en el orden de la navegación: sus pestañas. */
export function configurationDestinations(can: PermissionCheck): Destination[] {
  return visibleGroups(can).find((group) => group.section)?.destinations ?? [];
}

export function visibleCreateActions(can: PermissionCheck): CreateAction[] {
  return CREATE_ACTIONS.filter((action) => can(action.permission));
}

export type ResolvedRoute = {
  destination: Destination;
  group: NavGroup | null;
  /** Etiqueta de la pantalla interna, o `null` en la pantalla del propio destino. */
  leaf: string | null;
  /** El permiso que exige la pantalla, o `null` si no hay guarda (ruta sin patrón o libre). */
  permission: Permission | null;
};

function findDestination(href: string): { destination: Destination; group: NavGroup | null } {
  if (href === MI_CUENTA.href) return { destination: MI_CUENTA, group: null };
  for (const group of NAV_GROUPS) {
    const destination = group.destinations.find((candidate) => candidate.href === href);
    if (destination) return { destination, group };
  }
  throw new Error(`destino desconocido: ${href}`);
}

/** Resuelve una ruta en su destino, su grupo, su pantalla interna y el permiso que exige. */
export function resolveRoute(pathname: string): ResolvedRoute | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const exact = [MI_CUENTA, ...NAV_GROUPS.flatMap((group) => group.destinations)].find(
    (destination) => destination.href === path,
  );
  if (exact) {
    return {
      ...findDestination(exact.href),
      leaf: null,
      permission: exact.permission,
    };
  }
  if (path === CONFIGURATION_INDEX.href) {
    return { destination: CONFIGURATION_INDEX, group: null, leaf: null, permission: null };
  }
  const internal = INTERNAL_ROUTES.find((route) => route.pattern.test(path));
  if (internal) {
    return {
      ...findDestination(internal.destination),
      leaf: internal.leaf,
      permission: internal.permission,
    };
  }
  // Una ruta sin patrón conserva su destino actual por prefijo, sin guarda.
  for (const group of NAV_GROUPS) {
    for (const destination of group.destinations) {
      if (destination.href !== "/" && path.startsWith(`${destination.href}/`)) {
        return { destination, group, leaf: null, permission: null };
      }
    }
  }
  return null;
}

export type Crumb = { label: string; href?: string; current?: boolean };

/**
 * Migas jerárquicas de la barra superior, después del enlace a Inicio: el grupo de la navegación, el
 * destino (un enlace en una pantalla interna) y la pantalla actual, que en un detalle es su registro.
 * Inicio no repite su grupo.
 */
export function breadcrumbsFor(route: ResolvedRoute | null, recordLabel?: string | null): Crumb[] {
  if (!route) return [];
  const crumbs: Crumb[] = [];
  if (route.group && route.group.id !== "inicio") crumbs.push({ label: route.group.label });
  if (route.leaf) {
    crumbs.push({ label: route.destination.label, href: route.destination.href });
    crumbs.push({ label: recordLabel || route.leaf, current: true });
  } else {
    crumbs.push({ label: route.destination.label, current: true });
  }
  return crumbs;
}
