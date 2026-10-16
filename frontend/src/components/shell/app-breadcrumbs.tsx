// Título y migas de la pantalla en la barra superior, a la izquierda (decisión del propietario sobre
// la cabecera; spec web-application-shell, «Migas de navegación»). Compone el primitivo `breadcrumb`
// con el modelo de rutas canónico: el título de la pantalla encima y, debajo, la ruta desde Inicio,
// separada con barras, con la pantalla actual en el color de marca. En un teléfono no se muestra: no
// cabe junto al contexto global y el `h1` de la pantalla, justo debajo, ya orienta. El título no es
// un encabezado: el `h1` sigue siendo el de la pantalla.
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
import { breadcrumbsFor, pageTitleFor, resolveRoute } from "@/lib/navigation/routes";
import { useBreadcrumbLabelValue } from "./breadcrumb-label";

export function TopbarHeading() {
  const pathname = usePathname();
  const record = useBreadcrumbLabelValue();
  const route = resolveRoute(pathname);
  const title = pageTitleFor(route);
  const crumbs = breadcrumbsFor(route, record);
  if (!title) return null;
  return (
    <div data-slot="topbar-heading" className="flex min-w-0 flex-col gap-1 max-md:hidden">
      <p className="truncate text-lg leading-tight font-semibold">{title}</p>
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
              <BreadcrumbSeparator>/</BreadcrumbSeparator>
              {/* Solo la última miga se recorta; las anteriores conservan su ancho. */}
              <BreadcrumbItem className={crumb.current ? "min-w-0" : "shrink-0"}>
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
