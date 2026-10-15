// Barra de herramientas de la tabla compartida (productize-invoice-list-and-shared-table-foundation,
// design D5; data-tables.md, «Standard Anatomy»). Visual portado de
// `src/app/(main)/dashboard/tasks/_components/tasks-toolbar.tsx` de la plantilla «Studio Admin» (MIT;
// frontend/THIRD_PARTY_NOTICES.md). Primera fila: búsqueda, vistas y filtros, que se apilan en
// pantallas estrechas. Segunda fila, solo con filtros activos: los filtros activos y «Limpiar
// filtros».
import type { ReactNode } from "react";

export function DataTableToolbar({
  children,
  activeFilters,
}: {
  children: ReactNode;
  activeFilters?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">{children}</div>
      {activeFilters}
    </div>
  );
}
