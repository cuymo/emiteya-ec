// Paginación de la lista unificada (unify-drafts-into-document-lists, design D2 y D3).
import { describe, expect, it } from "vitest";
import {
  draftsFirstPage,
  filteredPages,
  textMatches,
  type Entry,
  type PageFetcher,
} from "../../src/platform/pagination/drafts-first.ts";

/** Una lista paginada sobre un arreglo, que cuenta las consultas. */
function source(prefix: string, count: number) {
  const all = Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`);
  const calls: [number, number][] = [];
  const fetch: PageFetcher<string> = (page, pageSize) => {
    calls.push([page, pageSize]);
    return Promise.resolve({
      items: all.slice((page - 1) * pageSize, page * pageSize),
      total: all.length,
    });
  };
  return { fetch, calls };
}

const ids = (items: readonly Entry<string, string>[]) =>
  items.map((item) => (item.kind === "DRAFT" ? item.draft : item.document));

describe("draftsFirstPage", () => {
  it("la primera página pone los borradores primero y completa con emitidos", async () => {
    const drafts = source("b", 2);
    const documents = source("d", 30);
    const page = await draftsFirstPage({
      page: 1,
      pageSize: 5,
      drafts: drafts.fetch,
      documents: documents.fetch,
    });
    expect(ids(page.items)).toEqual(["b1", "b2", "d1", "d2", "d3"]);
    expect(page.items[0]!.kind).toBe("DRAFT");
    expect(page.items[2]!.kind).toBe("DOCUMENT");
    expect(page.total).toBe(32);
  });

  it("una página de solo emitidos con un desfase pide dos páginas y corta", async () => {
    const drafts = source("b", 2);
    const documents = source("d", 30);
    const page = await draftsFirstPage({
      page: 2,
      pageSize: 5,
      drafts: drafts.fetch,
      documents: documents.fetch,
    });
    // Posiciones 6 a 10: emitidos 4 a 8 (desfase 3), en las páginas 1 y 2 de emitidos.
    expect(ids(page.items)).toEqual(["d4", "d5", "d6", "d7", "d8"]);
    expect(documents.calls).toEqual([
      [1, 5],
      [2, 5],
    ]);
    expect(page.total).toBe(32);
  });

  it("una página llena de borradores consulta una sola fila de emitidos para el total", async () => {
    const drafts = source("b", 12);
    const documents = source("d", 3);
    const page = await draftsFirstPage({
      page: 2,
      pageSize: 5,
      drafts: drafts.fetch,
      documents: documents.fetch,
    });
    expect(ids(page.items)).toEqual(["b6", "b7", "b8", "b9", "b10"]);
    expect(documents.calls).toEqual([[1, 1]]);
    expect(page.total).toBe(15);
  });

  it("la última página mezcla los borradores que quedan con los primeros emitidos", async () => {
    const page = await draftsFirstPage({
      page: 3,
      pageSize: 5,
      drafts: source("b", 12).fetch,
      documents: source("d", 3).fetch,
    });
    expect(ids(page.items)).toEqual(["b11", "b12", "d1", "d2", "d3"]);
    expect(page.total).toBe(15);
  });

  it("sin borradores es la lista de emitidos, y sin emitidos la de borradores", async () => {
    const onlyDocuments = await draftsFirstPage<string, string>({
      page: 1,
      pageSize: 3,
      drafts: null,
      documents: source("d", 4).fetch,
    });
    expect(ids(onlyDocuments.items)).toEqual(["d1", "d2", "d3"]);
    expect(onlyDocuments.total).toBe(4);
    const onlyDrafts = await draftsFirstPage<string, string>({
      page: 2,
      pageSize: 3,
      drafts: source("b", 4).fetch,
      documents: null,
    });
    expect(ids(onlyDrafts.items)).toEqual(["b4"]);
    expect(onlyDrafts.total).toBe(4);
  });

  it("más allá del final no devuelve filas y conserva el total", async () => {
    const page = await draftsFirstPage({
      page: 9,
      pageSize: 5,
      drafts: source("b", 2).fetch,
      documents: source("d", 3).fetch,
    });
    expect(page.items).toEqual([]);
    expect(page.total).toBe(5);
  });
});

describe("filteredPages", () => {
  it("filtra y pagina en memoria sobre los más recientes, hasta la cota", async () => {
    const drafts = source("b", 250);
    const even = filteredPages(drafts.fetch, (id) => Number(id.slice(1)) % 2 === 0, 200);
    const first = await even(1, 3);
    expect(first.items).toEqual(["b2", "b4", "b6"]);
    expect(first.total).toBe(100);
    // La carga se hace una vez, en páginas de 100 hasta la cota.
    await even(2, 3);
    expect(drafts.calls).toEqual([
      [1, 100],
      [2, 100],
    ]);
  });

  it("compara sin mayúsculas, minúsculas ni tildes", () => {
    expect(textMatches("maria", "MARÍA ORTIZ")).toBe(true);
    expect(textMatches("001-001", null, "Factura 001-001-000000004")).toBe(true);
    expect(textMatches("pedro", "María", undefined)).toBe(false);
  });
});
