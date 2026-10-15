// Rejilla de campos (`FormGrid`) y fila de campos alineados (`FormFieldRow`)
// (productize-invoice-editor-and-composition-foundation, design D7). Composición tomada de
// `invoice/_components/invoice-details.tsx` de la plantilla «Studio Admin» (MIT;
// frontend/THIRD_PARTY_NOTICES.md), sobre el `FormField` existente: no hay otro sistema de campo.
// - Las columnas dependen del contenedor, no de la ventana, porque el ancho útil cambia con la barra
//   lateral.
// - Con varias columnas, cada campo ocupa tres filas de una `subgrid` (etiqueta, control y mensaje):
//   las etiquetas y los controles de una fila comparten la y, aunque solo un campo tenga ayuda.
// - Cada rejilla es una fila de campos; con una columna, los campos se apilan con su separación.
// - Las columnas son `minmax(0, 1fr)`: un contenido que no se parte, como el nombre del comprador,
//   se recorta en lugar de ensanchar la página (a 320 px desbordaba 18 px).
"use client";

import { createContext, useContext, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const LAYOUTS = {
  /** Dos columnas iguales desde 40rem de contenedor (`--container-form-wide`). */
  pair: {
    grid: "grid grid-cols-1 gap-4 @form-wide:grid-cols-2 @form-wide:gap-x-4 @form-wide:gap-y-1",
    field: "@form-wide:row-span-3 @form-wide:grid @form-wide:grid-rows-subgrid",
  },
  /** Forma de pago fluida, e importe con su «Quitar», desde 32rem de contenedor. */
  payment: {
    grid: "grid grid-cols-1 gap-3 @lg:grid-cols-payment @lg:gap-x-3 @lg:gap-y-1",
    field: "@lg:row-span-3 @lg:grid @lg:grid-rows-subgrid",
  },
} as const;

export type FormRowLayout = keyof typeof LAYOUTS;

const FormRowContext = createContext<FormRowLayout | null>(null);

/** Clases que alinean un `FormField` con los demás de su fila; vacío fuera de una fila. */
export function useFormRowFieldClass(): string {
  const layout = useContext(FormRowContext);
  return layout ? LAYOUTS[layout].field : "";
}

/** Campos en columnas por contenedor, alineados por etiqueta, control y mensaje. */
export function FormGrid({
  columns = "pair",
  className,
  children,
}: {
  columns?: "pair";
  className?: string;
  children: ReactNode;
}) {
  return (
    <div data-slot="form-grid" className={cn("@container", className)}>
      <div className={LAYOUTS[columns].grid}>
        <FormRowContext.Provider value={columns}>{children}</FormRowContext.Provider>
      </div>
    </div>
  );
}

/**
 * Una fila de campos que se leen como una unidad, como una forma de pago: un `fieldset` con su
 * leyenda, para que una acción en línea (quitar) quede asociada a su fila a cualquier anchura.
 */
export function FormFieldRow({
  legend,
  layout,
  className,
  children,
}: {
  /** Leyenda del grupo, que nombra la fila para las tecnologías de asistencia. */
  legend: string;
  layout: FormRowLayout;
  className?: string;
  children: ReactNode;
}) {
  return (
    <fieldset data-slot="form-field-row" className={cn("@container min-w-0", className)}>
      <legend className="sr-only">{legend}</legend>
      <div className={LAYOUTS[layout].grid}>
        <FormRowContext.Provider value={layout}>{children}</FormRowContext.Provider>
      </div>
    </fieldset>
  );
}
