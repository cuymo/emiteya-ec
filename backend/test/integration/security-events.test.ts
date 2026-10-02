// Eventos de seguridad y métricas (design D13): sin secretos en los logs y con la IP según la
// configuración de proxies de confianza.
import { Router } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuthorizer } from "../../src/modules/identity/application/authorization.ts";
import { contextOf } from "../../src/modules/identity/infrastructure/http/request-context.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertCompany } from "./fixtures.ts";
import {
  BASE_URL,
  PASSWORD,
  buildAuthApp,
  createMember,
  eventually,
  signIn,
} from "./auth-harness.ts";

describe("eventos de seguridad", () => {
  let db: MigratedSchema;
  let companyId: string;
  const operator = "operador.secreto@eventos.ec";

  beforeAll(async () => {
    db = await createMigratedSchema("security_events");
    companyId = await insertCompany(db.database.prisma, "Empresa");
    const { uow } = buildAuthApp(db);
    await createMember(uow, companyId, { name: "Operador", email: operator });
  });

  afterAll(async () => {
    await db.drop();
  });

  function appWithDenial(trustProxy: number | false = false) {
    return buildAuthApp(db, {
      trustProxy,
      apiRouter: ({ context, memberships, securityEvents }) => {
        const authorizer = createAuthorizer({ memberships, securityEvents });
        return Router()
          .use(context)
          .get("/probe/users", (_req, res) => {
            authorizer.requirePermission(contextOf(res), "users.read");
            res.json({ data: [] });
          });
      },
    });
  }

  it("un inicio de sesión fallido queda en el log sin contraseña ni correo, con su categoría y la IP del socket", async () => {
    const harness = appWithDenial(false);
    const wrongPassword = "contrasena-que-no-debe-aparecer";
    const res = await signIn(harness.app, operator, wrongPassword, {
      "X-Forwarded-For": "203.0.113.50",
    });
    expect(res.status).toBe(401);
    await signIn(harness.app, "inexistente.secreto@eventos.ec", wrongPassword);
    await eventually(() => harness.events.filter((e) => e.type === "sign_in_failed").length === 2);

    const logs = harness.logs();
    expect(logs).toContain('"event":"sign_in_failed"');
    expect(logs).toContain('"reason":"invalid_credentials"');
    expect(logs).toContain('"reason":"unknown_account"');
    expect(logs).not.toContain(wrongPassword);
    expect(logs).not.toContain(operator);
    expect(logs).not.toContain("inexistente.secreto");
    // Cliente directo sin proxies de confianza: la cabecera no cambia la IP registrada.
    expect(logs).not.toContain("203.0.113.50");
    const failure = harness.events.find((e) => e.type === "sign_in_failed");
    expect(failure && "ip" in failure ? failure.ip : null).toMatch(/127\.0\.0\.1$/);
    const metrics = await harness.metrics.registry.metrics();
    expect(metrics).toMatch(/auth_sign_in_failures_total\{reason="invalid_credentials"\} 1/);
    expect(metrics).toMatch(/auth_sign_in_failures_total\{reason="unknown_account"\} 1/);
  });

  it("detrás de un proxy de confianza se registra la IP que informa el proxy", async () => {
    const harness = appWithDenial(1);
    await signIn(harness.app, operator, "contrasena-incorrecta", {
      "X-Forwarded-For": "198.51.100.23",
    });
    await eventually(() => harness.events.some((e) => e.type === "sign_in_failed"));
    const failure = harness.events.find((e) => e.type === "sign_in_failed");
    expect(failure && "ip" in failure ? failure.ip : null).toBe("198.51.100.23");
  });

  it("una denegación queda en el log y en las métricas sin tokens, cookies ni correo", async () => {
    const harness = appWithDenial();
    const { cookie } = await signIn(harness.app, operator, PASSWORD);
    const token = decodeURIComponent(cookie.split("=")[1] ?? "");
    const res = await request(harness.app)
      .get("/api/v1/probe/users")
      .set("Cookie", cookie)
      .set("Origin", BASE_URL);
    expect(res.status).toBe(403);

    const logs = harness.logs();
    expect(logs).toContain('"event":"authorization_denied"');
    expect(logs).toContain('"action":"users.read"');
    expect(logs).not.toContain(token.split(".")[0]);
    expect(logs).not.toContain(PASSWORD);
    expect(logs).not.toContain(operator);
    expect(logs.toLowerCase()).not.toContain("cookie");
    expect(await harness.metrics.registry.metrics()).toMatch(
      /authorization_denials_total\{status="403",action="users.read"\} 1/,
    );
  });

  it("el límite de intentos alcanzado es un evento de seguridad y una métrica", async () => {
    const harness = buildAuthApp(db, { settings: { loginFailures: { max: 1, windowMs: 60_000 } } });
    await signIn(harness.app, operator, "contrasena-incorrecta");
    expect((await signIn(harness.app, operator, PASSWORD)).status).toBe(429);
    expect(harness.logs()).toContain('"event":"rate_limited"');
    expect(await harness.metrics.registry.metrics()).toMatch(/auth_rate_limited_total 1/);
  });
});
