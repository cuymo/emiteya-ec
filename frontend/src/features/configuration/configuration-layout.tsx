// Configuración en una sola página con pestañas (decisión del propietario, 2026-10-16): Empresa,
// Ambiente, Establecimientos, Secuenciales, Firma electrónica, Catálogos fiscales, Usuarios y
// Portabilidad de datos, en el orden de la navegación y solo las que el rol ve. Cada pestaña es un
// enlace a su propia dirección, así que conserva su enlace directo, su permiso y su título; la barra
// lateral solo lleva «Configuración».
// Debajo de las pestañas, el panel toma el ancho que declara la pantalla (`data-panel-width`:
// formulario o lectura), alineado con ellas, mientras las pestañas ocupan la columna entera.
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { useSession } from "@/components/session";
import { tabTriggerClassName } from "@/components/ui/tabs";
import { configurationDestinations, permissionsOf, resolveRoute } from "@/lib/navigation/routes";

export function ConfigurationLayout({ children }: { children: ReactNode }) {
  const { me } = useSession();
  const pathname = usePathname();
  const tabs = configurationDestinations(permissionsOf(me.role));
  const activeHref = resolveRoute(pathname)?.destination.href;
  const nav = useRef<HTMLElement>(null);

  // En una pantalla estrecha, la pestaña actual queda a la vista dentro de la fila desplazable.
  useEffect(() => {
    nav.current
      ?.querySelector<HTMLElement>('[aria-current="page"]')
      ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [activeHref]);

  return (
    <div data-slot="configuration-layout" className="flex flex-col gap-6">
      <nav
        ref={nav}
        aria-label="Secciones de configuración"
        className="flex w-full items-center gap-1 overflow-x-auto border-b border-border"
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = tab.href === activeHref;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={tabTriggerClassName}
            >
              <Icon aria-hidden="true" />
              {tab.label}
            </Link>
          );
        })}
      </nav>
      <div
        data-slot="configuration-panel"
        className="w-full has-data-[panel-width=form]:max-w-form has-data-[panel-width=reading]:max-w-reading"
      >
        {children}
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
