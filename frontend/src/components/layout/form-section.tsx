// Sección de un formulario (productize-invoice-editor-and-composition-foundation, design D6): título,
// descripción opcional, un estado breve junto al título (como lo que falta asignar del pago), una
// acción local a la derecha y el contenido. Como `invoice-items.tsx` de la
// plantilla «Studio Admin» (MIT; frontend/THIRD_PARTY_NOTICES.md), «Agregar» va en la cabecera de su
// sección. Las secciones se separan con 32 px y un filete superior fino, sin tarjetas: las tarjetas
// quedan para el resumen, que es otra superficie.
import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function FormSection({
  title,
  description,
  badge,
  action,
  className,
  children,
}: {
  title: string;
  description?: ReactNode;
  /** Un estado breve junto al título, como un `Badge`; fuera del título, que sigue nombrando la sección. */
  badge?: ReactNode;
  /** Una acción de la sección, como «Agregar producto». */
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      data-slot="form-section"
      className={cn(
        "flex flex-col gap-4 border-t border-border pt-6 first:border-t-0 first:pt-0",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 id={titleId} className="text-lg font-semibold">
              {title}
            </h2>
            {badge}
          </div>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </div>
      {children}
    </section>
  );
}
