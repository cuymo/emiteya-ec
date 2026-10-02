import { Router } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { errorEnvelopeSchema } from "@facturador/contracts";
import { buildTestApp } from "./helpers.ts";

describe("createApp", () => {
  it("una ruta inexistente responde 404 con el sobre de error", async () => {
    const { app } = buildTestApp();
    const res = await request(app).get("/api/v1/no-existe");
    expect(res.status).toBe(404);
    expect(errorEnvelopeSchema.parse(res.body).error).toMatchObject({
      code: "ROUTE_NOT_FOUND",
      requestId: res.headers["x-request-id"],
    });
  });

  it("un error desconocido responde 500 sin stack ni detalle interno, y el log conserva el detalle y el requestId", async () => {
    const router = Router();
    router.get("/falla", () => {
      throw new Error("detalle interno sensible");
    });
    const { app, logs } = buildTestApp({ apiRouter: router });
    const res = await request(app).get("/api/v1/falla").set("x-request-id", "falla-000001");

    expect(res.status).toBe(500);
    expect(errorEnvelopeSchema.parse(res.body).error).toEqual({
      code: "INTERNAL_ERROR",
      message: "Ocurrió un error interno. Intenta de nuevo más tarde.",
      requestId: "falla-000001",
    });
    expect(JSON.stringify(res.body)).not.toContain("detalle interno sensible");
    expect(logs()).toContain("detalle interno sensible");
    expect(logs()).toContain('"id":"falla-000001"');
  });

  it("un cuerpo mayor al límite responde 413 con el sobre", async () => {
    const { app } = buildTestApp();
    const res = await request(app)
      .post("/api/v1/cualquiera")
      .set("content-type", "application/json")
      .send(JSON.stringify({ relleno: "x".repeat(110 * 1024) }));
    expect(res.status).toBe(413);
    expect(errorEnvelopeSchema.parse(res.body).error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("un JSON inválido responde 400 con el sobre", async () => {
    const { app } = buildTestApp();
    const res = await request(app)
      .post("/api/v1/cualquiera")
      .set("content-type", "application/json")
      .send("{mal");
    expect(res.status).toBe(400);
    expect(errorEnvelopeSchema.parse(res.body).error.code).toBe("INVALID_JSON");
  });

  it("incluye las cabeceras de seguridad de helmet y no expone x-powered-by", async () => {
    const { app } = buildTestApp();
    const res = await request(app).get("/health/live");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toBeDefined();
    expect(res.headers["strict-transport-security"]).toBeDefined();
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});
