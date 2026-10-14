// Menú desplegable y tooltip base (Radix), opacos y sobre el contenido en ambos temas.
import { DropdownMenu, Tooltip as TooltipPrimitive } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export const Menu = DropdownMenu.Root;
export const MenuTrigger = DropdownMenu.Trigger;
export const MenuLabel = DropdownMenu.Label;

export function MenuContent({ className, ...props }: ComponentProps<typeof DropdownMenu.Content>) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        sideOffset={4}
        className={cn(
          "z-(--z-popover) min-w-48 rounded-md border border-border bg-surface p-1 text-sm text-foreground shadow-md",
          className,
        )}
        {...props}
      />
    </DropdownMenu.Portal>
  );
}

export function MenuItem({ className, ...props }: ComponentProps<typeof DropdownMenu.Item>) {
  return (
    <DropdownMenu.Item
      className={cn(
        "flex h-10 cursor-default items-center gap-2 rounded-sm px-2 outline-none select-none",
        "data-highlighted:bg-surface-subtle data-disabled:opacity-50 [&_svg]:size-5",
        className,
      )}
      {...props}
    />
  );
}

export function MenuCheckboxItem({
  className,
  children,
  ...props
}: ComponentProps<typeof DropdownMenu.CheckboxItem>) {
  return (
    <DropdownMenu.CheckboxItem
      className={cn(
        "flex h-10 cursor-default items-center gap-2 rounded-sm px-2 outline-none select-none",
        "data-highlighted:bg-surface-subtle",
        className,
      )}
      {...props}
    >
      <span className="inline-flex size-4 items-center justify-center rounded-sm border border-border">
        <DropdownMenu.ItemIndicator className="size-2 rounded-sm bg-primary" />
      </span>
      {children}
    </DropdownMenu.CheckboxItem>
  );
}

export function MenuSeparator() {
  return <DropdownMenu.Separator className="my-1 h-px bg-border" />;
}

export const TooltipProvider = TooltipPrimitive.Provider;

/** Tooltip opaco que nombra una acción; no sustituye etiquetas de campos ni de navegación. */
export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          sideOffset={4}
          className="z-(--z-popover) max-w-64 rounded-md border border-border bg-foreground px-2 py-1 text-xs text-background shadow-md"
        >
          {label}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
