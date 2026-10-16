// Gráficos del tablero de Inicio con los charts de shadcn/ui (Recharts). Una sola serie por gráfico,
// en `--chart-1`, así que no llevan leyenda: el título de la tarjeta dice qué se mide. Son
// decorativos para la asistencia, que lee las tablas equivalentes (`dashboard-tables.tsx`); llevan
// su tooltip al pasar y barras finas con el
// extremo de datos redondeado y la base recta. Los importes se muestran como los da el servidor; los
// números solo dan la longitud de las barras.
"use client";

import type { DashboardView } from "@facturador/contracts";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatUsd } from "@/lib/decimal";
import { MONTH_SHORT, monthName } from "./dashboard-format";

const COMPACT = new Intl.NumberFormat("es-EC", { notation: "compact", maximumFractionDigits: 1 });

const SERIES = "var(--color-chart-1)";

type LabelProps = { x?: number | string; y?: number | string; value?: unknown };
type BarLabelProps = LabelProps & { width?: number | string; height?: number | string };

/** Ventas autorizadas de los seis últimos meses: el mes en curso destacado y los demás de contexto. */
export function SalesChart({ monthly }: { monthly: DashboardView["monthly"] }) {
  const config = { total: { label: "Autorizado", color: SERIES } } satisfies ChartConfig;
  const last = monthly.length - 1;
  const data = monthly.map((month, index) => ({
    month: month.month,
    label: monthName(month.month, MONTH_SHORT),
    total: Number(month.authorizedTotal),
    display: formatUsd(month.authorizedTotal),
    // Solo el mes en curso lleva su valor sobre la barra; el resto, en el eje y el tooltip.
    cap: index === last ? COMPACT.format(Number(month.authorizedTotal)) : null,
  }));
  return (
    <ChartContainer config={config} className="h-56" aria-hidden="true">
      <BarChart data={data} margin={{ top: 20, right: 4, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--color-border)" />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          className="capitalize"
        />
        <YAxis
          width={44}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value: number) => COMPACT.format(value)}
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) => {
                const month = payload[0]?.payload?.month;
                return typeof month === "string" ? monthName(month) : null;
              }}
              formatter={(_, item) => String(item.payload?.display ?? "")}
            />
          }
        />
        <Bar dataKey="total" radius={[4, 4, 0, 0]} maxBarSize={24}>
          {data.map((row, index) => (
            <Cell key={row.month} fill={SERIES} fillOpacity={index === last ? 1 : 0.35} />
          ))}
          <LabelList
            dataKey="cap"
            content={({ x, y, value, width }: BarLabelProps) =>
              value ? (
                <text
                  x={Number(x) + Number(width) / 2}
                  y={Number(y) - 6}
                  textAnchor="middle"
                  className="fill-foreground text-xs font-medium tabular-nums"
                >
                  {String(value)}
                </text>
              ) : null
            }
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

export type RankingRow = {
  key: string;
  name: string;
  /** Contexto de la fila: la identificación y las facturas, o el código y las unidades. */
  detail: string;
  /** Importe decimal del servidor. */
  value: string;
};

/** Alto del gráfico según sus filas: cada barra conserva su espacio y su etiqueta encima. */
const RANKING_HEIGHT = ["h-16", "h-28", "h-40", "h-52", "h-64"] as const;
const shorten = (text: string, max = 38) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/**
 * Ranking en barras horizontales: el nombre encima de cada barra y el importe en su extremo. El
 * nombre completo y su contexto van en el tooltip y en la tabla para la asistencia.
 */
export function RankingChart({ rows }: { rows: readonly RankingRow[] }) {
  const config = { total: { label: "Facturado", color: SERIES } } satisfies ChartConfig;
  const data = rows.map((row) => ({
    ...row,
    total: Number(row.value),
    display: formatUsd(row.value),
    short: shorten(row.name),
  }));
  const height = RANKING_HEIGHT[Math.min(rows.length, RANKING_HEIGHT.length) - 1];
  return (
    <ChartContainer config={config} className={height} aria-hidden="true">
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 92, bottom: 0, left: 0 }}>
        <XAxis type="number" dataKey="total" hide domain={[0, "dataMax"]} />
        <YAxis type="category" dataKey="key" hide />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) => {
                const row = payload[0]?.payload;
                return row ? (
                  <span className="flex flex-col gap-0.5">
                    <span>{String(row.name)}</span>
                    <span className="font-normal text-muted-foreground">{String(row.detail)}</span>
                  </span>
                ) : null;
              }}
              formatter={(_, item) => String(item.payload?.display ?? "")}
            />
          }
        />
        <Bar dataKey="total" fill={SERIES} radius={[0, 4, 4, 0]} barSize={12}>
          <LabelList
            dataKey="short"
            content={({ x, y, value }: LabelProps) => (
              <text x={Number(x)} y={Number(y) - 7} className="fill-foreground text-xs">
                {String(value)}
              </text>
            )}
          />
          {/* El importe en el extremo de la barra, en una sola línea: Recharts lo partiría al ancho
                de la etiqueta. */}
          <LabelList
            dataKey="display"
            content={({ x, y, width, height, value }: BarLabelProps) => (
              <text
                x={Number(x) + Number(width) + 8}
                y={Number(y) + Number(height) / 2}
                dominantBaseline="central"
                className="fill-foreground text-xs font-medium tabular-nums"
              >
                {String(value)}
              </text>
            )}
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
