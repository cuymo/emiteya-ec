// Tablas equivalentes a los gráficos del tablero, para las tecnologías de asistencia. Van con la
// pantalla, sin esperar a que lleguen los gráficos, y con los importes como los da el servidor.
import type { DashboardView } from "@facturador/contracts";
import { formatUsd } from "@/lib/decimal";
import type { RankingRow } from "./dashboard-charts";
import { monthName } from "./dashboard-format";

export function SalesTable({ monthly }: { monthly: DashboardView["monthly"] }) {
  return (
    <table className="sr-only">
      <caption>Ventas autorizadas por mes</caption>
      <thead>
        <tr>
          <th scope="col">Mes</th>
          <th scope="col">Facturas autorizadas</th>
          <th scope="col">Total</th>
        </tr>
      </thead>
      <tbody>
        {monthly.map((month) => (
          <tr key={month.month}>
            <th scope="row">{monthName(month.month)}</th>
            <td>{month.authorizedCount}</td>
            <td>{formatUsd(month.authorizedTotal)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function RankingTable({
  rows,
  caption,
  nameHeader,
  detailHeader,
}: {
  rows: readonly RankingRow[];
  caption: string;
  nameHeader: string;
  detailHeader: string;
}) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">{nameHeader}</th>
          <th scope="col">{detailHeader}</th>
          <th scope="col">Facturado</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <th scope="row">{row.name}</th>
            <td>{row.detail}</td>
            <td>{formatUsd(row.value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
