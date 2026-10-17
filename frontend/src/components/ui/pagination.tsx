// Derivado de la plantilla «Studio Admin», `src/components/ui/pagination.tsx` (MIT;
// frontend/THIRD_PARTY_NOTICES.md). Adaptado: los enlaces `href="#"` pasan a botones, porque la
// página vive en la URL de la lista y la cambia el módulo; los extremos deshabilitados son botones
// deshabilitados de verdad; textos en español.
import { ChevronLeftIcon, ChevronRightIcon, MoreHorizontalIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function Pagination({ className, ...props }: ComponentProps<"nav">) {
  return (
    <nav
      aria-label="Paginación"
      data-slot="pagination"
      className={cn("flex w-auto", className)}
      {...props}
    />
  );
}

export function PaginationContent({ className, ...props }: ComponentProps<"ul">) {
  return (
    <ul
      data-slot="pagination-content"
      className={cn("flex items-center gap-0.5", className)}
      {...props}
    />
  );
}

export function PaginationItem(props: ComponentProps<"li">) {
  return <li data-slot="pagination-item" {...props} />;
}

export function PaginationButton({
  isActive = false,
  className,
  ...props
}: Omit<ComponentProps<"button">, "type"> & { isActive?: boolean }) {
  return (
    <Button
      type="button"
      variant={isActive ? "outline" : "ghost"}
      size="icon-sm"
      aria-current={isActive ? "page" : undefined}
      data-slot="pagination-link"
      data-active={isActive}
      className={cn(
        "tabular-nums",
        // La página actual en el azul primario (decisión del propietario, 2026-10-17).
        isActive &&
          "border-primary/40 bg-active text-active-foreground hover:bg-active hover:text-active-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function PaginationPrevious(props: Omit<ComponentProps<"button">, "type" | "children">) {
  return (
    <PaginationButton aria-label="Página anterior" {...props}>
      <ChevronLeftIcon aria-hidden="true" />
    </PaginationButton>
  );
}

export function PaginationNext(props: Omit<ComponentProps<"button">, "type" | "children">) {
  return (
    <PaginationButton aria-label="Página siguiente" {...props}>
      <ChevronRightIcon aria-hidden="true" />
    </PaginationButton>
  );
}

export function PaginationEllipsis({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="pagination-ellipsis"
      className={cn("flex size-8 items-center justify-center text-muted-foreground", className)}
      {...props}
    >
      <MoreHorizontalIcon aria-hidden="true" className="size-4" />
      <span className="sr-only">Más páginas</span>
    </span>
  );
}
