// El estado de lo que se edita, junto al título de su formulario (decisión del propietario,
// 2026-10-22): el título nombra solo la entidad («Factura», «Tercero») y el badge dice si es nueva,
// un borrador o una corrección. «Borrador» es el mismo badge neutro, con su lápiz, que marca los
// borradores en las listas; «Nuevo» va en el tono informativo. Dentro del `h1`, al final de su fila,
// así el nombre del título dice las dos cosas: «Factura Borrador».
import { PencilLine, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export type FormState = "new" | "draft" | "edit";

export function FormStateBadge({
  state,
  feminine = false,
}: {
  state: FormState;
  /** «Nueva» en lugar de «Nuevo», para una factura o una nota. */
  feminine?: boolean;
}) {
  const label =
    state === "new"
      ? feminine
        ? "Nueva"
        : "Nuevo"
      : state === "draft"
        ? "Borrador"
        : "Corrección";
  return (
    <Badge
      variant={state === "new" ? "info" : "neutral"}
      data-form-state={state}
      className="h-7 px-3 text-sm font-medium [&>svg]:size-3.5!"
    >
      {state === "new" ? (
        <Plus aria-hidden="true" data-icon="inline-start" />
      ) : (
        <PencilLine aria-hidden="true" data-icon="inline-start" />
      )}
      {label}
    </Badge>
  );
}
