import { Router } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildTestApp } from "./helpers.ts";

describe("correlación y logs", () => {
  it("devuelve x-request-id y conserva un identificador entrante válido", async () => {
    const { app } = buildTestApp();
    const generated = await request(app).get("/health/live");
    expect(generated.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);

    const kept = await request(app).get("/health/live").set("x-request-id", "cliente-1234-abcd");
    expect(kept.headers["x-request-id"]).toBe("cliente-1234-abcd");

    const replaced = await request(app).get("/health/live").set("x-request-id", "no valido!");
    expect(replaced.headers["x-request-id"]).not.toBe("no valido!");
  });

  it("no registra authorization, cookie ni campos password, y cada línea lleva el identificador", async () => {
    const router = Router();
    router.post("/echo", (req, res) => {
      req.log.info({ password: "clave-en-log", token: "token-en-log" }, "intento");
      res.json({ data: { ok: true } });
    });
    const { app, logs } = buildTestApp({ apiRouter: router });
    await request(app)
      .post("/api/v1/echo")
      .set("authorization", "Bearer token-de-cabecera")
      .set("cookie", "session=cookie-secreta")
      .set("x-request-id", "correlacion-0001")
      .send({ password: "clave-del-cuerpo" });

    const output = logs();
    for (const secret of [
      "token-de-cabecera",
      "cookie-secreta",
      "clave-en-log",
      "token-en-log",
      "clave-del-cuerpo",
    ]) {
      expect(output).not.toContain(secret);
    }
    expect(output).toContain("[REDACTED]");
    expect(output).toContain(
      '"req":{"id":"correlacion-0001","method":"POST","url":"/api/v1/echo"}',
    );
    expect(output).not.toContain("127.0.0.1");
  });
});
