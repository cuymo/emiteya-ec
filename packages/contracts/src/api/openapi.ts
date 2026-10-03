// Construye un documento OpenAPI 3.1 desde el registro de rutas, con la conversión nativa de Zod 4.
import { z } from "zod";
import type { RouteDefinition } from "./route.ts";

export const API_VERSION_PREFIX = "/api/v1";

type JsonSchema = z.core.JSONSchema.BaseSchema;
type Location = "path" | "query" | "header";
type Parameter = { name: string; in: Location; required: boolean; schema: JsonSchema };

const toSchema = (schema: z.ZodType): JsonSchema => z.toJSONSchema(schema, { io: "input" });

const binaryContent = (contentTypes: readonly string[]) =>
  Object.fromEntries(
    contentTypes.map((type) => [type, { schema: { type: "string", format: "binary" } }]),
  );

function toOpenApiPath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function parameters(location: Location, schema: z.ZodObject | undefined): Parameter[] {
  if (!schema) return [];
  return Object.entries(schema.shape).map(([name, field]) => ({
    name,
    in: location,
    required: location === "path" || !(field as z.ZodType).safeParse(undefined).success,
    schema: toSchema(field as z.ZodType),
  }));
}

export function buildOpenApiDocument(
  routes: readonly RouteDefinition[],
  info: { title: string; version: string },
) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of routes) {
    const params = [
      ...parameters("path", route.request?.params),
      ...parameters("query", route.request?.query),
      ...parameters("header", route.request?.headers),
    ];
    const operation: Record<string, unknown> = {
      summary: route.summary,
      ...(params.length > 0 ? { parameters: params } : {}),
      ...(route.request?.body
        ? {
            requestBody: {
              required: true,
              content: { "application/json": { schema: toSchema(route.request.body) } },
            },
          }
        : {}),
      ...(route.request?.binaryBody
        ? {
            requestBody: {
              required: true,
              content: binaryContent(route.request.binaryBody.contentTypes),
            },
          }
        : {}),
      responses: Object.fromEntries(
        Object.entries(route.responses).map(([status, response]) => [
          status,
          {
            description: response.description,
            ...(response.schema
              ? { content: { "application/json": { schema: toSchema(response.schema) } } }
              : {}),
            ...(response.binaryContentTypes
              ? { content: binaryContent(response.binaryContentTypes) }
              : {}),
          },
        ]),
      ),
    };
    const key = toOpenApiPath(route.path);
    paths[key] = { ...paths[key], [route.method]: operation };
  }
  return { openapi: "3.1.0", info, servers: [{ url: API_VERSION_PREFIX }], paths };
}
