// Búsqueda de la tabla compartida (productize-invoice-list-and-shared-table-foundation, design D8).
// Visual portado del campo de `src/app/(main)/dashboard/tasks/_components/tasks-toolbar.tsx` de la
// plantilla «Studio Admin» (MIT; frontend/THIRD_PARTY_NOTICES.md). Consulta al servidor: escribe el
// valor recortado tras una espera breve, con el límite del servidor, y nunca filtra en el
// navegador. Su nombre y su texto de ayuda dicen lo que busca de verdad; los pone el módulo.
"use client";

import { Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function DataTableSearch({
  label,
  placeholder,
  value,
  onChange,
  debounceMs = 300,
  maxLength,
}: {
  /** Nombre accesible: lo que la búsqueda busca. */
  label: string;
  placeholder: string;
  /** El valor vigente en la URL. */
  value: string;
  onChange: (value: string) => void;
  debounceMs?: number;
  maxLength?: number;
}) {
  const [draft, setDraft] = useState(value);
  const [synced, setSynced] = useState(value);
  // «Limpiar filtros» o volver atrás cambian el valor desde fuera: el borrador lo sigue.
  if (value !== synced) {
    setSynced(value);
    setDraft(value);
  }

  useEffect(() => {
    const next = draft.trim();
    if (next === value) return;
    const timer = setTimeout(() => onChange(next), debounceMs);
    return () => clearTimeout(timer);
  }, [debounceMs, draft, onChange, value]);

  return (
    <div className="relative w-full sm:w-72">
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={draft}
        maxLength={maxLength}
        onChange={(event) => setDraft(event.target.value)}
        className="h-8 pr-9 pl-8 [&::-webkit-search-cancel-button]:hidden"
      />
      {draft !== "" && (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Limpiar búsqueda"
          className="absolute top-1/2 right-1.5 -translate-y-1/2"
          onClick={() => {
            setDraft("");
            onChange("");
          }}
        >
          <X aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}
