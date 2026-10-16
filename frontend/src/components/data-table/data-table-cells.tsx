// Celdas de las tablas (decisión del propietario, 2026-10-16): el ojo encuentra primero lo que
// importa. El registro (el número del comprobante, el nombre del producto) es un enlace azul en
// seminegrita; el importe va en verde y seminegrita con el signo de dólar; el tercero en peso medio
// con su identificación debajo, atenuada; la fecha y los datos de contexto, atenuados. Los estados
// ya llevan su color en su insignia. El importe sale de `components/money.tsx`, común con los
// detalles.
import Link from "next/link";
import type { ReactNode } from "react";
import { Money } from "@/components/money";
import { cn } from "@/lib/utils";

export { formatMoney } from "@/components/money";

/** El importe de una fila: verde, seminegrita y alineado por sus cifras. */
export function MoneyCell({ amount, className }: { amount: string; className?: string }) {
  return <Money amount={amount} {...(className ? { className } : {})} />;
}

/** El registro de la fila, que abre su detalle. */
export function RecordLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "font-semibold text-primary tabular-nums underline-offset-2 hover:underline",
        className,
      )}
    >
      {children}
    </Link>
  );
}

/** Un tercero: su nombre en peso medio y su identificación debajo, atenuada. */
export function PartyCell({
  name,
  identification,
  truncate = false,
}: {
  name: ReactNode;
  identification?: ReactNode;
  /** Recorta a una línea en lugar de partir el texto. */
  truncate?: boolean;
}) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className={cn("font-medium", truncate ? "truncate" : "break-words")}>{name}</span>
      {identification && (
        <span className={cn("text-xs text-foreground-muted tabular-nums", truncate && "truncate")}>
          {identification}
        </span>
      )}
    </span>
  );
}

/** Un dato de contexto (fecha, causa, punto): atenuado para no competir con los clave. */
export function MutedCell({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("text-foreground-muted tabular-nums", className)}>{children}</span>;
}
