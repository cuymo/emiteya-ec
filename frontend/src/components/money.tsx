// Importes en dólares (decisión del propietario, 2026-10-16): «$17.355,05» con el formato local y
// al menos dos decimales. En tablas y detalles, el importe que importa va en el verde `--money`, en
// seminegrita y con cifras alineadas; dentro de un texto atenuado basta `formatMoney`. El editor de
// facturas ya los usa (decisión del propietario, 2026-10-22); los demás editores siguen con «USD 1,00»
// hasta que se revisen.
import { formatDecimal } from "@/lib/decimal";
import { cn } from "@/lib/utils";

/** «$17.355,05»: un importe en dólares, con dos decimales como mínimo. */
export const formatMoney = (amount: string) =>
  `$${formatDecimal(amount, { minFractionDigits: 2 })}`;

/** Un importe destacado: verde, seminegrita y alineado por sus cifras. */
export function Money({ amount, className }: { amount: string; className?: string }) {
  return (
    <span className={cn("font-semibold whitespace-nowrap text-money tabular-nums", className)}>
      {formatMoney(amount)}
    </span>
  );
}
