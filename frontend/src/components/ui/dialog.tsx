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
        onOpenAutoFocus={focus.onOpenAutoFocus}
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
