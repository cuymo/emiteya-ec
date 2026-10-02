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

  it("documenta cuerpos y respuestas binarios", () => {
    const route = defineRoute({
      method: "put",
      path: "/files",
      summary: "Subir un archivo",
      request: { binaryBody: { contentTypes: ["image/png"] } },
      responses: { 200: { description: "El archivo", binaryContentTypes: ["image/png"] } },
    });
    const operation = buildOpenApiDocument([route], info).paths["/files"]?.put as {
      requestBody: { content: Record<string, unknown> };
      responses: Record<string, { content: Record<string, unknown> }>;
    };
    const binary = { schema: { type: "string", format: "binary" } };
    expect(operation.requestBody.content).toEqual({ "image/png": binary });
    expect(operation.responses["200"]?.content).toEqual({ "image/png": binary });
  });

  it("el registro real documenta la cuenta, los usuarios y la configuración tributaria", () => {
    const paths = buildOpenApiDocument(apiRoutes, info).paths;
    expect(Object.keys(paths).sort()).toEqual([
      "/establishments",
      "/establishments/{establishmentId}",
      "/establishments/{establishmentId}/emission-points",
      "/establishments/{establishmentId}/emission-points/{emissionPointId}/status",
      "/establishments/{establishmentId}/status",
      "/me",
      "/taxpayer",
      "/taxpayer/environment",
      "/taxpayer/logo",
      "/users",
      "/users/{userId}/password",
      "/users/{userId}/role",
      "/users/{userId}/status",
    ]);
    expect(Object.keys(paths["/users"] ?? {}).sort()).toEqual(["get", "post"]);
    // Ningún cuerpo de escritura documenta companyId: los esquemas son estrictos.
    expect(JSON.stringify(paths)).not.toContain("companyId");
  });
});
