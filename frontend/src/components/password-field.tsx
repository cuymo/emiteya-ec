// PasswordField (component-system.md): contraseña enmascarada con un botón accesible para verla.
// Permite pegar y declara autocomplete para los gestores de contraseñas.
"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState, type ComponentProps } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function PasswordField({
  className,
  autoComplete = "current-password",
  ...props
}: Omit<ComponentProps<"input">, "type"> & { autoComplete?: "current-password" | "new-password" }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className={cn("relative", className)}>
      <Input
        {...props}
        type={visible ? "text" : "password"}
        autoComplete={autoComplete}
        autoCapitalize="none"
        spellCheck={false}
        className="pr-5.5"
      />
      <button
        type="button"
        onClick={() => setVisible((value) => !value)}
        aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
        aria-pressed={visible}
        className={cn(
          "absolute inset-y-0 right-0 inline-flex w-5 items-center justify-center rounded-r-md text-foreground-muted max-md:w-5.5",
          "hover:text-foreground active:text-foreground",
        )}
      >
        {visible ? (
          <EyeOff aria-hidden="true" className="size-2.5" />
        ) : (
          <Eye aria-hidden="true" className="size-2.5" />
        )}
      </button>
    </div>
  );
}
