// Lista unificada de un tipo de comprobante (unify-drafts-into-document-lists, design D2 y D3): los
// borradores ocupan las primeras posiciones y los comprobantes emitidos las siguientes, con un total
// exacto. Solo usa la paginación por página y tamaño de cada lista, así que ningún repositorio cambia:
// la página global coincide con la de borradores, y los emitidos se completan con una o dos páginas.
import { PAGE_SIZE_MAX } from "@facturador/contracts";
import { searchKey } from "../search/search-key.ts";

export type PageSlice<T> = Readonly<{ items: readonly T[]; total: number }>;
export type PageFetcher<T> = (page: number, pageSize: number) => Promise<PageSlice<T>>;
export type Entry<D, E> = { kind: "DRAFT"; draft: D } | { kind: "DOCUMENT"; document: E };

/**
 * Una página con los borradores primero. Sin `drafts` (sin permiso o con un filtro que los excluye),
 * solo emitidos; sin `documents` (el filtro «Borradores»), solo borradores.
 */
export async function draftsFirstPage<D, E>({
  page,
  pageSize,
  drafts,
  documents,
}: {
  page: number;
  pageSize: number;
  drafts: PageFetcher<D> | null;
  documents: PageFetcher<E> | null;
}): Promise<PageSlice<Entry<D, E>>> {
  const draftPart: PageSlice<D> = drafts ? await drafts(page, pageSize) : { items: [], total: 0 };
  const items: Entry<D, E>[] = draftPart.items.map((draft) => ({ kind: "DRAFT", draft }));
  if (!documents) return { items, total: draftPart.total };

  const need = pageSize - items.length;
  if (need <= 0) {
    // La página es toda de borradores: basta una fila de emitidos para conocer su total.
    const { total } = await documents(1, 1);
    return { items, total: draftPart.total + total };
  }
  const offset = Math.max(0, (page - 1) * pageSize - draftPart.total);
  const first = Math.floor(offset / pageSize) + 1;
  const firstPage = await documents(first, pageSize);
  let collected = firstPage.items;
  const skip = offset - (first - 1) * pageSize;
  if (skip + need > pageSize && collected.length === pageSize) {
    collected = [...collected, ...(await documents(first + 1, pageSize)).items];
  }
  for (const document of collected.slice(skip, skip + need)) {
    items.push({ kind: "DOCUMENT", document });
  }
  return { items, total: draftPart.total + firstPage.total };
}

/** Cota de borradores que recorre una búsqueda: los más recientes de su tipo (design D3). */
export const DRAFT_SEARCH_LIMIT = 500;

/**
 * Los borradores que cumplen `matches`, paginados en memoria sobre los `limit` más recientes. Sin
 * filtros, los borradores se paginan en la base con su propia lista.
 */
export function filteredPages<T>(
  load: PageFetcher<T>,
  matches: (item: T) => boolean,
  limit = DRAFT_SEARCH_LIMIT,
): PageFetcher<T> {
  let matching: T[] | null = null;
  return async (page, pageSize) => {
    if (!matching) {
      const loaded: T[] = [];
      for (let next = 1; loaded.length < limit; next++) {
        const { items } = await load(next, PAGE_SIZE_MAX);
        loaded.push(...items);
        if (items.length < PAGE_SIZE_MAX) break;
      }
      matching = loaded.slice(0, limit).filter(matches);
    }
    return {
      items: matching.slice((page - 1) * pageSize, page * pageSize),
      total: matching.length,
    };
  };
}

/** Si alguno de los textos contiene la búsqueda, sin distinguir mayúsculas, minúsculas ni tildes. */
export function textMatches(search: string, ...texts: (string | null | undefined)[]): boolean {
  const needle = searchKey(search);
  return texts.some((text) => text != null && searchKey(text).includes(needle));
}

/**
 * La página unificada de un tipo: los borradores, filtrados en memoria si hay búsqueda o un filtro
 * que también les aplica, y después los emitidos.
 */
export function unifiedPage<D, E>({
  page,
  pageSize,
  drafts,
  documents,
  draftFilter,
}: {
  page: number;
  pageSize: number;
  drafts: PageFetcher<D> | null;
  documents: PageFetcher<E> | null;
  /** El filtro de búsqueda o de un campo propio, o `null` si los borradores se paginan en la base. */
  draftFilter: ((draft: D) => boolean) | null;
}): Promise<PageSlice<Entry<D, E>>> {
  const draftPages = drafts && draftFilter ? filteredPages(drafts, draftFilter) : drafts;
  return draftsFirstPage({ page, pageSize, drafts: draftPages, documents });
}
