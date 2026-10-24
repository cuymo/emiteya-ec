// Superficie de las listas (data-tables.md, «Standard Anatomy»). Composición portada de
// `src/app/(main)/dashboard/users/_components/users.tsx` de la plantilla «Studio Admin» (MIT;
// frontend/THIRD_PARTY_NOTICES.md): una tarjeta con el título y la descripción a la izquierda, la
// búsqueda y las acciones a la derecha, una fila de filtros y la tabla a todo el ancho de la tarjeta.
// - El título es el encabezado de la pantalla (`h1`), o de su sección (`h2`) cuando la tabla es una
//   parte de una página mayor.
// - En un teléfono, las acciones bajan debajo del título y la búsqueda ocupa la fila entera.
// - Si la búsqueda y sus controles no caben junto al título, bajan a su propia fila, a la derecha;
//   con `headerSplit`, la cabecera va en dos columnas, 25 % y 75 %.
// - Sin casillas de selección ni contador: el producto no tiene acciones masivas.
// - Es una región con el nombre de su título, como las pantallas a las que sustituye.
import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function DataTableCard({
  title,
  titleId,
  titleAs: Heading = "h1",
  description,
  search,
  actions,
  filters,
  filtersEnd,
  filtersFill = false,
  headerSplit = false,
  lead,
  className,
  busy,
  children,
}: {
  title: ReactNode;
  titleId: string;
  titleAs?: "h1" | "h2";
  description?: ReactNode;
  /** Búsqueda de la lista, a la derecha del título. */
  search?: ReactNode;
  /** Acción principal y secundarias de la lista, después de la búsqueda. */
  actions?: ReactNode;
  /** Filtros de la lista, en su propia fila sobre la tabla. */
  filters?: ReactNode;
  /** Al final de la fila de filtros, como «Limpiar filtros». */
  filtersEnd?: ReactNode;
  /** Los filtros ocupan toda su fila (refine-archive-search). */
  filtersFill?: boolean;
  /**
   * Cabecera en dos columnas desde 768 px: el título y la descripción en el 25 % izquierdo, y la
   * búsqueda y sus controles en el 75 % derecho, en una sola fila que ocupan entera (decisión del
   * propietario, 2026-10-24).
   */
  headerSplit?: boolean;
  /** Antes de los filtros, como los borradores en curso del módulo. */
  lead?: ReactNode;
  className?: string;
  /** La pantalla todavía lee sus parámetros: la región se anuncia ocupada. */
  busy?: boolean;
  /** La tabla, su estado o su esqueleto. */
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={titleId} aria-busy={busy || undefined}>
      <Card data-slot="data-table-card" className={className}>
        <CardHeader
          className={cn(
            "flex flex-col gap-3 border-b",
            headerSplit
              ? "md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,3fr)] md:grid-rows-1! md:items-center md:gap-6"
              : "md:flex-row md:flex-wrap md:items-start md:justify-between",
          )}
        >
          <div className="flex min-w-0 flex-col gap-1.5">
            <Heading id={titleId} className="text-xl leading-none font-semibold">
              {title}
            </Heading>
            {description && (
              <CardDescription className="max-w-prose leading-snug">{description}</CardDescription>
            )}
          </div>
          {(search || actions) && (
            <div
              className={cn(
                "flex w-full flex-wrap items-center gap-2 md:ml-auto md:w-auto md:flex-nowrap md:justify-end",
                headerSplit && "md:w-full",
              )}
            >
              {search}
              {actions}
            </div>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-4 px-0">
          {lead && <div className="px-4 empty:hidden">{lead}</div>}
          {(filters || filtersEnd) && (
            <div className="flex flex-wrap items-center justify-between gap-3 px-4">
              <div
                className={cn(
                  "flex flex-wrap items-center gap-3 max-md:w-full",
                  filtersFill && "w-full",
                  !filters && "hidden",
                )}
              >
                {filters}
              </div>
              {filtersEnd}
            </div>
          )}
          {children}
        </CardContent>
      </Card>
    </section>
  );
}
