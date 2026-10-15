// Estado de una lista en la dirección (productize-invoice-list-and-shared-table-foundation, design
// D9; data-tables.md, «Filters And URL State»). La búsqueda, los filtros, la página y las filas por
// página viven en la URL: recargar, compartir el enlace o volver desde un registro conserva la lista.
// - Los cambios se acumulan sobre el último pedido y no sobre los parámetros de la última
//   representación: dos cambios seguidos se aplican los dos aunque el primero todavía no haya llegado
//   a la URL (la carrera registrada en technical-debt.md, corregida antes solo en el archivo).
// - Cambiar un filtro vuelve a la primera página.
// - Los alias de enlaces antiguos se normalizan una vez, con `replace`.
// - Una página posterior a la última pasa a la última con datos.
// El hook entrega valores en bruto: cada pantalla valida los suyos y cae a su valor por defecto.
"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import { PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX } from "@facturador/contracts";

const PAGE = "pagina";
const PAGE_SIZE = "filas";

export type ListUrlState = {
  /** El valor en bruto de un parámetro, o `""` si no está. */
  get: (key: string) => string;
  page: number;
  pageSize: number;
  /** Aplica cambios; `null` o `""` quitan el parámetro. Vuelve a la página 1 salvo `keepPage`. */
  update: (changes: Record<string, string | null>, options?: { keepPage?: boolean }) => void;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  /** Con el total de la respuesta, corrige una página posterior a la última. */
  clampPage: (total: number) => void;
};

export function useListUrlState(
  options: {
    /** Reescribe en el sitio los parámetros de enlaces antiguos; devuelve si cambió algo. */
    normalize?: (params: URLSearchParams) => boolean;
  } = {},
): ListUrlState {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const current = params.toString();
  // La última consulta pedida, mientras la URL todavía no la refleja.
  const requested = useRef<string | null>(null);
  useEffect(() => {
    if (requested.current === current) requested.current = null;
  }, [current]);

  const navigate = useCallback(
    (next: URLSearchParams) => {
      const query = next.toString();
      requested.current = query;
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  const update = useCallback(
    (changes: Record<string, string | null>, { keepPage = false } = {}) => {
      const next = new URLSearchParams(requested.current ?? current);
      for (const [key, change] of Object.entries(changes)) {
        if (change === null || change === "") next.delete(key);
        else next.set(key, change);
      }
      if (!keepPage) next.delete(PAGE);
      navigate(next);
    },
    [current, navigate],
  );

  const { normalize } = options;
  useEffect(() => {
    if (!normalize) return;
    const next = new URLSearchParams(current);
    if (normalize(next)) navigate(next);
  }, [current, navigate, normalize]);

  const page = Math.max(1, Number.parseInt(params.get(PAGE) ?? "1", 10) || 1);
  const sizeParam = Number.parseInt(params.get(PAGE_SIZE) ?? "", 10);
  const pageSize = sizeParam >= 1 && sizeParam <= PAGE_SIZE_MAX ? sizeParam : PAGE_SIZE_DEFAULT;

  const clampPage = useCallback(
    (total: number) => {
      const last = Math.max(1, Math.ceil(total / pageSize));
      if (page > last) update({ [PAGE]: last > 1 ? String(last) : null }, { keepPage: true });
    },
    [page, pageSize, update],
  );

  return {
    get: (key) => params.get(key) ?? "",
    page,
    pageSize,
    update,
    setPage: (next) => update({ [PAGE]: next > 1 ? String(next) : null }, { keepPage: true }),
    setPageSize: (next) =>
      update({ [PAGE_SIZE]: next === PAGE_SIZE_DEFAULT ? null : String(next) }),
    clampPage,
  };
}
