// Franja de aviso persistente bajo la cabecera (feedback-and-states.md): solo para condiciones que
// persisten, como el ambiente de Pruebas o la firma por vencer. Icono y texto, nunca solo color. El
// tono `environment` es el del ambiente de Pruebas: una superficie neutra con el icono y un acento
// lateral de advertencia, para que la franja que se ve en cada pantalla no canse (design D27); la
// advertencia saturada queda para lo que pide una acción, como la firma por vencer.
import { CircleAlert, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const TONES = {
  environment: {
    icon: TriangleAlert,
    strip: "border-border border-l-4 border-l-warning bg-muted/50",
    icon_: "text-warning",
  },
  warning: { icon: TriangleAlert, strip: "border-warning/40 bg-warning/10", icon_: "text-warning" },
  danger: { icon: CircleAlert, strip: "border-danger/40 bg-danger/10", icon_: "text-danger" },
} as const;

export function NoticeStrip({
  tone,
  className,
  children,
}: {
  tone: keyof typeof TONES;
  className?: string;
  children: ReactNode;
}) {
  const { icon: Icon, strip, icon_ } = TONES[tone];
  return (
    <div
      role="status"
      className={cn("flex items-center gap-2 border-b px-2 py-1 text-sm md:px-4", strip, className)}
    >
      <Icon aria-hidden="true" className={cn("size-4 shrink-0", icon_)} />
      <p>{children}</p>
    </div>
  );
}
