// Derivado de shadcn/ui, `components/ui/chart.tsx` (MIT; frontend/THIRD_PARTY_NOTICES.md), sobre
// Recharts 3. Adaptado a la CSP del producto (ADR 0025):
// - sin `ChartStyle`: no inserta un `<style>` por gráfico; cada serie toma su color de un token del
//   tema (`--chart-1`, …) que `globals.css` define para el modo claro y el oscuro;
// - sin atributos `style`: el indicador del tooltip es un trazo SVG con su `fill`;
// - el tooltip pone primero el valor y después la etiqueta, con los textos en tokens de texto.
"use client";

import { createContext, useContext, useId, type ComponentProps, type ReactNode } from "react";
import * as RechartsPrimitive from "recharts";
import { cn } from "@/lib/utils";

/** Cada serie del gráfico: su etiqueta y su color, un token del tema como `var(--chart-1)`. */
export type ChartConfig = Record<string, { label: ReactNode; color: string }>;

const ChartContext = createContext<{ config: ChartConfig } | null>(null);

export function useChart() {
  const context = useContext(ChartContext);
  if (!context) throw new Error("useChart debe usarse dentro de <ChartContainer />");
  return context;
}

export function ChartContainer({
  id,
  className,
  children,
  config,
  ...props
}: ComponentProps<"div"> & {
  config: ChartConfig;
  children: ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>["children"];
}) {
  const uniqueId = useId();
  const chartId = `chart-${id ?? uniqueId.replace(/:/g, "")}`;
  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-slot="chart"
        data-chart={chartId}
        className={cn(
          "flex w-full justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted [&_.recharts-surface]:outline-hidden [&_.recharts-layer]:outline-hidden",
          className,
        )}
        {...props}
      >
        <RechartsPrimitive.ResponsiveContainer>{children}</RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

export const ChartTooltip = RechartsPrimitive.Tooltip;

type TooltipItem = {
  name?: string | number;
  value?: number | string | readonly (number | string)[];
  dataKey?: string | number | ((row: unknown) => unknown);
  payload?: Record<string, unknown>;
  color?: string;
};

export function ChartTooltipContent({
  active,
  payload,
  label,
  className,
  hideLabel = false,
  labelFormatter,
  formatter,
}: {
  active?: boolean;
  payload?: readonly TooltipItem[];
  label?: ReactNode;
  className?: string;
  hideLabel?: boolean;
  labelFormatter?: (label: ReactNode, payload: readonly TooltipItem[]) => ReactNode;
  /** El valor ya formateado de una fila; lo demás de la fila sale de la configuración. */
  formatter?: (value: number, item: TooltipItem) => ReactNode;
}) {
  const { config } = useChart();
  if (!active || !payload?.length) return null;
  const heading = labelFormatter ? labelFormatter(label, payload) : label;
  return (
    <div
      data-slot="chart-tooltip"
      className={cn(
        "grid min-w-32 items-start gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl",
        className,
      )}
    >
      {!hideLabel && heading ? <div className="font-medium">{heading}</div> : null}
      <div className="grid gap-1.5">
        {payload.map((item, index) => {
          const key = String(item.dataKey ?? item.name ?? index);
          const series = config[key];
          const value = Number(item.value);
          return (
            <div key={key} className="flex w-full items-center gap-2">
              <svg aria-hidden="true" viewBox="0 0 10 2" className="h-0.5 w-2.5 shrink-0">
                <rect width="10" height="2" rx="1" fill={series?.color ?? item.color} />
              </svg>
              <div className="flex flex-1 items-center justify-between gap-3 leading-none">
                <span className="font-medium text-foreground tabular-nums">
                  {formatter ? formatter(value, item) : value.toLocaleString("es-EC")}
                </span>
                <span className="text-muted-foreground">{series?.label ?? item.name}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
