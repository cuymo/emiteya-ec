// Migas del shell (adopt-premium-design-foundation-and-shell, design D15; spec web-application-shell,
// «Migas de navegación»). Compone el primitivo `breadcrumb` con el modelo de rutas canónico: jerarquía
// sin repetir el título; una ruta de una sola miga no se muestra.
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
import { breadcrumbsFor, resolveRoute } from "@/lib/navigation/routes";
import { cn } from "@/lib/utils";
import { useBreadcrumbLabelValue } from "./breadcrumb-label";

export function AppBreadcrumbs({ className }: { className?: string }) {
  const pathname = usePathname();
  const record = useBreadcrumbLabelValue();
  const crumbs = breadcrumbsFor(resolveRoute(pathname), record);
  if (crumbs.length === 0) return null;
  return (
    <Breadcrumb className={cn("min-w-0", className)}>
      <BreadcrumbList className="flex-nowrap">
        {crumbs.map((crumb, index) => (
          <Fragment key={`${crumb.label}-${index}`}>
            {index > 0 && <BreadcrumbSeparator />}
            <BreadcrumbItem className={cn(crumb.current && "min-w-0")}>
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
