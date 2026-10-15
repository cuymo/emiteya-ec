// Encabezado de página de las pantallas migradas (productize-invoice-list-and-shared-table-
// foundation, design D4; interface-design.md y cognitive-architecture.md, «One Focal Action»).
// Visual portado del encabezado de `src/app/(main)/dashboard/file-manager/page.tsx` de la plantilla
// «Studio Admin» (MIT; frontend/THIRD_PARTY_NOTICES.md), que no tiene un componente compartido:
// - el título es el único `h1` de la pantalla, con la tipografía de `design-foundations.md`;
// - una sola ranura de acción principal, para que no pueda haber dos; las secundarias van aparte;
// - sin migas: las pone la barra superior del shell, y repetirlas duplicaría la orientación.
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  titleId,
  description,
  context,
  primaryAction,
  secondaryActions,
  className,
}: {
  title: string;
  /** Id del `h1`, para que la sección de la pantalla lo use como nombre. */
  titleId?: string;
  description?: ReactNode;
  /** Un estado o una marca junto al título, solo si aporta a la decisión. */
  context?: ReactNode;
  /** La única acción principal de la pantalla. */
  primaryAction?: ReactNode;
  /** Acciones secundarias, en variante `outline` o `ghost`. */
  secondaryActions?: ReactNode;
  className?: string;
}) {
  const actions = primaryAction || secondaryActions;
  return (
    <header
      data-slot="page-header"
      className={cn("flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between", className)}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 id={titleId} className="text-3xl font-bold break-words">
            {title}
          </h1>
          {context}
        </div>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 max-sm:[&>*]:flex-1">
          {secondaryActions}
          {primaryAction}
        </div>
      )}
    </header>
  );
}
