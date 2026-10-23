// DatePickerField (component-system.md; add-document-archive, design D13): selección de una fecha con
// el calendario de shadcn en un popover (decisión del propietario, 2026-10-22, que reemplaza el
// `<input type="date">` nativo), con etiqueta, limpieza y error asociados al campo. El botón muestra la
// fecha como «dd/mm/aaaa» y su nombre accesible lleva la etiqueta y la fecha. El calendario, en
// español, abre en la fecha elegida (o en el mes del límite más cercano), con el mes y el año en
// listas, y deshabilita los días fuera de `min` y `max`. El valor es la fecha de calendario
// `YYYY-MM-DD`, o "" sin fecha.
"use client";

import { CalendarDays, X } from "lucide-react";
import { useId, useState } from "react";
import { LabelWithHint } from "@/components/field-hint";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** Años que ofrece la lista cuando no hay límite: veinte atrás y cinco adelante. */
const YEARS_BACK = 20;
const YEARS_AHEAD = 5;

const fromIso = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year!, month! - 1, day!);
};
const pad = (value: number) => String(value).padStart(2, "0");
const toIso = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const toDisplay = (value: string) => value.split("-").reverse().join("/");

export function DatePickerField({
  label,
  value,
  onChange,
  error,
  min,
  max,
  hint,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Ayuda del campo, en el tooltip de su etiqueta (decisión del propietario, 2026-10-22). */
  hint?: string;
  error?: string | null;
  min?: string;
  max?: string;
  className?: string;
}) {
  const id = useId();
  const labelId = `${id}-label`;
  const valueId = `${id}-value`;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = error ? errorId : hint ? hintId : undefined;
  const [open, setOpen] = useState(false);
  const selected = value ? fromIso(value) : undefined;
  const minDate = min ? fromIso(min) : undefined;
  const maxDate = max ? fromIso(max) : undefined;
  const thisYear = new Date().getFullYear();
  const startMonth = minDate ?? new Date(thisYear - YEARS_BACK, 0);
  const endMonth = maxDate ?? new Date(thisYear + YEARS_AHEAD, 11);
  const today = new Date();
  const opening =
    selected ??
    (minDate && minDate > today ? minDate : maxDate && maxDate < today ? maxDate : today);
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <LabelWithHint label={label} hint={hint} hintId={hintId}>
        <Label id={labelId} htmlFor={id}>
          {label}
        </Label>
      </LabelWithHint>
      <div className="relative">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              id={id}
              type="button"
              aria-labelledby={`${labelId} ${valueId}`}
              aria-invalid={error ? true : undefined}
              aria-describedby={describedBy}
              className={cn(
                "flex h-10 w-full min-w-0 items-center gap-2 rounded-md border border-input bg-surface pl-3 text-left text-base text-foreground sm:text-sm max-md:h-11",
                "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none aria-invalid:border-danger",
                value ? "pr-10" : "pr-3",
              )}
            >
              <CalendarDays aria-hidden="true" className="size-4 shrink-0 text-foreground-muted" />
              <span
                id={valueId}
                className={cn("min-w-0 truncate tabular-nums", !value && "text-foreground-muted")}
              >
                {value ? toDisplay(value) : "Elige una fecha"}
              </span>
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-2">
            <Calendar
              mode="single"
              captionLayout="dropdown"
              selected={selected}
              defaultMonth={opening}
              startMonth={startMonth}
              endMonth={endMonth}
              disabled={[
                ...(minDate ? [{ before: minDate }] : []),
                ...(maxDate ? [{ after: maxDate }] : []),
              ]}
              autoFocus
              onSelect={(date) => {
                if (date) onChange(toIso(date));
                setOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>
        {value && (
          <button
            type="button"
            aria-label={`Limpiar ${label.toLowerCase()}`}
            onClick={() => onChange("")}
            className="absolute inset-y-0 right-0 inline-flex w-10 items-center justify-center text-foreground-muted hover:text-foreground"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        )}
      </div>
      {error && (
        <p id={errorId} className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
