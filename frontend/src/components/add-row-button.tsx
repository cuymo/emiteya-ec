// Botón para agregar una fila al final de una lista de un formulario (decisión del propietario,
// 2026-10-22): punteado, a todo el ancho y alto, y al pasar el ratón un degradado azulado, no un
// relleno sólido. «Dividir el pago» en la factura y «Agregar concepto» en la nota de débito lo usan,
// así que se ven iguales.
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function AddRowButton({ className, ...props }: Omit<ButtonProps, "variant" | "size">) {
  return (
    <Button
      variant="outline"
      size="default"
      className={cn(
        "h-12 w-full border-dashed max-md:h-12",
        "hover:border-primary/50 hover:bg-transparent hover:bg-linear-to-r hover:from-primary/15 hover:via-primary/5 hover:to-primary/15 hover:text-primary",
        className,
      )}
      {...props}
    />
  );
}
