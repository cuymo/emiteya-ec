// Encabezado de página de las pantallas migradas (productize-invoice-list-and-shared-table-
// foundation, design D4; interface-design.md y cognitive-architecture.md, «One Focal Action»).
// Visual portado del encabezado de `src/app/(main)/dashboard/file-manager/page.tsx` de la plantilla
// «Studio Admin» (MIT; frontend/THIRD_PARTY_NOTICES.md), que no tiene un componente compartido:
// - el título es el único `h1` de la pantalla, con la tipografía de `design-foundations.md`;
// - una sola ranura de acción principal, para que no pueda haber dos; las secundarias van aparte.
// Gramática y ritmo (productize-invoice-editor-and-composition-foundation, design D3):
// - el bloque del título mide al menos 40 px, la altura del botón, con el título centrado: cae
//   siempre en la misma y, haya acción o no;
// - variante de lista: sin migas, acción principal a la derecha del título;
// - variante de editor: el estado del borrador como contexto y ninguna acción, porque las acciones
//   viven junto al resumen; las migas de la ruta van en la barra superior, como en todas;
// - la pantalla deja 24 px hasta el contenido (`gap-6` de su sección).
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Common = {
  title: string;
  /** Id del `h1`, para que la sección de la pantalla lo use como nombre. */
  titleId?: string;
  /** Un estado o una marca junto al título, solo si aporta a la decisión. */
  context?: ReactNode;
  /**
   * El estado de lo que se edita (`FormStateBadge`), dentro del `h1`: el título nombra la entidad y el
   * badge dice si es nueva, un borrador o una corrección (decisión del propietario, 2026-10-22).
   */
  badge?: ReactNode;
  className?: string;
};

type ListHeader = Common & {
  variant?: "list";
  description?: ReactNode;
  /** La única acción principal de la pantalla. */
  primaryAction?: ReactNode;
  /** Acciones secundarias, en variante `outline` o `ghost`. */
  secondaryActions?: ReactNode;
};

/** Editor: sin acciones, que viven junto al resumen. */
type EditorHeader = Common & { variant: "editor" };

export function PageHeader(props: ListHeader | EditorHeader) {
  const { title, titleId, context, badge, className } = props;
  const list = props.variant !== "editor" ? props : null;
  const actions = list && (list.primaryAction || list.secondaryActions);
  return (
    <header
      data-slot="page-header"
      data-variant={props.variant ?? "list"}
      className={cn("flex flex-col gap-2", className)}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <div
            data-slot="page-header-title"
            className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1"
          >
            <h1
              id={titleId}
              className={cn(
                "text-3xl font-bold break-words",
                badge && "flex flex-wrap items-center gap-x-3 gap-y-1",
              )}
            >
              {title}
              {/* Un espacio entre los dos: el nombre del título queda «Factura Borrador». */}
              {badge && " "}
              {badge}
            </h1>
            {context}
          </div>
          {list?.description && <p className="text-sm text-muted-foreground">{list.description}</p>}
        </div>
        {actions && (
          <div className="flex min-h-10 flex-wrap items-center gap-2 max-sm:[&>*]:flex-1">
            {list.secondaryActions}
            {list.primaryAction}
          </div>
        )}
      </div>
    </header>
  );
}
