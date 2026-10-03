// FileField (component-system.md, forms-and-workflows.md "Managed Files"), variante de un archivo:
// tipos y límite visibles antes de elegir; nombre, tipo, tamaño y estado del archivo; reemplazar y
// quitar. La validación del cliente es solo una alerta temprana: el servidor decide por el contenido.
"use client";

import { FileUp, LoaderCircle, Trash2 } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

export type CurrentFile = {
  name: string;
  typeLabel: string;
  sizeBytes: number;
  preview?: ReactNode;
};

export const formatSize = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} KB`;

export function FileField({
  id,
  label,
  accept,
  acceptLabel,
  maxBytes,
  current,
  onSelect,
  onRemove,
  pending,
  disabledReason,
  error,
}: {
  id: string;
  label: string;
  /** Tipos MIME o extensiones (".p12") admitidos, para el selector y la alerta temprana. */
  accept: readonly string[];
  /** Tipos en lenguaje del usuario, por ejemplo "PNG o JPEG". */
  acceptLabel: string;
  maxBytes: number;
  current: CurrentFile | null;
  onSelect: (file: File) => void;
  onRemove?: () => void;
  pending: boolean;
  /** Si el campo no está disponible todavía, la explicación que se muestra en su lugar. */
  disabledReason?: string | undefined;
  error?: string | undefined;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const shownError = localError ?? error;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const disabled = pending || Boolean(disabledReason);

  function choose(file: File | undefined) {
    if (!file) return;
    const name = file.name.toLowerCase();
    // Algunos sistemas informan un tipo vacío o distinto para extensiones como .p12.
    if (!accept.some((type) => (type.startsWith(".") ? name.endsWith(type) : type === file.type))) {
      setLocalError(`El archivo debe ser ${acceptLabel}.`);
      return;
    }
    if (file.size > maxBytes) {
      setLocalError(`El archivo supera el límite de ${formatSize(maxBytes)}.`);
      return;
    }
    setLocalError(null);
    onSelect(file);
  }

  return (
    <div className="flex flex-col gap-1">
      <span id={`${id}-label`} className="text-sm font-medium">
        {label}
      </span>
      <p id={hintId} className="text-xs text-foreground-muted">
        {disabledReason ?? `${acceptLabel}, hasta ${formatSize(maxBytes)}.`}
      </p>
      {current && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-surface p-1">
          {current.preview}
          <div className="flex min-w-0 flex-col text-sm">
            <span className="font-medium break-words">{current.name}</span>
            <span className="text-foreground-muted">
              {current.typeLabel} · {formatSize(current.sizeBytes)}
            </span>
          </div>
        </div>
      )}
      <input
        ref={input}
        id={id}
        type="file"
        accept={accept.join(",")}
        className="sr-only"
        tabIndex={-1}
        aria-labelledby={`${id}-label`}
        aria-describedby={shownError ? errorId : hintId}
        onChange={(event) => {
          choose(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <div className="flex flex-wrap items-center gap-1">
        <Button
          variant="outline"
          disabled={disabled}
          aria-describedby={shownError ? errorId : hintId}
          onClick={() => input.current?.click()}
        >
          {pending ? (
            <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" />
          ) : (
            <FileUp aria-hidden="true" />
          )}
          {current ? "Reemplazar" : "Elegir archivo"}
        </Button>
        {current && onRemove && (
          <Button variant="ghost" disabled={disabled} onClick={onRemove}>
            <Trash2 aria-hidden="true" />
            Eliminar
          </Button>
        )}
      </div>
      {shownError && (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {shownError}
        </p>
      )}
    </div>
  );
}
