// FormDialog (component-system.md, forms-and-workflows.md): título, propósito opcional, cuerpo con
// desplazamiento, `Cancelar` y una acción principal. El formulario aporta campos y validación.
"use client";

import type { FormEventHandler, ReactNode } from "react";
import { AsyncButton } from "@/components/async-button";
import { useFormRowFieldClass } from "@/components/layout/form-grid";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  pending,
  onSubmit,
  children,
  error,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  submitLabel: string;
  pending: boolean;
  onSubmit: FormEventHandler<HTMLFormElement>;
  children: ReactNode;
  /** Error de la operación (no de un campo): se muestra en el cuerpo y conserva los valores. */
  error?: string | undefined;
  /** Foco al cerrar: con `preventDefault`, el llamador decide dónde va en lugar de quien lo abrió. */
  onCloseAutoFocus?: (event: Event) => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Mientras la operación está pendiente el diálogo no se abandona a medias.
        if (!pending) onOpenChange(next);
      }}
    >
      <DialogContent
        {...(description ? {} : { "aria-describedby": undefined })}
        {...(onCloseAutoFocus ? { onCloseAutoFocus } : {})}
      >
        <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-col gap-1 px-6 pt-6 pr-14">
            <DialogTitle className="text-lg font-semibold">{title}</DialogTitle>
            {description && (
              <DialogDescription className="text-sm text-foreground-muted">
                {description}
              </DialogDescription>
            )}
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-4">
            {children}
            {error && (
              <p
                role="alert"
                className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm"
              >
                {error}
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t border-border px-6 py-4">
            <DialogClose asChild>
              <Button variant="ghost" disabled={pending}>
                Cancelar
              </Button>
            </DialogClose>
            <AsyncButton type="submit" pending={pending}>
              {submitLabel}
            </AsyncButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Campo de formulario: etiqueta persistente, ayuda breve y error asociados al control. */
export function FormField({
  id,
  label,
  hint,
  error,
  action,
  className,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string | undefined;
  /**
   * Una acción en la fila del control, como quitar una forma de pago
   * (productize-invoice-editor-and-composition-foundation, design D7).
   */
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  // Dentro de `FormGrid` o `FormFieldRow`, el campo ocupa tres filas de su `subgrid` (etiqueta,
  // control y mensaje), para alinearse con los demás campos de la fila.
  const rowClass = useFormRowFieldClass();
  return (
    <div data-slot="form-field" className={cn("flex flex-col gap-1", rowClass, className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {action ? (
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">{children}</div>
          {action}
        </div>
      ) : (
        children
      )}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-foreground-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** Atributos ARIA del control de un FormField. */
export function fieldAria(id: string, error: string | undefined, hint?: string) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return {
    id,
    "aria-invalid": error ? true : undefined,
    ...(describedBy ? { "aria-describedby": describedBy } : {}),
  } as const;
}
