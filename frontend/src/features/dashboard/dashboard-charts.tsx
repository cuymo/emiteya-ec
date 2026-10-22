// Gráficos del tablero de Inicio con los charts de shadcn/ui (Recharts). Las ventas y los rankings
// tienen una sola serie, en `--chart-1`, así que no llevan leyenda: el título de la tarjeta dice qué
// se mide. Los comprobantes del mes son un gráfico de énfasis de dos series (lo autorizado en
// `--chart-1` y el resto en `--chart-muted`), con su leyenda. Son decorativos para la asistencia,
// que lee las tablas equivalentes (`dashboard-tables.tsx`); llevan su tooltip al pasar y barras
// finas con el extremo de datos redondeado y la base recta. Los importes se muestran como los da el
// servidor; los números solo dan la longitud de las barras.
"use client";

import type { DashboardView } from "@facturador/contracts";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Rectangle,
  XAxis,
  YAxis,
  type RectangleProps,
} from "recharts";
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
const REST = "var(--color-chart-muted)";
/** La separación de 2 px entre tramos contiguos: un trazo del color de la tarjeta, no un borde. */
const SURFACE = "var(--color-card)";

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
const ROWS_HEIGHT = ["h-16", "h-28", "h-40", "h-52", "h-64", "h-76"] as const;
const rowsHeight = (rows: number) => ROWS_HEIGHT[Math.min(rows, ROWS_HEIGHT.length) - 1];
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
  return (
    <ChartContainer config={config} className={rowsHeight(rows.length)} aria-hidden="true">
      {/* A la derecha cabe el importe más largo, «USD 999.999,99», sin recortarse. */}
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 104, bottom: 0, left: 0 }}>
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

export type DocumentTypeRow = {
  key: string;
  /** El tipo de comprobante, como «Factura». */
  name: string;
  issued: number;
  authorized: number;
  /** Total autorizado como lo da el servidor; null para la guía de remisión, que no tiene total. */
  amount: string | null;
};

/** Una muestra de la leyenda: el color de la serie va en la marca, nunca en el texto. */
function LegendKey({ color, label }: { color: string; label: string }) {
  return (
    <li className="flex items-center gap-1.5">
      <svg aria-hidden="true" viewBox="0 0 10 10" className="size-2.5 shrink-0">
        <rect width="10" height="10" rx="2" fill={color} />
      </svg>
      {label}
    </li>
  );
}

/** El tipo y su total, encima del comienzo de la barra. */
const captionLabel = ({ x, y, value }: LabelProps) =>
  value ? (
    <text x={Number(x)} y={Number(y) - 7} className="fill-foreground text-xs">
      {String(value)}
    </text>
  ) : null;

/** «15 de 18», en el extremo del tramo, en una sola línea. */
const endLabel = ({ x, y, width, height, value }: BarLabelProps) =>
  value ? (
    <text
      x={Number(x) + Number(width) + 8}
      y={Number(y) + Number(height) / 2}
      dominantBaseline="central"
      className="fill-foreground text-xs font-medium tabular-nums"
    >
      {String(value)}
    </text>
  ) : null;

/**
 * Comprobantes del mes por tipo, en barras apiladas sobre una misma escala de cantidades: el largo
 * es lo emitido, el tramo azul lo autorizado y el gris lo que falta. Encima de cada barra, el tipo y
 * su total autorizado; en el extremo, «15 de 18». Con leyenda, porque son dos series.
 */
export function DocumentsChart({ rows }: { rows: readonly DocumentTypeRow[] }) {
  const config = {
    authorized: { label: "Autorizados", color: SERIES },
    pending: { label: "Sin autorizar", color: REST },
  } satisfies ChartConfig;
  const data = rows.map((row) => ({
    key: row.key,
    name: row.name,
    caption: row.amount === null ? row.name : `${row.name} · ${formatUsd(row.amount)}`,
    amount: row.amount === null ? null : formatUsd(row.amount),
    authorized: row.authorized,
    pending: Math.max(0, row.issued - row.authorized),
    end: `${row.authorized} de ${row.issued}`,
  }));
  // Recharts no dibuja la etiqueta de un tramo de ancho cero: el nombre va en el primer tramo con
  // valor y el extremo, en el último.
  const labeled = data.map((row) => ({
    ...row,
    captionOnAuthorized: row.authorized > 0 ? row.caption : null,
    captionOnPending: row.authorized > 0 ? null : row.caption,
    endOnAuthorized: row.pending > 0 ? null : row.end,
    endOnPending: row.pending > 0 ? row.end : null,
  }));
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground-muted">
        <LegendKey color={SERIES} label="Autorizados" />
        <LegendKey color={REST} label="Sin autorizar" />
      </ul>
      <ChartContainer config={config} className={rowsHeight(rows.length)} aria-hidden="true">
        <BarChart
          data={labeled}
          layout="vertical"
          margin={{ top: 4, right: 64, bottom: 0, left: 0 }}
        >
          <XAxis type="number" hide domain={[0, "dataMax"]} />
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
                      {row.amount ? (
                        <span className="font-normal text-muted-foreground">
                          Autorizado: {String(row.amount)}
                        </span>
                      ) : null}
                    </span>
                  ) : null;
                }}
                formatter={(value) => value.toLocaleString("es-EC")}
              />
            }
          />
          {/* La base del apilado es recta; el extremo de datos se redondea en el último tramo con
              valor de cada fila. */}
          <Bar
            dataKey="authorized"
            stackId="types"
            fill={SERIES}
            stroke={SURFACE}
            strokeWidth={2}
            barSize={14}
            shape={(props: RectangleProps & { payload?: { pending: number } }) => (
              <Rectangle {...props} radius={props.payload?.pending === 0 ? [0, 4, 4, 0] : 0} />
            )}
          >
            <LabelList dataKey="captionOnAuthorized" content={captionLabel} />
            <LabelList dataKey="endOnAuthorized" content={endLabel} />
          </Bar>
          <Bar
            dataKey="pending"
            stackId="types"
            fill={REST}
            stroke={SURFACE}
            strokeWidth={2}
            radius={[0, 4, 4, 0]}
            barSize={14}
          >
            <LabelList dataKey="captionOnPending" content={captionLabel} />
            <LabelList dataKey="endOnPending" content={endLabel} />
          </Bar>
        </BarChart>
      </ChartContainer>
    </div>
  );
}
