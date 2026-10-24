// Tramos del recorrido de bienvenida (add-onboarding-tour, design D2): Inicio, Configuración y la
// primera factura, cada uno en su pantalla, con el permiso que lo habilita. Los textos son fijos:
// driver.js los escribe con `innerHTML`, así que nunca llevan datos del usuario ni de la empresa.
import type { PermissionCheck } from "@/lib/navigation/routes";
import type { Permission } from "@/lib/permissions";

export type TourStep = {
  /** El elemento que señala; sin selector, una ventana centrada. */
  selector?: string;
  title: string;
  description: string;
  side?: "top" | "bottom" | "left" | "right";
};

export type TourSegment = {
  id: string;
  /** El nombre del tramo en el progreso: «Inicio · 2 de 5». */
  label: string;
  path: string;
  permission: Permission;
  steps: readonly TourStep[];
};

/** Selector de un ancla `data-tour` de una pantalla. */
export const anchor = (name: string) => `[data-tour="${name}"]`;

const SETTINGS = anchor("configuracion-secciones");
const settingsTab = (href: string) => `${SETTINGS} a[href="${href}"]`;

export const TOUR_SEGMENTS: readonly TourSegment[] = [
  {
    id: "inicio",
    label: "Inicio",
    path: "/",
    permission: "invoices.read",
    steps: [
      {
        title: "Te damos la bienvenida a EmiteYa",
        description:
          "En un minuto te mostramos lo esencial: tu resumen, la configuración de tu empresa y cómo emitir tu primera factura.",
      },
      {
        selector: anchor("primeros-pasos"),
        title: "Lo que falta para emitir",
        description:
          "Mientras tu empresa no pueda emitir, este botón te lleva a Primeros pasos: qué completar y dónde hacerlo.",
        side: "bottom",
      },
      {
        selector: anchor("inicio-indicadores"),
        title: "Tu mes de un vistazo",
        description:
          "Ventas autorizadas, facturas autorizadas, problemas de autorización y borradores. La flecha de cada tarjeta abre su lista.",
        side: "bottom",
      },
      {
        selector: anchor("inicio-estado"),
        title: "Estado de facturación electrónica",
        description:
          "La firma electrónica, la conexión con el SRI y el envío de tus comprobantes por correo. Revísalo si algo deja de funcionar.",
        side: "left",
      },
      {
        selector: 'nav[aria-label="Navegación principal"] a[href^="/configuracion"]',
        title: "Configuración",
        description:
          "Los datos de tu empresa, tus establecimientos, la firma electrónica y los correos. Vamos a verla.",
        side: "right",
      },
    ],
  },
  {
    id: "configuracion",
    label: "Configuración",
    path: "/configuracion/empresa",
    permission: "taxpayer.configure",
    steps: [
      {
        selector: SETTINGS,
        title: "Las secciones de Configuración",
        description:
          "La primera vez, recórrelas en este orden. Te contamos para qué sirve cada una.",
        side: "right",
      },
      {
        selector: settingsTab("/configuracion/empresa"),
        title: "Empresa",
        description:
          "El RUC, la razón social, la dirección y el logo que aparecen en tus comprobantes.",
        side: "right",
      },
      {
        selector: settingsTab("/configuracion/establecimientos"),
        title: "Establecimientos",
        description:
          "Tus establecimientos y puntos de emisión, con la numeración de cada comprobante.",
        side: "right",
      },
      {
        selector: settingsTab("/configuracion/firma"),
        title: "Firma electrónica",
        description: "Carga tu firma electrónica (archivo .p12). Sin ella no puedes emitir.",
        side: "right",
      },
      {
        selector: settingsTab("/configuracion/correos"),
        title: "Correos",
        description: "El servidor de correo con el que tus comprobantes llegan a tus clientes.",
        side: "right",
      },
      {
        selector: settingsTab("/configuracion/ambiente"),
        title: "Ambiente",
        description:
          "Empiezas en Pruebas, donde los comprobantes no tienen validez tributaria. Cambia a Producción cuando estés listo.",
        side: "right",
      },
    ],
  },
  {
    id: "factura",
    label: "Primera factura",
    path: "/borradores/nuevo",
    permission: "invoices.draft",
    steps: [
      {
        selector: anchor("factura-comprador"),
        title: "1. Elige el comprador",
        description:
          "Este es el editor que abre «Nueva factura» en Facturas. Empieza por un cliente registrado o por Consumidor final.",
        side: "bottom",
      },
      {
        selector: anchor("factura-productos"),
        title: "2. Agrega los productos",
        description:
          "Búscalos en tu catálogo. Los impuestos y el total se calculan solos, y el pago se pide cuando ya hay algo que cobrar.",
        side: "top",
      },
      {
        selector: anchor("factura-emitir"),
        title: "3. Emite la factura",
        description:
          "«Emitir factura» guarda el borrador, lo firma y lo envía al SRI. Antes te pide confirmar el comprador, el total y el ambiente.",
        side: "top",
      },
      {
        title: "¡Listo!",
        description:
          "Ya puedes emitir tu primera factura. Si quieres volver a ver este recorrido, está en el menú de tu cuenta.",
      },
    ],
  },
];

/** Los tramos que el rol puede recorrer, en su orden. */
export function tourSegments(can: PermissionCheck): TourSegment[] {
  return TOUR_SEGMENTS.filter((segment) => can(segment.permission));
}
