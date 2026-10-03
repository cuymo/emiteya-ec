// Contrato común de búsqueda y paginación de terceros y productos (add-parties-and-products, design
// D10). Las consultas no son estrictas: un `companyId` en la consulta se ignora. La lista de
// usuarios conserva su propio esquema; adoptarlo es otro cambio.
import { z } from "zod";

export const PAGE_SIZE_DEFAULT = 25;
export const PAGE_SIZE_MAX = 100;
export const SEARCH_MAX_LENGTH = 100;

/** Texto buscado: recortado y opcional. */
export const searchParam = z
  .string()
  .trim()
  .max(SEARCH_MAX_LENGTH, `La búsqueda debe tener como máximo ${SEARCH_MAX_LENGTH} caracteres.`)
  .optional();

/** Página desde 1 y tamaño de 1 a 100, con coerción desde la consulta. */
export const pageParams = {
  page: z.coerce.number({ error: "La página no es válida." }).int().min(1).default(1),
  pageSize: z.coerce
    .number({ error: "El tamaño de página no es válido." })
    .int()
    .min(1, "El tamaño de página no es válido.")
    .max(PAGE_SIZE_MAX, `El tamaño de página debe ser como máximo ${PAGE_SIZE_MAX}.`)
    .default(PAGE_SIZE_DEFAULT),
};

export const SORT_DIRECTIONS = ["asc", "desc"] as const;
export const sortDirectionSchema = z
  .enum(SORT_DIRECTIONS, { error: "La dirección del orden no es válida." })
  .default("asc");
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

/** Estado de un registro que se desactiva en lugar de borrarse. */
export const RECORD_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export const recordStatusSchema = z.enum(RECORD_STATUSES, { error: "El estado no es válido." });
export type RecordStatus = z.infer<typeof recordStatusSchema>;

/** Filtro de estado de las listas: activos por defecto. */
export const recordStatusFilterSchema = z
  .enum([...RECORD_STATUSES, "ALL"], { error: "El estado no es válido." })
  .default("ACTIVE");

export const listMetaSchema = z.strictObject({
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});
export type ListMeta = z.infer<typeof listMetaSchema>;
