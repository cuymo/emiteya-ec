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

  it("documenta las cabeceras propias como parámetros", () => {
    const route = defineRoute({
      method: "post",
      path: "/examples",
      summary: "Crear con clave",
      request: { headers: z.object({ "Idempotency-Key": z.string().min(1) }) },
      responses: { 201: { description: "Creado" } },
    });
    const operation = buildOpenApiDocument([route], info).paths["/examples"]?.post as Operation;
    expect(operation.parameters).toEqual([
      expect.objectContaining({ name: "Idempotency-Key", in: "header", required: true }),
    ]);
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
      "/company/status",
      "/credit-notes",
      "/credit-notes/drafts",
      "/credit-notes/drafts/{draftId}",
      "/credit-notes/eligible-invoices",
      "/credit-notes/invoices/{invoiceId}/credit",
      "/credit-notes/{creditNoteId}",
      "/credit-notes/{creditNoteId}/reconciliations",
      "/credit-notes/{creditNoteId}/signing-attempts",
      "/credit-notes/{creditNoteId}/transmission",
      "/debit-notes",
      "/debit-notes/drafts",
      "/debit-notes/drafts/{draftId}",
      "/debit-notes/eligible-invoices",
      "/debit-notes/{debitNoteId}",
      "/debit-notes/{debitNoteId}/reconciliations",
      "/debit-notes/{debitNoteId}/signing-attempts",
      "/debit-notes/{debitNoteId}/transmission",
      "/documents",
      "/documents/{documentId}",
      "/documents/{documentId}/authorized-xml",
      "/documents/{documentId}/deliveries",
      "/documents/{documentId}/print-requests",
      "/documents/{documentId}/ride",
      "/documents/{documentId}/ride-attempts",
      "/documents/{documentId}/signed-xml",
      "/establishments",
      "/establishments/{establishmentId}",
      "/establishments/{establishmentId}/emission-points",
      "/establishments/{establishmentId}/emission-points/{emissionPointId}/sequences/{environment}/{documentType}",
      "/establishments/{establishmentId}/emission-points/{emissionPointId}/status",
      "/establishments/{establishmentId}/status",
      "/fiscal-catalogs",
      "/fiscal-catalogs/consumer-final-policy",
      "/fiscal-catalogs/schemas",
      "/fiscal-catalogs/special-cases",
      "/fiscal-catalogs/sri-transmission-policy",
      "/fiscal-catalogs/{catalogType}/entries",
      "/fiscal-catalogs/{catalogType}/entries/{entryKey}/enablement",
      "/fiscal-sequences",
      "/inventory/items",
      "/inventory/items/{productId}",
      "/inventory/items/{productId}/adjustments",
      "/inventory/items/{productId}/entries",
      "/inventory/items/{productId}/initialization",
      "/inventory/items/{productId}/movements",
      "/inventory/items/{productId}/tracking",
      "/invoices",
      "/invoices/drafts",
      "/invoices/drafts/{draftId}",
      "/invoices/{invoiceId}",
      "/invoices/{invoiceId}/reconciliations",
      "/invoices/{invoiceId}/signing-attempts",
      "/invoices/{invoiceId}/transmission",
      "/me",
      "/me/default-emission-point",
      "/parties",
      "/parties/{partyId}",
      "/parties/{partyId}/status",
      "/products",
      "/products/tax-summary",
      "/products/{productId}",
      "/products/{productId}/status",
      "/signing-certificate",
      "/signing-certificate/expiry-alert",
      "/signing-certificate/validity",
      "/taxpayer",
      "/taxpayer/environment",
      "/taxpayer/logo",
      "/users",
      "/users/{userId}/password",
      "/users/{userId}/role",
      "/users/{userId}/status",
    ]);
    expect(Object.keys(paths["/users"] ?? {}).sort()).toEqual(["get", "post"]);
    // El RIDE solo se lee con GET; imprimir es una solicitud explícita con POST, sin bytes.
    expect(Object.keys(paths["/documents/{documentId}/ride"] ?? {})).toEqual(["get"]);
    expect(Object.keys(paths["/documents/{documentId}/print-requests"] ?? {})).toEqual(["post"]);
    const ride = paths["/documents/{documentId}/ride"]?.get as {
      responses: Record<string, { content?: Record<string, unknown> }>;
    };
    expect(Object.keys(ride.responses["200"]?.content ?? {})).toEqual(["application/pdf"]);
    // Ningún cuerpo de escritura documenta companyId: los esquemas son estrictos.
    expect(JSON.stringify(paths)).not.toContain("companyId");
  });
});
