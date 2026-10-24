// Configuración en una sola página con pestañas (decisión del propietario, 2026-10-16): Usuarios,
// Empresa, Establecimientos (con los secuenciales de cada punto), Firma electrónica, Catálogos
// fiscales, Ambiente y Portabilidad de datos, en el orden de la navegación y solo las que el rol
// ve. Cada pestaña es un enlace a su propia dirección, así que conserva su enlace directo, su permiso
// y su título; la barra lateral solo lleva «Configuración».
// Con espacio (`@settings-nav:`), las pestañas son una columna vertical a la izquierda, como una
// barra lateral, fija al desplazar, y el panel va a su derecha (decisión del propietario,
// 2026-10-23); en una pantalla angosta siguen en una fila desplazable encima del panel. El panel toma
// el ancho que declara la pantalla (`data-panel-width`: formulario o lectura). Una pantalla sin
// título propio puede centrarlo con `data-panel-align="center"` (Establecimientos). La columna lleva el
// fondo de la barra lateral izquierda (`bg-sidebar`) y llega hasta el pie de la ventana (decisiones
// del propietario, 2026-10-24): su alto mínimo es 100dvh menos donde empieza, medido al montar,
// porque la cabecera cambia de alto con el ambiente y los avisos.
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { useSession } from "@/components/session";
import { tabTriggerClassName } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { configurationDestinations, permissionsOf, resolveRoute } from "@/lib/navigation/routes";

/**
 * En la columna vertical, cada sección como un destino de la barra lateral: a todo el ancho,
 * alineada a la izquierda, sin la raya de la pestaña y con el fondo azul suave de lo activo, también
 * bajo el puntero.
 */
const SIDE_TAB_CLASS_NAME = cn(
  "@settings-nav:h-9 @settings-nav:justify-start @settings-nav:rounded-md @settings-nav:px-3 @settings-nav:after:hidden",
  "@settings-nav:hover:bg-active @settings-nav:hover:text-active-foreground",
  "@settings-nav:aria-[current=page]:bg-active @settings-nav:aria-[current=page]:font-semibold @settings-nav:aria-[current=page]:text-active-foreground",
);

export function ConfigurationLayout({ children }: { children: ReactNode }) {
  const { me } = useSession();
  const pathname = usePathname();
  const tabs = configurationDestinations(permissionsOf(me.role));
  const activeHref = resolveRoute(pathname)?.destination.href;
  const nav = useRef<HTMLElement>(null);
  // Dónde empieza la columna con la página arriba, más el margen inferior del contenido (24 px).
  // Por el CSSOM y no con un atributo `style`, que la CSP bloquea en el HTML del servidor.
  useLayoutEffect(() => {
    const measure = () => {
      const element = nav.current;
      if (!element) return;
      const top = Math.round(element.getBoundingClientRect().top + window.scrollY + 24);
      element.style.setProperty("--configuration-nav-top", `${top}px`);
      // Pegada bajo la barra superior fija (su borde inferior, que incluye la franja del ambiente),
      // con el margen del contenido.
      const topbar = document
        .getElementById("contenido")
        ?.parentElement?.querySelector(":scope > header");
      const stick = Math.round((topbar?.getBoundingClientRect().bottom ?? 64) + 24);
      element.style.setProperty("--configuration-nav-stick", `${stick}px`);
    };
    measure();
    window.addEventListener("resize", measure);
    // La franja del ambiente y los avisos llegan después de montar y bajan la columna.
    const shell = document.getElementById("contenido")?.parentElement;
    const observer =
      shell && typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (shell) observer?.observe(shell);
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, []);

  // En una pantalla estrecha, la pestaña actual queda a la vista dentro de la fila desplazable.
  useEffect(() => {
    nav.current
      ?.querySelector<HTMLElement>('[aria-current="page"]')
      ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [activeHref]);

  return (
    <div data-slot="configuration-layout" className="@container">
      <div className="flex flex-col gap-6 @settings-nav:grid @settings-nav:grid-cols-settings-nav @settings-nav:items-start @settings-nav:gap-8">
        <nav
          ref={nav}
          aria-label="Secciones de configuración"
          data-tour="configuracion-secciones"
          className={cn(
            "flex w-full items-center gap-1 overflow-x-auto border-b border-border",
            "@settings-nav:sticky @settings-nav:top-(--configuration-nav-stick,4rem) @settings-nav:flex-col @settings-nav:items-stretch @settings-nav:overflow-visible @settings-nav:border-b-0",
            "@settings-nav:rounded-lg @settings-nav:bg-sidebar @settings-nav:p-2",
            "@settings-nav:min-h-[calc(100dvh-var(--configuration-nav-top,9rem))]",
          )}
        >
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = tab.href === activeHref;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(tabTriggerClassName, SIDE_TAB_CLASS_NAME)}
              >
                <Icon aria-hidden="true" />
                {tab.label}
              </Link>
            );
          })}
        </nav>
        <div
          data-slot="configuration-panel"
          className="w-full min-w-0 has-data-[panel-align=center]:mx-auto has-data-[panel-width=form]:max-w-form has-data-[panel-width=reading]:max-w-reading"
        >
          {children}
        </div>
      </div>
    </div>
  );
}

/** `/configuracion` lleva a la primera pestaña que el rol ve. */
export function ConfigurationIndex() {
  const { me } = useSession();
  const first = configurationDestinations(permissionsOf(me.role))[0]?.href;
  const router = useRouter();
  useEffect(() => {
    if (first) router.replace(first);
  }, [first, router]);
  return (
    <span className="sr-only" role="status">
      Abriendo la configuración
    </span>
  );
}
