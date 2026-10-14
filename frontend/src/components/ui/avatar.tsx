// Derivado de la plantilla «Studio Admin» 2.2.0, `src/components/ui/avatar.tsx` (MIT;
// frontend/THIRD_PARTY_NOTICES.md). Adaptado (adopt-premium-design-foundation-and-shell, design D6 y
// D7): solo iniciales. Sin `AvatarImage`, ni imágenes remotas, ni grupos o insignias que no se usan.
// Las iniciales son decorativas: el nombre accesible lo da el control o el texto que acompaña.
"use client";

import { Avatar as AvatarPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Avatar({
  className,
  size = "default",
  ...props
}: ComponentProps<typeof AvatarPrimitive.Root> & { size?: "default" | "sm" | "lg" }) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      data-size={size}
      className={cn(
        "group/avatar relative flex size-8 shrink-0 rounded-full select-none after:absolute after:inset-0 after:rounded-full after:border after:border-border after:mix-blend-darken data-[size=lg]:size-10 data-[size=sm]:size-6 dark:after:mix-blend-lighten",
        className,
      )}
      {...props}
    />
  );
}

export function AvatarFallback({
  className,
  ...props
}: ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      aria-hidden="true"
      className={cn(
        "flex size-full items-center justify-center rounded-full bg-muted text-sm text-muted-foreground group-data-[size=sm]/avatar:text-xs",
        className,
      )}
      {...props}
    />
  );
}

/** Iniciales de un nombre: la primera letra de la primera y de la última palabra. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (
    ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "")).toUpperCase() ||
    "?"
  );
}
