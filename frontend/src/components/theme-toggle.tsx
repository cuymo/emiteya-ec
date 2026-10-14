"use client";

import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { DropdownMenu } from "radix-ui";
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
      className="hidden items-center gap-1 rounded-lg border border-border bg-surface-subtle p-1 sm:flex"
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
              "inline-flex size-11 items-center justify-center rounded-md text-foreground-muted",
              "motion-safe:transition-colors motion-safe:duration-150 motion-safe:ease-standard",
              "hover:text-foreground active:bg-border",
              checked && "bg-surface text-foreground shadow-sm",
            )}
          >
            <Icon aria-hidden="true" className="size-5" />
          </button>
        );
      })}
    </div>
  );
}

/** En pantallas pequeñas, el mismo control como menú de un solo botón de 44px. */
export function ThemeMenu() {
  const { theme, setTheme } = useTheme();
  const isClient = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const selected = isClient ? (theme ?? "system") : "system";
  const Current = OPTIONS.find((option) => option.value === selected)?.icon ?? Monitor;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label="Tema"
        className="inline-flex size-11 items-center justify-center rounded-md text-foreground-muted hover:bg-surface-subtle hover:text-foreground sm:hidden"
      >
        <Current aria-hidden="true" className="size-5" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="z-(--z-popover) min-w-40 rounded-md border border-border bg-surface p-1 text-sm shadow-md"
        >
          <DropdownMenu.RadioGroup value={selected} onValueChange={setTheme}>
            {OPTIONS.map((option) => {
              const Icon = option.icon;
              return (
                <DropdownMenu.RadioItem
                  key={option.value}
                  value={option.value}
                  className="flex h-11 cursor-default items-center gap-2 rounded-sm px-2 outline-none data-highlighted:bg-surface-subtle data-[state=checked]:font-semibold"
                >
                  <Icon aria-hidden="true" className="size-5" />
                  {option.label}
                </DropdownMenu.RadioItem>
              );
            })}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
