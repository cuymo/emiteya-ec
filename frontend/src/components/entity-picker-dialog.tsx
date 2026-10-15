// EntityPickerDialog (component-system.md): selección de un registro relacionado con búsqueda,
// resultados paginados por el servidor, selección por teclado y una opción rápida configurable. No
// conoce ningún tipo de entidad: el llamador aporta cómo cargar una página y cómo mostrar un ítem.
"use client";

import { keepPreviousData, useQuery, type QueryKey } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { EmptyState, ErrorState, Skeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type EntityPage<T> = { items: T[]; total: number };

export type EntityPickerQuery = {
  search: string;
  page: number;
  pageSize: number;
  signal: AbortSignal;
};

/** Opción fija antes de los resultados, como "Consumidor final". */
export type QuickOption = { label: string; description?: string; onSelect: () => void };

const SEARCH_DELAY_MS = 300;

export function EntityPickerDialog<T>({
  open,
  onOpenChange,
  title,
  description,
  searchLabel,
  searchPlaceholder,
  queryKey,
  fetchPage,
  pageSize = 10,
  getKey,
  getLabel,
  renderItem,
  onSelect,
  isDisabled,
  quickOption,
  emptyTitle,
  emptyDescription,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  searchLabel: string;
  searchPlaceholder?: string;
  /** Prefijo de la consulta en caché; la búsqueda y la página se añaden aquí. */
  queryKey: QueryKey;
  fetchPage: (query: EntityPickerQuery) => Promise<EntityPage<T>>;
  pageSize?: number;
  getKey: (item: T) => string;
  /** Nombre accesible de la opción. */
  getLabel: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  /** Devuelve el registro elegido; el diálogo se cierra. */
  onSelect: (item: T) => void;
  /**
   * Un registro visible que no se puede elegir (por ejemplo, un transportista cuya identificación no
   * cabe en la guía); `renderItem` muestra el motivo.
   */
  isDisabled?: (item: T) => boolean;
  quickOption?: QuickOption;
  emptyTitle: string;
  emptyDescription?: string;
  /**
   * Al cerrarse, quién recibe el foco: por defecto, el control que abrió el diálogo. El editor de
   * facturas lo lleva a la cantidad de la línea nueva (productize-invoice-editor-and-composition-
   * foundation, design D13).
   */
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const listboxId = useId();
  const optionId = (index: number) => `${listboxId}-option-${index}`;
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (draft.trim() === search) return;
    const timer = setTimeout(() => {
      setSearch(draft.trim());
      setPage(1);
      setActive(0);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draft, search]);

  const results = useQuery({
    queryKey: [...queryKey, "picker", { search, page, pageSize }],
    enabled: open,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => fetchPage({ search, page, pageSize, signal }),
  });

  const items = results.data?.items ?? [];
  const total = results.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  // La opción rápida solo acompaña a la primera página sin búsqueda, ni escrita ni aplicada.
  const pending = draft.trim() !== search;
  const showQuick = quickOption !== undefined && search === "" && !pending && page === 1;
  const options: {
    key: string;
    label: string;
    select: () => void;
    content: ReactNode;
    disabled?: boolean;
  }[] = [
    ...(showQuick
      ? [
          {
            key: "quick",
            label: quickOption.label,
            select: quickOption.onSelect,
            content: (
              <span className="flex flex-col">
                <span className="font-medium">{quickOption.label}</span>
                {quickOption.description && (
                  <span className="text-sm text-foreground-muted">{quickOption.description}</span>
                )}
              </span>
            ),
          },
        ]
      : []),
    ...items.map((item) => ({
      key: getKey(item),
      label: getLabel(item),
      select: () => onSelect(item),
      content: renderItem(item),
      disabled: isDisabled?.(item) ?? false,
    })),
  ];
  const activeIndex = Math.min(active, Math.max(0, options.length - 1));

  function close(next: boolean) {
    if (!next) {
      setDraft("");
      setSearch("");
      setPage(1);
      setActive(0);
    }
    onOpenChange(next);
  }

  function choose(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    option.select();
    close(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      // Con una búsqueda escrita y aún sin aplicar, Enter la aplica en lugar de elegir un
      // resultado anterior a ella.
      if (pending) {
        setSearch(draft.trim());
        setPage(1);
        setActive(0);
        return;
      }
      choose(activeIndex);
      return;
    }
    if (options.length === 0) return;
    const move = (index: number) => {
      event.preventDefault();
      setActive(index);
      document.getElementById(optionId(index))?.scrollIntoView({ block: "nearest" });
    };
    if (event.key === "ArrowDown") move((activeIndex + 1) % options.length);
    else if (event.key === "ArrowUp") move((activeIndex - 1 + options.length) % options.length);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(options.length - 1);
  }

  const goTo = (next: number) => {
    setPage(next);
    setActive(0);
  };

  let body: ReactNode;
  if (results.isPending) {
    body = (
      <div aria-hidden="true" className="flex flex-col gap-2 p-2">
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} className="h-11 w-full" />
        ))}
      </div>
    );
  } else if (results.isError) {
    body = (
      <ErrorState
        message="No pudimos cargar los resultados."
        onRetry={() => void results.refetch()}
      />
    );
  } else if (options.length === 0) {
    body = search ? (
      <EmptyState
        kind="no-matches"
        title="No hay resultados que coincidan"
        description="Prueba con otra búsqueda."
      />
    ) : (
      <EmptyState
        kind="empty"
        title={emptyTitle}
        {...(emptyDescription ? { description: emptyDescription } : {})}
      />
    );
  } else {
    body = (
      <ul
        ref={listRef}
        id={listboxId}
        role="listbox"
        aria-label={title}
        className="flex flex-col gap-1 p-1"
      >
        {options.map((option, index) => (
          <li
            key={option.key}
            id={optionId(index)}
            role="option"
            aria-selected={index === activeIndex}
            aria-disabled={option.disabled || undefined}
            aria-label={option.label}
            onMouseEnter={() => setActive(index)}
            onClick={() => choose(index)}
            className={cn(
              "flex min-h-11 cursor-pointer items-center rounded-md px-2 py-1 text-sm",
              option.disabled && "cursor-not-allowed text-foreground-muted",
              index === activeIndex
                ? "bg-surface-subtle ring-1 ring-primary"
                : "hover:bg-surface-subtle",
            )}
          >
            {option.content}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        className="max-w-lg"
        {...(onCloseAutoFocus ? { onCloseAutoFocus } : {})}
        {...(description ? {} : { "aria-describedby": undefined })}
      >
        <div className="flex flex-col gap-1 px-6 pt-6 pr-14">
          <DialogTitle className="text-lg font-semibold">{title}</DialogTitle>
          {description && (
            <DialogDescription className="text-sm text-foreground-muted">
              {description}
            </DialogDescription>
          )}
        </div>
        <div className="px-6 pt-4">
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-foreground-muted"
            />
            <Input
              type="search"
              role="combobox"
              aria-label={searchLabel}
              aria-controls={listboxId}
              aria-expanded={options.length > 0}
              aria-autocomplete="list"
              {...(options.length > 0 ? { "aria-activedescendant": optionId(activeIndex) } : {})}
              value={draft}
              placeholder={searchPlaceholder}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
              className="pl-8"
            />
          </div>
        </div>
        <div className="min-h-48 flex-1 overflow-y-auto px-4 py-2" aria-busy={results.isFetching}>
          {body}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-border px-6 py-3 text-sm text-foreground-muted">
          <p aria-live="polite">
            {total > 0
              ? `Página ${page} de ${pages} · ${total.toLocaleString("es-EC")} resultados`
              : " "}
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="legacy-icon-sm"
              className="max-md:size-11"
              aria-label="Página anterior"
              disabled={page <= 1}
              onClick={() => goTo(page - 1)}
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="legacy-icon-sm"
              className="max-md:size-11"
              aria-label="Página siguiente"
              disabled={page >= pages}
              onClick={() => goTo(page + 1)}
            >
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
