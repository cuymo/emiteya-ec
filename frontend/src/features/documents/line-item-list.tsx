// Líneas de un comprobante en su detalle (decisión del propietario, 2026-10-16): con muchas líneas,
// un buscador de texto y una paginación discreta, para no alargar la pantalla sin fin. Las líneas ya
// llegan con el comprobante, así que la búsqueda y las páginas son del navegador: no consultan nada.
// - Con 10 líneas o menos, la lista va entera y sin controles.
// - La búsqueda no distingue mayúsculas ni tildes, busca en el nombre y el código, y vuelve a la
//   primera página; sin coincidencias, lo dice.
// - La paginación es una línea al pie: «11–20 de 45 productos» con las flechas de anterior y
//   siguiente; buscando, «3 de 45 productos».
"use client";

import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { Fragment, useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { normalize } from "@/lib/navigation/palette-filter";

const PAGE_SIZE = 10;

export function LineItemList<T>({
  items,
  getKey,
  getSearchText,
  renderItem,
  noun,
  pageSize = PAGE_SIZE,
}: {
  items: readonly T[];
  getKey: (item: T) => string | number;
  /** El texto en que busca: el nombre y el código de la línea. */
  getSearchText: (item: T) => string;
  /** Cada línea, como un `<li>`. */
  renderItem: (item: T) => ReactNode;
  /** «producto» y «productos», o «línea» y «líneas». */
  noun: { one: string; many: string };
  pageSize?: number;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const countId = useId();
  const paged = items.length > pageSize;
  const needle = normalize(query);
  const matches = needle
    ? items.filter((item) => normalize(getSearchText(item)).includes(needle))
    : items;
  const pages = Math.max(1, Math.ceil(matches.length / pageSize));
  const current = Math.min(page, pages);
  const start = (current - 1) * pageSize;
  const visible = paged ? matches.slice(start, start + pageSize) : matches;
  const range = `${start + 1}–${Math.min(start + pageSize, matches.length)}`;
  // «11–20 de 45 productos»; buscando, «3 de 45 productos», con el rango si hay varias páginas.
  const summary = needle
    ? `${matches.length} de ${items.length} ${noun.many}${pages > 1 ? ` · ${range}` : ""}`
    : `${range} de ${items.length} ${noun.many}`;

  return (
    <div data-slot="line-item-list" className="flex flex-col gap-3">
      {paged && (
        <div className="relative w-full sm:w-72">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            aria-label={`Buscar ${noun.many}`}
            aria-describedby={countId}
            placeholder="Buscar por nombre o código"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            className="h-8 rounded-lg pr-9 pl-8 [&::-webkit-search-cancel-button]:hidden"
          />
          {query !== "" && (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Limpiar búsqueda"
              onClick={() => {
                setQuery("");
                setPage(1);
              }}
              className="absolute top-1/2 right-1.5 -translate-y-1/2"
            >
              <X aria-hidden="true" />
            </Button>
          )}
        </div>
      )}
      {visible.length === 0 ? (
        <p className="text-sm text-foreground-muted">
          Ningún {noun.one} coincide con «{query.trim()}».
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((item) => (
            <Fragment key={getKey(item)}>{renderItem(item)}</Fragment>
          ))}
        </ul>
      )}
      {paged && (
        <div className="flex items-center justify-end gap-1 text-xs text-foreground-muted">
          <span id={countId} role="status" className="mr-1 tabular-nums">
            {summary}
          </span>
          {matches.length > pageSize && (
            <>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Página anterior"
                disabled={current === 1}
                onClick={() => setPage(current - 1)}
              >
                <ChevronLeft aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Página siguiente"
                disabled={current === pages}
                onClick={() => setPage(current + 1)}
              >
                <ChevronRight aria-hidden="true" />
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
