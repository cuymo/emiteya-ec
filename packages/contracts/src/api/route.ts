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
    body?: z.ZodType;
  };
  responses: Record<number, { description: string; schema?: z.ZodType }>;
};

export function defineRoute(route: RouteDefinition): RouteDefinition {
  return route;
}
