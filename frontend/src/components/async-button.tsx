// AsyncButton (component-system.md): geometría estable y envío duplicado bloqueado mientras la
// operación está pendiente.
import { LoaderCircle } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function AsyncButton({
  pending,
  pendingLabel,
  children,
  disabled,
  className,
  ...props
}: ButtonProps & { pending: boolean; pendingLabel?: string }) {
  return (
    <Button
      {...props}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={cn("relative", className)}
    >
      {/* El texto conserva el ancho; el indicador se superpone sin mover el resto. */}
      <span className={cn("inline-flex items-center gap-2", pending && "invisible")}>
        {children}
      </span>
      {pending && (
        <span className="absolute inset-0 inline-flex items-center justify-center gap-2">
          <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" />
          <span className="sr-only">{pendingLabel ?? "Procesando"}</span>
        </span>
      )}
    </Button>
  );
}
