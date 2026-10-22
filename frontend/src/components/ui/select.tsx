// Select (component-system.md): de cinco a quince opciones conocidas. Es el select nativo con los
// tokens del proyecto, que conserva teclado, lector de pantalla y selector táctil del sistema, y
// admite grupos con <optgroup>. Mide 44px de alto por debajo de 768px, como Input y Button.
// Sin la apariencia nativa (como el `native-select` de shadcn/ui): según el navegador y el tema del
// sistema, el control nativo pintaba su propio borde oscuro en lugar del token `input` de los demás
// campos. La flecha es un icono del tema; `className` va al contenedor, que fija el ancho.
import { ChevronDown } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Select({ className, ...props }: ComponentProps<"select">) {
  return (
    <div data-slot="select-wrapper" className={cn("relative w-full min-w-0", className)}>
      <select
        data-slot="select"
        className={cn(
          "peer h-10 w-full min-w-0 appearance-none rounded-md border border-input bg-surface pr-9 pl-3 text-base text-foreground sm:text-sm max-md:h-11",
          "motion-safe:transition-colors motion-safe:duration-150",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "aria-invalid:border-danger",
        )}
        {...props}
      />
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-foreground-muted peer-disabled:opacity-50"
      />
    </div>
  );
}
