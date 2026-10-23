// Distribución de un formulario con panel (productize-invoice-editor-and-composition-foundation,
// design D5 y D8). Contenedor con `@container`: el panel de 20rem va al lado del formulario solo
// desde `--container-form-rail` (57.5rem), que deja al menos 36rem de formulario; por debajo, el panel
// se apila después del formulario. El orden de lectura es siempre el formulario, el panel y las
// acciones. Por qué el contenedor y no la ventana: el ancho útil cambia con la barra lateral.
// - Al lado, el panel y las acciones forman un carril fijo bajo la barra superior.
// - Apilado, el carril se disuelve (`contents`): el panel es una sección más y las acciones, una
//   barra fija al pie del formulario entero, alcanzable sin volver arriba.
import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function FormLayout({
  header,
  panel,
  actions,
  className,
  children,
}: {
  /**
   * El título de la página y sus avisos, arriba de la columna del formulario: el panel empieza a su
   * lado (decisión del propietario, 2026-10-22).
   */
  header?: ReactNode;
  /** El panel lateral, normalmente un `StickySummaryPanel`. */
  panel?: ReactNode;
  /** Las acciones del formulario, normalmente un `StickyFormActions`. */
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const rail = panel || actions;
  return (
    <div data-slot="form-layout" className={cn("@container", className)}>
      <div className="grid gap-6 @form-rail:grid-cols-form-rail @form-rail:items-start">
        <div data-slot="form-layout-main" className="flex min-w-0 flex-col gap-8">
          {header && (
            <div data-slot="form-layout-header" className="flex flex-col gap-4">
              {header}
            </div>
          )}
          {children}
        </div>
        {rail && (
          <div
            data-slot="form-layout-rail"
            className="contents @form-rail:sticky @form-rail:top-16 @form-rail:flex @form-rail:flex-col @form-rail:gap-4"
          >
            {panel}
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}

/** Panel de resumen: una superficie propia con su título, al lado o al final del formulario. */
export function StickySummaryPanel({
  title,
  aside,
  className,
  children,
}: {
  title: string;
  /** Un dato breve a la derecha del título, como el estado del guardado. */
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <aside
      aria-labelledby={titleId}
      data-slot="sticky-summary-panel"
      className={cn("flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4", className)}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </aside>
  );
}

/**
 * Acciones del formulario: la principal, la secundaria y, si una no está disponible, su motivo
 * escrito. El motivo lleva el `id` que la acción cita en `aria-describedby`. Al lado, al pie del
 * panel; apilado, una barra fija al pie, con un borde superior. El documento reserva su alto para que
 * el foco nunca quede debajo (`scroll-padding-bottom` en `globals.css`).
 */
export function StickyFormActions({
  reason,
  reasonId,
  notice,
  className,
  children,
}: {
  /** Por qué una acción no está disponible. */
  reason?: string | null;
  /** El `id` del motivo, que la acción no disponible cita en `aria-describedby`. */
  reasonId?: string;
  /** Un aviso inmediatamente encima de las acciones, como el del ambiente. */
  notice?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-slot="sticky-form-actions"
      className={cn(
        // Apilado, una barra compacta: cuanto menos alto, menos contenido tapa al desplazar.
        "sticky bottom-0 z-(--z-sticky) -mx-4 flex flex-col gap-2 border-t bg-background px-4 py-2 md:-mx-6 md:px-6",
        "@form-rail:static @form-rail:mx-0 @form-rail:border-t-0 @form-rail:bg-transparent @form-rail:p-0",
        className,
      )}
    >
      {notice}
      <div className="flex flex-col gap-2 @max-form-rail:flex-row @max-form-rail:*:flex-1">
        {children}
      </div>
      {reason && (
        // Centrado debajo de los botones (decisión del propietario, 2026-10-22).
        <p id={reasonId} className="text-center text-xs text-muted-foreground">
          {reason}
        </p>
      )}
    </div>
  );
}
