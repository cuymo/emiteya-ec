// DatePickerField (component-system.md; add-document-archive, design D13): selección de una fecha
// sobre el `<input type="date">` nativo, que el navegador localiza y adapta al tema y al teclado,
// con etiqueta, limpieza y error asociados al campo. El valor es la fecha de calendario
// `YYYY-MM-DD`, o "" sin fecha.
"use client";

import { X } from "lucide-react";
import { useId } from "react";
import { Input, Label } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function DatePickerField({
  label,
  value,
  onChange,
  error,
  min,
  max,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  min?: string;
  max?: string;
  className?: string;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type="date"
          value={value}
          min={min}
          max={max}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={cn(value && "pr-5")}
        />
        {value && (
          <button
            type="button"
            aria-label={`Limpiar ${label.toLowerCase()}`}
            onClick={() => onChange("")}
            className="absolute inset-y-0 right-0 inline-flex w-5 items-center justify-center text-foreground-muted hover:text-foreground"
          >
            <X aria-hidden="true" className="size-2" />
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
