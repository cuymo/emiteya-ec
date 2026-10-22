// Gráficos del tablero de Inicio con los charts de shadcn/ui (Recharts), cada uno con la forma que
// pide su dato (decisión del propietario, 2026-10-22):
// - ventas de seis meses: línea con área, porque es una tendencia; una serie en `--chart-1`;
// - mejores clientes: dona, cómo se reparte lo facturado entre los cinco, con los cinco colores de
//   categoría (`--chart-1` a `--chart-5`) en orden fijo y su leyenda en el orden del anillo;
// - productos más vendidos: columnas con el código del producto, una serie en `--chart-1`;
// - comprobantes del mes: énfasis de dos series (lo autorizado en `--chart-1` y el resto en
//   `--chart-muted`), con su leyenda.
// Los colores pasan el validador de paletas en los dos temas (pares vecinos, también con daltonismo).
// Son decorativos para la asistencia, que lee las tablas equivalentes (`dashboard-tables.tsx`);
// llevan su tooltip al pasar. Los importes se muestran como los da el servidor; los números solo dan
// el tamaño de las marcas.
"use client";

import type { DashboardView } from "@facturador/contracts";
import { useId } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Pie,
  PieChart,
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

const ONE_DECIMAL = new Intl.NumberFormat("es-EC", { maximumFractionDigits: 1 });
/**
 * Abreviatura de las escalas y del valor destacado, siempre «k» y «M»: el formato compacto del
 * navegador mezclaba «5 K» y «34,7 k» según la magnitud.
 */
const compact = (value: number) =>
  Math.abs(value) >= 1_000_000
    ? `${ONE_DECIMAL.format(value / 1_000_000)} M`
    : Math.abs(value) >= 1_000
      ? `${ONE_DECIMAL.format(value / 1_000)} k`
      : ONE_DECIMAL.format(value);

const SERIES = "var(--color-chart-1)";
const REST = "var(--color-chart-muted)";
/** Los colores de categoría, en su orden fijo: nunca se reciclan ni se generan. */
const CATEGORIES = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
] as const;
/** La separación de 2 px entre marcas contiguas: un trazo del color de la tarjeta, no un borde. */
const SURFACE = "var(--color-card)";

type LabelProps = { x?: number | string; y?: number | string; value?: unknown };
type BarLabelProps = LabelProps & { width?: number | string; height?: number | string };

/**
 * Ventas autorizadas de los seis últimos meses en una línea con área: el mes en curso lleva su valor
 * sobre el punto; los demás, en el eje y el tooltip.
 */
export function SalesChart({ monthly }: { monthly: DashboardView["monthly"] }) {
  const config = { total: { label: "Autorizado", color: SERIES } } satisfies ChartConfig;
  // El id del degradado, sin los caracteres de `useId` que no valen en `url(#…)`.
  const gradient = `ventas-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const last = monthly.length - 1;
  const data = monthly.map((month, index) => ({
    month: month.month,
    label: monthName(month.month, MONTH_SHORT),
    total: Number(month.authorizedTotal),
    display: formatUsd(month.authorizedTotal),
    cap: index === last ? compact(Number(month.authorizedTotal)) : null,
  }));
  return (
    <ChartContainer config={config} className="h-64" aria-hidden="true">
      {/* A la derecha cabe la etiqueta del mes en curso, centrada en su punto. */}
      <AreaChart data={data} margin={{ top: 24, right: 32, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={SERIES} stopOpacity={0.24} />
            <stop offset="100%" stopColor={SERIES} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--color-border)" />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          className="capitalize"
        />
        <YAxis width={44} tickLine={false} axisLine={false} tickFormatter={compact} />
        <ChartTooltip
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
        <Area
          dataKey="total"
          type="monotone"
          stroke={SERIES}
          strokeWidth={2}
          fill={`url(#${gradient})`}
          dot={{ r: 4, fill: SERIES, stroke: SURFACE, strokeWidth: 2 }}
          activeDot={{ r: 5, fill: SERIES, stroke: SURFACE, strokeWidth: 2 }}
        >
          <LabelList
            dataKey="cap"
            content={({ x, y, value }: LabelProps) =>
              value ? (
                <text
                  x={Number(x)}
                  y={Number(y) - 12}
                  textAnchor="middle"
                  className="fill-foreground text-xs font-medium tabular-nums"
                >
                  {String(value)}
                </text>
              ) : null
            }
          />
        </Area>
      </AreaChart>
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
  /** Etiqueta corta para el eje de las columnas, como el código del producto. */
  short?: string;
};

/** Alto del gráfico según sus filas: cada barra conserva su espacio y su etiqueta encima. */
const ROWS_HEIGHT = ["h-16", "h-28", "h-40", "h-52", "h-64", "h-76"] as const;
const rowsHeight = (rows: number) => ROWS_HEIGHT[Math.min(rows, ROWS_HEIGHT.length) - 1];

/** El encabezado del tooltip de un ranking: el nombre completo y su contexto. */
function rankingHeading(_: unknown, payload: readonly { payload?: Record<string, unknown> }[]) {
  const row = payload[0]?.payload;
  return row ? (
    <span className="flex flex-col gap-0.5">
      <span>{String(row.name)}</span>
      <span className="font-normal text-muted-foreground">{String(row.detail)}</span>
    </span>
  ) : null;
}

/**
 * Reparto en una dona: cada cliente con su color de categoría, en el orden del ranking desde las 12
 * en sentido horario, separados por 2 px. La leyenda, en el mismo orden, dice el nombre y el importe:
 * identifica cada porción sin depender solo del color.
 */
export function ShareChart({ rows }: { rows: readonly RankingRow[] }) {
  // Sin serie en la configuración: el tooltip toma el color de cada porción.
  const config = {} satisfies ChartConfig;
  const data = rows.slice(0, CATEGORIES.length).map((row, index) => ({
    ...row,
    total: Number(row.value),
    display: formatUsd(row.value),
    fill: CATEGORIES[index]!,
    // El nombre de la fila del tooltip; el del cliente ya va en su encabezado.
    series: "Facturado",
  }));
  return (
    <div className="flex flex-col items-center gap-4" aria-hidden="true">
      <ChartContainer config={config} className="aspect-square h-44">
        <PieChart>
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={rankingHeading}
                formatter={(_, item) => String(item.payload?.display ?? "")}
              />
            }
          />
          <Pie
            data={data}
            dataKey="total"
            nameKey="series"
            innerRadius="58%"
            outerRadius="100%"
            startAngle={90}
            endAngle={-270}
            stroke={SURFACE}
            strokeWidth={2}
          >
            {data.map((row) => (
              <Cell key={row.key} fill={row.fill} />
            ))}
          </Pie>
        </PieChart>
      </ChartContainer>
      <ul className="flex w-full flex-col gap-1.5 text-xs">
        {data.map((row) => (
          <li key={row.key} className="flex items-center gap-2">
            <svg aria-hidden="true" viewBox="0 0 10 10" className="size-2.5 shrink-0">
              <rect width="10" height="10" rx="2" fill={row.fill} />
            </svg>
            <span className="min-w-0 flex-1 truncate" title={row.name}>
              {row.name}
            </span>
            <span className="font-medium text-foreground tabular-nums">{row.display}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Ranking en columnas: el código del producto bajo cada una, la escala en el eje y el valor del
 * primero sobre su columna. El nombre completo, su contexto y el importe van en el tooltip y en la
 * tabla para la asistencia.
 */
export function ColumnChart({ rows }: { rows: readonly RankingRow[] }) {
  const config = { total: { label: "Facturado", color: SERIES } } satisfies ChartConfig;
  const data = rows.map((row, index) => ({
    ...row,
    total: Number(row.value),
    display: formatUsd(row.value),
    tick: row.short ?? row.name,
    cap: index === 0 ? compact(Number(row.value)) : null,
  }));
  return (
    <ChartContainer config={config} className="h-60" aria-hidden="true">
      <BarChart data={data} margin={{ top: 20, right: 4, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--color-border)" />
        <XAxis dataKey="tick" tickLine={false} axisLine={false} tickMargin={8} interval={0} />
        <YAxis width={44} tickLine={false} axisLine={false} tickFormatter={compact} />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              labelFormatter={rankingHeading}
              formatter={(_, item) => String(item.payload?.display ?? "")}
            />
          }
        />
        <Bar dataKey="total" fill={SERIES} radius={[4, 4, 0, 0]} maxBarSize={24}>
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
