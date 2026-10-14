// Franja de aviso persistente bajo la cabecera (feedback-and-states.md): solo para condiciones que
// persisten, como el ambiente de Pruebas o la firma por vencer. Icono y texto, nunca solo color.
import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const TONES = {
  warning: { icon: TriangleAlert, strip: "border-warning/40 bg-warning/10", icon_: "text-warning" },
  danger: { icon: CircleAlert, strip: "border-danger/40 bg-danger/10", icon_: "text-danger" },
  success: { icon: CircleCheck, strip: "border-border bg-surface", icon_: "text-success" },
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
