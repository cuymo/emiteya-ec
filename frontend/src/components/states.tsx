// StatusBadge, EmptyState, ErrorState y Skeleton (component-system.md, feedback-and-states.md).
import { CircleCheck, CircleSlash, Lock, RotateCw, SearchX, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

const TONES: Record<StatusTone, { className: string; icon: LucideIcon }> = {
  success: { className: "text-success bg-success/10 border-success/30", icon: CircleCheck },
  warning: { className: "text-warning bg-warning/10 border-warning/30", icon: CircleCheck },
  danger: { className: "text-danger bg-danger/10 border-danger/30", icon: CircleSlash },
  info: { className: "text-info bg-info/10 border-info/30", icon: CircleCheck },
  neutral: {
    className: "text-foreground-muted bg-surface-subtle border-border",
    icon: CircleSlash,
  },
};

/** Estado con icono y texto, nunca solo color; el módulo mapea su dominio a un tono. */
export function StatusBadge({
  tone,
  label,
  icon,
}: {
  tone: StatusTone;
  label: string;
  icon?: LucideIcon;
}) {
  const Icon = icon ?? TONES[tone].icon;
  return (
    <span
      className={cn(
        "inline-flex h-3 items-center gap-0.5 rounded-sm border px-0.5 text-xs font-medium whitespace-nowrap",
        TONES[tone].className,
      )}
    >
      <Icon aria-hidden="true" className="size-1.5" />
      <span className="text-foreground">{label}</span>
    </span>
  );
}

const EMPTY_ICONS = { empty: SearchX, "no-matches": SearchX, "no-permission": Lock } as const;

export function EmptyState({
  kind,
  title,
  description,
  action,
}: {
  kind: keyof typeof EMPTY_ICONS;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  const Icon = EMPTY_ICONS[kind];
  return (
    <div className="flex flex-col items-center gap-1 px-2 py-6 text-center">
      <Icon aria-hidden="true" className="size-4 text-foreground-muted" />
      <p className="text-base font-semibold">{title}</p>
      {description && <p className="max-w-prose text-sm text-foreground-muted">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-1 px-2 py-6 text-center">
      <p className="text-base font-semibold">{message}</p>
      <Button variant="outline" onClick={onRetry}>
        <RotateCw aria-hidden="true" />
        Intentar de nuevo
      </Button>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("rounded-md bg-surface-subtle motion-safe:animate-pulse", className)}
    />
  );
}
