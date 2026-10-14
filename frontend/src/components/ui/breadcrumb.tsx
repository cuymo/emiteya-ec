// Derivado de la plantilla «Studio Admin» 2.2.0, `src/components/ui/breadcrumb.tsx` (MIT;
// frontend/THIRD_PARTY_NOTICES.md). Adaptado (adopt-premium-design-foundation-and-shell, design D6):
// textos accesibles en español y sin la elipsis, que no se usa. La página actual se anuncia con
// `aria-current="page"`.
import { ChevronRightIcon } from "lucide-react";
import { Slot } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Breadcrumb({
  className,
  "aria-label": label = "Ruta de navegación",
  ...props
}: ComponentProps<"nav">) {
  return <nav aria-label={label} data-slot="breadcrumb" className={cn(className)} {...props} />;
}

export function BreadcrumbList({ className, ...props }: ComponentProps<"ol">) {
  return (
    <ol
      data-slot="breadcrumb-list"
      className={cn(
        "flex flex-wrap items-center gap-1.5 text-sm wrap-break-word text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function BreadcrumbItem({ className, ...props }: ComponentProps<"li">) {
  return (
    <li
      data-slot="breadcrumb-item"
      className={cn("inline-flex min-w-0 items-center gap-1", className)}
      {...props}
    />
  );
}

export function BreadcrumbLink({
  asChild,
  className,
  ...props
}: ComponentProps<"a"> & { asChild?: boolean }) {
  const Component = asChild ? Slot.Root : "a";
  return (
    <Component
      data-slot="breadcrumb-link"
      className={cn("rounded-sm transition-colors hover:text-foreground", className)}
      {...props}
    />
  );
}

export function BreadcrumbPage({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="breadcrumb-page"
      aria-current="page"
      className={cn("truncate font-normal text-foreground", className)}
      {...props}
    />
  );
}

export function BreadcrumbSeparator({ children, className, ...props }: ComponentProps<"li">) {
  return (
    <li
      data-slot="breadcrumb-separator"
      role="presentation"
      aria-hidden="true"
      className={cn("[&>svg]:size-3.5", className)}
      {...props}
    >
      {children ?? <ChevronRightIcon />}
    </li>
  );
}
