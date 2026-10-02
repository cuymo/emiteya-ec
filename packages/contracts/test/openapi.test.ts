import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  apiRoutes,
  buildOpenApiDocument,
  defineRoute,
  successEnvelope,
} from "@facturador/contracts";

const info = { title: "Prueba", version: "0.0.0" };

type JsonContent = Record<string, { schema: { properties: Record<string, unknown> } } | undefined>;
type Operation = {
  parameters: unknown[];
  requestBody: { content: JsonContent };
  responses: Record<string, { content: JsonContent } | undefined>;
};

describe("generación de OpenAPI", () => {
  it("documenta una ruta registrada con parámetros, cuerpo y respuestas", () => {
    const route = defineRoute({
      method: "put",
      path: "/examples/:exampleId",
      summary: "Actualizar un ejemplo",
      request: {
        params: z.object({ exampleId: z.string() }),
        query: z.object({ dryRun: z.boolean().optional() }),
        body: z.object({ name: z.string().min(1) }),
      },
      responses: {
        200: { description: "Actualizado", schema: successEnvelope(z.object({ id: z.string() })) },
      },
    });
    const document = buildOpenApiDocument([route], info);
    const operation = document.paths["/examples/{exampleId}"]?.put as Operation;

    expect(document.openapi).toBe("3.1.0");
    expect(document.servers).toEqual([{ url: "/api/v1" }]);
    expect(operation.parameters).toEqual([
      expect.objectContaining({ name: "exampleId", in: "path", required: true }),
      expect.objectContaining({ name: "dryRun", in: "query", required: false }),
    ]);
    expect(operation.requestBody.content["application/json"]?.schema.properties.name).toMatchObject(
      {
        type: "string",
      },
    );
    expect(
      operation.responses["200"]?.content["application/json"]?.schema.properties,
    ).toHaveProperty("data");
  });

  it("con el registro real vacío, el documento no tiene rutas", () => {
    expect(apiRoutes).toHaveLength(0);
    expect(buildOpenApiDocument(apiRoutes, info).paths).toEqual({});
  });
});
