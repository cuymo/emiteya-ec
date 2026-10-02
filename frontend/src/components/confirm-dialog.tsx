// ConfirmDialog (component-system.md, escalera de confirmación de forms-and-workflows.md): un paso
// para lo reversible y, cuando el riesgo lo pide, escribir un texto exacto antes de confirmar.
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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  pending: boolean;
  onConfirm: () => void;
  tone?: "primary" | "destructive";
  /** Texto que hay que escribir exactamente para habilitar la confirmación. */
  typedConfirmation?: { label: string; expected: string };
}) {
  const inputId = useId();
  const [typed, setTyped] = useState("");
  const ready = !typedConfirmation || typed === typedConfirmation.expected;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (!next) setTyped("");
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (ready && !pending) onConfirm();
          }}
          className="flex flex-col"
        >
          <div className="flex flex-col gap-1 px-3 pt-3 pr-7 pb-2">
            <DialogTitle className="text-lg font-semibold">{title}</DialogTitle>
            <DialogDescription asChild>
              <div className="text-sm text-foreground-muted">{description}</div>
            </DialogDescription>
            {typedConfirmation && (
              <div className="mt-1 flex flex-col gap-0.5">
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
          <div className="flex justify-end gap-1 border-t border-border px-3 py-2">
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
