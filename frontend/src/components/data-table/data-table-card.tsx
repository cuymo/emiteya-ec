// Superficie de las listas (data-tables.md, «Standard Anatomy»). Composición portada de
// `src/app/(main)/dashboard/users/_components/users.tsx` de la plantilla «Studio Admin» (MIT;
// frontend/THIRD_PARTY_NOTICES.md): una tarjeta con el título y la descripción a la izquierda, la
// búsqueda y las acciones a la derecha, una fila de filtros y la tabla a todo el ancho de la tarjeta.
// - El título es el encabezado de la pantalla (`h1`), o de su sección (`h2`) cuando la tabla es una
//   parte de una página mayor.
// - En un teléfono, las acciones bajan debajo del título y la búsqueda ocupa la fila entera.
// - Sin casillas de selección ni contador: el producto no tiene acciones masivas.
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
  className,
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
  className?: string;
  /** La tabla, su estado o su esqueleto. */
  children: ReactNode;
}) {
  return (
    <Card data-slot="data-table-card" className={className}>
      <CardHeader className="flex flex-col gap-3 border-b md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Heading id={titleId} className="text-xl leading-none font-semibold">
            {title}
          </Heading>
          {description && (
            <CardDescription className="max-w-prose leading-snug">{description}</CardDescription>
          )}
        </div>
        {(search || actions) && (
          <div className="flex w-full flex-wrap items-center gap-2 md:w-auto md:flex-nowrap md:justify-end">
            {search}
            {actions}
          </div>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4 px-0">
        {(filters || filtersEnd) && (
          <div className="flex flex-wrap items-center justify-between gap-3 px-4">
            <div className={cn("flex flex-wrap items-center gap-3", !filters && "hidden")}>
              {filters}
            </div>
            {filtersEnd}
          </div>
        )}
        {children}
      </CardContent>
    </Card>
  );
}
