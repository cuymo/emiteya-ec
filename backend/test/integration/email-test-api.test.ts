// Correo de prueba (add-email-delivery, design D10 y D11; spec email-delivery, «Correo de prueba» y
// «Envío apagado por configuración»; audit-trail, «Auditoría del correo»): aceptado contra un
// servidor falso, credenciales rechazadas sin secretos, sin configuración, con el envío apagado sin
// conectar, el límite por minuto, los permisos y el aislamiento por empresa.
import request from "../support/http-client.ts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TestEmailResult } from "@facturador/contracts";
import { startSmtpServer, smtpError, type SmtpTestServer } from "../support/smtp-test-server.ts";
import { createMember } from "./auth-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { buildEmailApp } from "./email-harness.ts";
import { insertCompany } from "./fixtures.ts";
import { sessionCookie } from "./taxpayer-harness.ts";

type Body = { data: TestEmailResult; error: { code: string; message: string } };
const bodyOf = (res: { body: unknown }) => res.body as Body;
const PASSWORD = "clave-smtp-de-prueba-ñ";

describe("correo de prueba", () => {
  let db: MigratedSchema;
  let api: ReturnType<typeof buildEmailApp>;
  let server: SmtpTestServer;
  let rejecting: SmtpTestServer;
  let companyA: string;
  let companyB: string;
  let clock = new Date("2026-10-23T15:00:00Z");
  const cookies: Record<string, string> = {};

  const call = (who: string, method: "put" | "post", path: string) =>
    request(api.app)[method](`/api/v1${path}`).set("Cookie", cookies[who]!);
  const configure = (who: string, port: number, overrides: Record<string, unknown> = {}) =>
    call(who, "put", "/email/settings").send({
      host: "127.0.0.1",
      port,
      security: "NONE",
      username: null,
      fromName: "Ferretería Andina",
      fromAddress: "facturas@andina.ec",
      bccAddress: null,
      autoSend: true,
      testRecipient: null,
      expectedVersion: null,
      ...overrides,
    });
  const test = (who: string, to = "revision@andina.ec") =>
    call(who, "post", "/email/test").send({ to });
  const audits = (companyId: string) =>
    db.database.prisma.auditEvent.findMany({
      where: { companyId, action: "email.test_sent" },
      orderBy: { occurredAt: "asc" },
    });

  beforeAll(async () => {
    server = await startSmtpServer({ disabledCommands: ["STARTTLS"] });
    rejecting = await startSmtpServer({
      disabledCommands: ["STARTTLS"],
      allowInsecureAuth: true,
      authOptional: false,
      onAuth: (_auth, _session, callback) => callback(smtpError("Credenciales inválidas", 535)),
    });
    db = await createMigratedSchema("email_test_api");
    // El buzón de pruebas: envío encendido y sin cifrado admitido, como en la revisión local.
    api = buildEmailApp(db, {
      policy: { deliveryEnabled: true, plaintextAllowed: true },
      now: () => clock,
    });
    companyA = await insertCompany(db.database.prisma, "Empresa A");
    companyB = await insertCompany(db.database.prisma, "Empresa B");
    for (const [name, companyId, email, role] of [
      ["adminA", companyA, "admin@a.ec", "ADMIN"],
      ["operatorA", companyA, "operador@a.ec", "OPERATOR"],
      ["adminB", companyB, "admin@b.ec", "ADMIN"],
    ] as const) {
      await createMember(api.uow, companyId, { name, email, role });
      cookies[name] = await sessionCookie(api.app, email);
    }
  });

  afterAll(async () => {
    await db.drop();
    await server.close();
    await rejecting.close();
  });

  it("sin servidor configurado pide registrarlo y no conecta", async () => {
    const res = await test("adminA");
    expect(res.status).toBe(409);
    expect(bodyOf(res).error.code).toBe("EMAIL_NOT_CONFIGURED");
    expect(server.messages).toEqual([]);
  });

  it("el servidor acepta el correo de prueba, con el momento y la dirección, y queda auditado", async () => {
    expect((await configure("adminA", server.port)).status).toBe(200);
    const res = await test("adminA");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(bodyOf(res).data).toEqual({
      accepted: true,
      message: "El servidor aceptó el correo de prueba.",
      to: "revision@andina.ec",
      at: "2026-10-23T15:00:00.000Z",
    });
    expect(server.messages.map((m) => m.to)).toEqual([["revision@andina.ec"]]);
    expect((await audits(companyA)).at(-1)!.changes).toEqual({
      to: "revision@andina.ec",
      accepted: true,
      failureCode: null,
    });
  });

  it("las credenciales rechazadas se dicen en lenguaje claro, sin la contraseña", async () => {
    const current = await db.database.prisma.emailSettings.findUniqueOrThrow({
      where: { companyId: companyA },
    });
    expect(
      (
        await configure("adminA", rejecting.port, {
          username: "facturas@andina.ec",
          password: PASSWORD,
          expectedVersion: current.version,
        })
      ).status,
    ).toBe(200);
    const res = await test("adminA");
    expect(res.status).toBe(200);
    expect(bodyOf(res).data).toMatchObject({
      accepted: false,
      message: "El servidor rechazó el usuario o la contraseña.",
    });
    expect(JSON.stringify(res.body)).not.toContain(PASSWORD);
    const event = (await audits(companyA)).at(-1)!;
    expect(event.changes).toEqual({
      to: "revision@andina.ec",
      accepted: false,
      failureCode: "AUTH_REJECTED",
    });
    expect(JSON.stringify(event)).not.toContain(PASSWORD);
  });

  it("hasta 5 pruebas por minuto y empresa", async () => {
    clock = new Date("2026-10-23T16:00:00Z");
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await test("adminA")).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    clock = new Date("2026-10-23T16:01:01Z");
    expect((await test("adminA")).status).toBe(200);
  });

  it("rechaza una dirección inválida", async () => {
    const res = await test("adminA", "revision");
    expect(res.status).toBe(400);
  });

  it("el operador no envía pruebas y sin sesión no hay respuesta con datos", async () => {
    expect((await test("operatorA")).status).toBe(403);
    expect((await request(api.app).post("/api/v1/email/test").send({ to: "a@b.ec" })).status).toBe(
      401,
    );
  });

  it("la empresa B no usa el servidor de la empresa A", async () => {
    const res = await test("adminB");
    expect(res.status).toBe(409);
    expect(bodyOf(res).error.code).toBe("EMAIL_NOT_CONFIGURED");
  });
});

describe("correo de prueba con el envío apagado por el despliegue", () => {
  let db: MigratedSchema;
  let api: ReturnType<typeof buildEmailApp>;
  let server: SmtpTestServer;
  let cookie: string;

  beforeAll(async () => {
    server = await startSmtpServer({ disabledCommands: ["STARTTLS"] });
    db = await createMigratedSchema("email_test_disabled");
    api = buildEmailApp(db, { policy: { deliveryEnabled: false, plaintextAllowed: true } });
    const companyId = await insertCompany(db.database.prisma, "Empresa Apagada");
    await createMember(api.uow, companyId, { name: "Admin", email: "admin@x.ec", role: "ADMIN" });
    cookie = await sessionCookie(api.app, "admin@x.ec");
    await request(api.app).put("/api/v1/email/settings").set("Cookie", cookie).send({
      host: "127.0.0.1",
      port: server.port,
      security: "NONE",
      username: null,
      fromName: "Empresa",
      fromAddress: "facturas@x.ec",
      bccAddress: null,
      autoSend: true,
      testRecipient: null,
      expectedVersion: null,
    });
  });

  afterAll(async () => {
    await db.drop();
    await server.close();
  });

  it("lo informa y no conecta con ningún servidor", async () => {
    const res = await request(api.app)
      .post("/api/v1/email/test")
      .set("Cookie", cookie)
      .send({ to: "revision@x.ec" });
    expect(res.status).toBe(409);
    expect(bodyOf(res).error.code).toBe("EMAIL_DELIVERY_DISABLED");
    expect(server.messages).toEqual([]);
  });
});
