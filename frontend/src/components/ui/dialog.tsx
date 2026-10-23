// Diálogo base (Radix Dialog): foco atrapado y restaurado, Escape y clic fuera para cerrar.
import { X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useReturnFocus } from "./use-return-focus";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;

export function DialogOverlay({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn("fixed inset-0 z-(--z-overlay) bg-overlay", className)}
      {...props}
    />
  );
}

const TABBABLE =
  'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href], [tabindex]';

export function DialogContent({
  className,
  children,
  closeLabel = "Cerrar",
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & { closeLabel?: string; children: ReactNode }) {
  // Radix devuelve el foco solo a un DialogTrigger; los diálogos controlados recuerdan quién los abrió.
  const focus = useReturnFocus({ onOpenAutoFocus, onCloseAutoFocus });
  // Al abrir, el foco va al primer control y no a la ayuda de su etiqueta (`FieldHint`), que la
  // precede en el documento (decisión del propietario, 2026-10-22: la ayuda va junto a la etiqueta).
  const openAutoFocus = (event: Event) => {
    focus.onOpenAutoFocus(event);
    if (event.defaultPrevented || !(event.target instanceof HTMLElement)) return;
    const tabbable = Array.from(event.target.querySelectorAll<HTMLElement>(TABBABLE)).filter(
      (element) => element.tabIndex >= 0,
    );
    if (tabbable[0]?.dataset.slot !== "field-hint") return;
    const control = tabbable.find((element) => element.dataset.slot !== "field-hint");
    if (!control) return;
    event.preventDefault();
    control.focus();
  };
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content
        className={cn(
          "fixed top-1/2 left-1/2 z-(--z-dialog) flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-md",
          "-translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border bg-surface shadow-lg",
          className,
        )}
        {...props}
        onOpenAutoFocus={openAutoFocus}
        onCloseAutoFocus={focus.onCloseAutoFocus}
      >
        {children}
        <DialogPrimitive.Close
          aria-label={closeLabel}
          className={cn(
            "absolute top-2 right-2 inline-flex size-11 items-center justify-center rounded-md text-foreground-muted",
            "hover:bg-surface-subtle hover:text-foreground active:bg-border",
          )}
        >
          <X aria-hidden="true" className="size-5" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
