// Definición de una ruta de la API para documentarla en OpenAPI.
import type { z } from "zod";

export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

export type RouteDefinition = {
  method: HttpMethod;
  /** Ruta relativa al prefijo de versión `/api/v1` (ADR 0015), con parámetros `:nombre`. */
  path: string;
  summary: string;
  request?: {
    params?: z.ZodObject;
    query?: z.ZodObject;
    /** Cabeceras propias, como `Idempotency-Key` de la emisión (add-invoice-emission, D8). */
    headers?: z.ZodObject;
    body?: z.ZodType;
    /** Cuerpo binario, como el logo (add-taxpayer-setup, design D5), con sus tipos admitidos. */
    binaryBody?: { contentTypes: readonly string[] };
  };
  responses: Record<
    number,
    { description: string; schema?: z.ZodType; binaryContentTypes?: readonly string[] }
  >;
};

export function defineRoute(route: RouteDefinition): RouteDefinition {
  return route;
}
