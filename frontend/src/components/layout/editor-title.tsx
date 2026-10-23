// Título de un editor de comprobante (decisión del propietario, 2026-10-22): la entidad sola
// («Nota de crédito») con su estado a la derecha («Nueva», «Borrador»), en el `PageHeader` de editor.
// El mismo en el editor, en sus estados de error y en su esqueleto de carga.
import { FormStateBadge, type FormState } from "@/components/form-state-badge";
import { PageHeader } from "@/components/layout/page-header";

export function EditorTitle({
  entity,
  state,
  feminine = false,
  titleId = "editor-titulo",
}: {
  entity: string;
  state: FormState;
  feminine?: boolean;
  /** El `id` del `h1`, que nombra la sección; `null` en un esqueleto de carga. */
  titleId?: string | null;
}) {
  return (
    <PageHeader
      variant="editor"
      title={entity}
      {...(titleId ? { titleId } : {})}
      badge={<FormStateBadge state={state} feminine={feminine} />}
    />
  );
}
