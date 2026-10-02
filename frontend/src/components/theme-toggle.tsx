"use client";

import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useRef, useSyncExternalStore, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

const OPTIONS: { value: string; label: string; icon: LucideIcon }[] = [
  { value: "light", label: "Claro", icon: Sun },
  { value: "dark", label: "Oscuro", icon: Moon },
  { value: "system", label: "Sistema", icon: Monitor },
];

const subscribe = () => () => {};

/** Control segmentado de tema: tres modos visibles, con el patrón de grupo de radio de ARIA. */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  // El tema solo se conoce en el cliente; en el servidor se renderiza sin selección y con la misma geometría.
  const isClient = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const selected = isClient ? (theme ?? "system") : undefined;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const current = Math.max(
      0,
      OPTIONS.findIndex((option) => option.value === selected),
    );
    const next = (current + step + OPTIONS.length) % OPTIONS.length;
    const option = OPTIONS[next];
    if (!option) return;
    setTheme(option.value);
    refs.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label="Tema"
      onKeyDown={onKeyDown}
      className="flex items-center gap-0.5 rounded-lg border border-border bg-surface-subtle p-0.5"
    >
      {OPTIONS.map((option, index) => {
        const checked = selected === option.value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            ref={(element) => {
              refs.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={option.label}
            title={option.label}
            tabIndex={checked || (selected === undefined && index === 0) ? 0 : -1}
            onClick={() => setTheme(option.value)}
            className={cn(
              "inline-flex size-5.5 items-center justify-center rounded-md text-foreground-muted",
              "motion-safe:transition-colors motion-safe:duration-150 motion-safe:ease-standard",
              "hover:text-foreground active:bg-border",
              checked && "bg-surface text-foreground shadow-sm",
            )}
          >
            <Icon aria-hidden="true" className="size-2.5" />
          </button>
        );
      })}
    </div>
  );
}
