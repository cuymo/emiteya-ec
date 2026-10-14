// Fachada de compatibilidad (adopt-premium-design-foundation-and-shell, design D6): conserva la API
// anterior del menú desplegable y del tooltip, con el alto de ítem de las pantallas aún no migradas,
// sobre los primitivos derivados de la plantilla (`dropdown-menu.tsx` y `tooltip.tsx`). No hay otra
// implementación por debajo. El código nuevo usa los primitivos directamente; esta fachada se retira
// al migrar sus usos (technical-debt.md).
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { Tooltip as TooltipRoot, TooltipContent, TooltipTrigger } from "./tooltip";

export { TooltipProvider } from "./tooltip";

export const Menu = DropdownMenu;
export const MenuTrigger = DropdownMenuTrigger;
export const MenuLabel = DropdownMenuLabel;

export function MenuContent({
  className,
  align = "center",
  ...props
}: ComponentProps<typeof DropdownMenuContent>) {
  return <DropdownMenuContent align={align} className={cn("min-w-48", className)} {...props} />;
}

/** Ítem con el alto anterior (40 px, 44 px en móvil) mientras su pantalla no migre. */
export function MenuItem({ className, ...props }: ComponentProps<typeof DropdownMenuItem>) {
  return (
    <DropdownMenuItem className={cn("h-10 gap-2 px-2 [&_svg]:size-5", className)} {...props} />
  );
}

export function MenuCheckboxItem({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuCheckboxItem>) {
  return <DropdownMenuCheckboxItem className={cn("h-10 gap-2 pl-2", className)} {...props} />;
}

export function MenuSeparator() {
  return <DropdownMenuSeparator />;
}

/** Tooltip opaco que nombra una acción; no sustituye etiquetas de campos ni de navegación. */
export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <TooltipRoot>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent sideOffset={4}>{label}</TooltipContent>
    </TooltipRoot>
  );
}
