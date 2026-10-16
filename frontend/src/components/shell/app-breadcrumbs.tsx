// Migas de la pantalla en la barra superior, a la izquierda (decisión del propietario sobre la
// cabecera; spec web-application-shell, «Migas de navegación»). Compone el primitivo `breadcrumb` con
// el modelo de rutas canónico: la ruta desde Inicio, separada con barras, con la pantalla actual en el
// color de marca. Sin título: el `h1` de la pantalla, justo debajo, ya la nombra. En un teléfono no se
// muestran: no caben junto al contexto global.
"use client";

import { House } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment } from "react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { breadcrumbsFor, resolveRoute } from "@/lib/navigation/routes";
import { useBreadcrumbLabelValue } from "./breadcrumb-label";

export function TopbarHeading() {
  const pathname = usePathname();
  const record = useBreadcrumbLabelValue();
  const crumbs = breadcrumbsFor(resolveRoute(pathname), record);
  if (crumbs.length === 0) return null;
  return (
    // El espacio que deja la barra es el contenedor: si no alcanza, quedan Inicio y la miga actual.
    <div data-slot="topbar-heading" className="@container flex min-w-0 flex-1 max-md:hidden">
      <Breadcrumb className="min-w-0">
        <BreadcrumbList className="flex-nowrap gap-2 text-sm leading-none">
          <BreadcrumbItem className="shrink-0">
            <BreadcrumbLink asChild>
              <Link href="/" aria-label="Inicio">
                <House aria-hidden="true" className="size-4" />
              </Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          {crumbs.map((crumb, index) => (
            <Fragment key={`${crumb.label}-${index}`}>
              <BreadcrumbSeparator className={crumb.current ? undefined : "@max-3xs:hidden"}>
                /
              </BreadcrumbSeparator>
              {/* Solo la última miga se recorta; las anteriores conservan su ancho o se ocultan. */}
              <BreadcrumbItem className={crumb.current ? "min-w-0" : "shrink-0 @max-3xs:hidden"}>
                {crumb.current ? (
                  <BreadcrumbPage className="text-primary">{crumb.label}</BreadcrumbPage>
                ) : crumb.href ? (
                  <BreadcrumbLink asChild>
                    <Link href={crumb.href}>{crumb.label}</Link>
                  </BreadcrumbLink>
                ) : (
                  <span>{crumb.label}</span>
                )}
              </BreadcrumbItem>
            </Fragment>
          ))}
        </BreadcrumbList>
      </Breadcrumb>
    </div>
  );
}
