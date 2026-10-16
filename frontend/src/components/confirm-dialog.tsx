// ConfirmDialog (component-system.md, escalera de confirmación de forms-and-workflows.md): un paso
// para lo reversible y, cuando el riesgo lo pide, escribir un texto exacto antes de confirmar. Puede
// pedir además un texto libre obligatorio, como el motivo de una reconciliación (add-sri-transmission,
// design D20), que recibe el foco al abrir, o un contenido propio que habilita la confirmación, como
// las declaraciones de una nota de crédito (add-credit-notes, design D19).
"use client";

import { useId, useState, type ReactNode } from "react";
import { AsyncButton } from "@/components/async-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pending,
  onConfirm,
  tone = "primary",
  typedConfirmation,
  requiredText,
  children,
  confirmBlocked = false,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  pending: boolean;
  /** Con `requiredText`, recibe ese texto recortado. */
  onConfirm: (text?: string) => void;
  tone?: "primary" | "destructive";
  /** Texto que hay que escribir exactamente para habilitar la confirmación. */
  typedConfirmation?: { label: string; expected: string };
  /**
   * Texto libre obligatorio: se valida al enviar con `validate` (el esquema Zod del contrato) y
   * `onConfirm` lo recibe recortado.
   */
  requiredText?: {
    label: string;
    hint: string;
    maxLength: number;
    /** Mensaje del error, o null si el texto es válido. */
    validate: (text: string) => string | null;
  };
  /** Contenido propio después de la descripción, como casillas que el usuario debe marcar. */
  children?: ReactNode;
  /** Mientras es true, la confirmación queda deshabilitada (el llamador explica por qué). */
  confirmBlocked?: boolean;
  /** Foco al cerrar: con `preventDefault`, el llamador decide dónde va en lugar de quien lo abrió. */
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const inputId = useId();
  const textId = useId();
  const hintId = useId();
  const errorId = useId();
  const [typed, setTyped] = useState("");
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const ready = (!typedConfirmation || typed === typedConfirmation.expected) && !confirmBlocked;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (!next) {
          setTyped("");
          setText("");
          setProblem(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent {...(onCloseAutoFocus ? { onCloseAutoFocus } : {})}>
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            // El portal no corta el árbol de React: sin esto, confirmar dentro de un formulario
            // también lo enviaría.
            event.stopPropagation();
            if (!ready || pending) return;
            if (!requiredText) return onConfirm();
            const error = requiredText.validate(text);
            if (error) {
              setProblem(error);
              document.getElementById(textId)?.focus();
              return;
            }
            onConfirm(text.trim());
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          {/* Un contenido más alto que la pantalla se desplaza y las acciones quedan a la vista. */}
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-6 pt-6 pr-14 pb-4">
            <DialogTitle className="text-lg font-semibold">{title}</DialogTitle>
            <DialogDescription asChild>
              <div className="text-sm text-foreground-muted">{description}</div>
            </DialogDescription>
            {children}
            {requiredText && (
              <div className="mt-2 flex flex-col gap-1">
                <label htmlFor={textId} className="text-sm font-medium">
                  {requiredText.label}
                </label>
                <textarea
                  id={textId}
                  value={text}
                  maxLength={requiredText.maxLength}
                  rows={3}
                  required
                  aria-invalid={problem ? true : undefined}
                  aria-describedby={problem ? `${errorId} ${hintId}` : hintId}
                  onChange={(event) => {
                    setText(event.target.value);
                    if (problem && !requiredText.validate(event.target.value)) setProblem(null);
                  }}
                  className="w-full min-w-0 rounded-md border border-input bg-surface px-3 py-2 text-base text-foreground sm:text-sm aria-invalid:border-danger"
                />
                {problem && (
                  <p id={errorId} className="text-sm text-danger">
                    {problem}
                  </p>
                )}
                <p id={hintId} className="text-xs text-foreground-muted">
                  {requiredText.hint} {text.length}/{requiredText.maxLength}
                </p>
              </div>
            )}
            {typedConfirmation && (
              <div className="mt-2 flex flex-col gap-1">
                <label htmlFor={inputId} className="text-sm font-medium">
                  {typedConfirmation.label}
                </label>
                <Input
                  id={inputId}
                  value={typed}
                  onChange={(event) => setTyped(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            )}
          </div>
          <div className="flex flex-wrap justify-end gap-2 border-t border-border px-6 py-4">
            <DialogClose asChild>
              <Button variant="ghost" disabled={pending}>
                Cancelar
              </Button>
            </DialogClose>
            <AsyncButton type="submit" variant={tone} pending={pending} disabled={!ready}>
              {confirmLabel}
            </AsyncButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
