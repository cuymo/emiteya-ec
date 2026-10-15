// Migas del shell (adopt-premium-design-foundation-and-shell, design D15; spec web-application-shell,
// «Migas de navegación»). Compone el primitivo `breadcrumb` con el modelo de rutas canónico: jerarquía
// sin repetir el título; una ruta de una sola miga no se muestra. Van siempre encima del título, nunca
// en la barra superior, en una sola línea que recorta la última miga
// (productize-invoice-editor-and-composition-foundation, design D2). Cada ruta tiene un solo dueño:
// la fila compartida del shell o el encabezado de una pantalla migrada, según el modelo de rutas.
"use client";

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
import { breadcrumbsFor, resolveRoute, type BreadcrumbOwner } from "@/lib/navigation/routes";
import { cn } from "@/lib/utils";
import { useBreadcrumbLabelValue } from "./breadcrumb-label";

export function AppBreadcrumbs({
  owner,
  className,
}: {
  /** Quién las pinta: solo se muestran si la ruta le da a él la orientación. */
  owner: BreadcrumbOwner;
  className?: string;
}) {
  const pathname = usePathname();
  const record = useBreadcrumbLabelValue();
  const route = resolveRoute(pathname);
  const crumbs = breadcrumbsFor(route, record);
  if (crumbs.length === 0 || route?.orientation !== owner) return null;
  return (
    <Breadcrumb className={cn("min-w-0", className)}>
      <BreadcrumbList className="flex-nowrap">
        {crumbs.map((crumb, index) => (
          <Fragment key={`${crumb.label}-${index}`}>
            {index > 0 && <BreadcrumbSeparator />}
            {/* Solo la última miga se recorta; las anteriores conservan su ancho. */}
            <BreadcrumbItem className={crumb.current ? "min-w-0" : "shrink-0"}>
              {crumb.current ? (
                <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
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
  );
}
