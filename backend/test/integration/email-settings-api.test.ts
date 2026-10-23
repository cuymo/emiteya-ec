// API del servidor de correo (add-email-delivery, design D8 a D11; spec email-delivery, «Servidor de
// correo de la empresa», y audit-trail, «Auditoría del correo»): alta, cambio sin repetir la
// contraseña, datos inválidos, sin cifrado según el despliegue, permisos, aislamiento por empresa,
// concurrencia, guardado repetido y su auditoría sin secretos.
import request from "../support/http-client.ts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EmailSettingsResponse } from "@facturador/contracts";
import { createMember } from "./auth-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { buildEmailApp } from "./email-harness.ts";
import { insertCompany } from "./fixtures.ts";
import { sessionCookie } from "./taxpayer-harness.ts";

type Body = { data: EmailSettingsResponse; error: { code: string; message: string } };
const bodyOf = (res: { body: unknown }) => res.body as Body;
const PASSWORD = "clave-smtp-secreta-ñ";

describe("API del servidor de correo", () => {
  let db: MigratedSchema;
  let api: ReturnType<typeof buildEmailApp>;
  let companyA: string;
  let companyB: string;
  const cookies: Record<string, string> = {};

  const call = (who: string, method: "get" | "put", path = "/email/settings") =>
    request(api.app)[method](`/api/v1${path}`).set("Cookie", cookies[who]!);
  const settings = (overrides: Record<string, unknown> = {}) => ({
    host: "smtp.empresa.ec",
    port: 465,
    security: "TLS",
    username: "facturas@empresa.ec",
    password: PASSWORD,
    fromName: "Ferretería Andina",
    fromAddress: "facturas@empresa.ec",
    bccAddress: null,
    autoSend: true,
    testRecipient: "revision@empresa.ec",
    expectedVersion: null,
    ...overrides,
  });
  const audits = (companyId: string) =>
    db.database.prisma.auditEvent.findMany({
      where: { companyId, action: "email_settings.changed" },
      orderBy: { occurredAt: "asc" },
    });
  const secretOf = (companyId: string) =>
    db.database.prisma.emailSettingsSecret.findUnique({ where: { companyId } });

  beforeAll(async () => {
    db = await createMigratedSchema("email_settings_api");
    api = buildEmailApp(db);
    companyA = await insertCompany(db.database.prisma, "Empresa A");
    companyB = await insertCompany(db.database.prisma, "Empresa B");
    for (const [name, companyId, email, role] of [
      ["adminA", companyA, "admin@a.ec", "ADMIN"],
      ["adminA2", companyA, "admin2@a.ec", "ADMIN"],
      ["operatorA", companyA, "operador@a.ec", "OPERATOR"],
      ["adminB", companyB, "admin@b.ec", "ADMIN"],
    ] as const) {
      await createMember(api.uow, companyId, { name, email, role });
      cookies[name] = await sessionCookie(api.app, email);
    }
  });

  afterAll(async () => {
    await db.drop();
  });

  it("sin configurar responde null con lo que decide el despliegue", async () => {
    const res = await call("adminA", "get");
    expect(res.status).toBe(200);
    expect(bodyOf(res).data).toEqual({
      settings: null,
      deliveryEnabled: false,
      plaintextAllowed: false,
    });
  });

  it("registra el servidor con la contraseña cifrada, que nunca vuelve a mostrarse", async () => {
    const res = await call("adminA", "put").send(settings());
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(bodyOf(res).data.settings).toMatchObject({
      host: "smtp.empresa.ec",
      port: 465,
      security: "TLS",
      username: "facturas@empresa.ec",
      passwordSet: true,
      fromName: "Ferretería Andina",
      testRecipient: "revision@empresa.ec",
      version: 1,
    });
    expect(JSON.stringify(res.body)).not.toContain(PASSWORD);
    const read = await call("adminA", "get");
    expect(JSON.stringify(read.body)).not.toContain(PASSWORD);
    const secret = await secretOf(companyA);
    expect(secret).not.toBeNull();
    expect(Buffer.from(secret!.passwordCiphertext).includes(Buffer.from(PASSWORD))).toBe(false);
  });

  it("guardar lo mismo dos veces deja una sola configuración, sin evento ni versión nueva", async () => {
    const before = (await audits(companyA)).length;
    for (const expectedVersion of [null, 1]) {
      const res = await call("adminA", "put").send(settings({ expectedVersion }));
      expect(res.status).toBe(200);
      expect(bodyOf(res).data.settings?.version).toBe(1);
    }
    expect((await audits(companyA)).length).toBe(before);
    expect(await db.database.prisma.emailSettings.count({ where: { companyId: companyA } })).toBe(
      1,
    );
  });

  it("cambia el remitente sin repetir la contraseña, que sigue siendo la misma", async () => {
    const stored = await secretOf(companyA);
    const { password: _password, ...withoutPassword } = settings();
    const res = await call("adminA", "put").send({
      ...withoutPassword,
      fromName: "Andina Facturación",
      expectedVersion: 1,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(bodyOf(res).data.settings).toMatchObject({ fromName: "Andina Facturación", version: 2 });
    const after = await secretOf(companyA);
    expect(
      Buffer.from(after!.passwordCiphertext).equals(Buffer.from(stored!.passwordCiphertext)),
    ).toBe(true);
    const events = await audits(companyA);
    expect(events.at(-1)!.changes).toEqual({
      "fromName.from": "Ferretería Andina",
      "fromName.to": "Andina Facturación",
    });
  });

  it("una versión desactualizada se rechaza, y dos cambios a la vez dejan uno solo", async () => {
    const stale = await call("adminA", "put").send(
      settings({ fromName: "Otro nombre", expectedVersion: 1 }),
    );
    expect(stale.status).toBe(409);
    expect(bodyOf(stale).error.code).toBe("EMAIL_SETTINGS_CHANGED");
    const results = await Promise.all([
      call("adminA", "put").send(settings({ fromName: "Uno", expectedVersion: 2 })),
      call("adminA2", "put").send(settings({ fromName: "Dos", expectedVersion: 2 })),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(bodyOf(await call("adminA", "get")).data.settings?.version).toBe(3);
  });

  it("cambiar la contraseña se audita sin ningún secreto", async () => {
    const current = bodyOf(await call("adminA", "get")).data.settings!;
    const res = await call("adminA", "put").send(
      settings({
        fromName: current.fromName,
        password: "otra-clave",
        expectedVersion: current.version,
      }),
    );
    expect(res.status).toBe(200);
    const event = (await audits(companyA)).at(-1)!;
    expect(event.changes).toEqual({ smtpLoginChanged: true });
    const json = JSON.stringify(await audits(companyA));
    for (const secret of [PASSWORD, "otra-clave"]) expect(json).not.toContain(secret);
  });

  it("rechaza datos inválidos indicando el campo, sin cambiar nada", async () => {
    const before = bodyOf(await call("adminA", "get")).data.settings!;
    for (const [overrides, code] of [
      [{ port: 70000 }, "VALIDATION_ERROR"],
      [{ host: "" }, "VALIDATION_ERROR"],
      [{ fromAddress: "no-es-correo" }, "VALIDATION_ERROR"],
      [{ fromName: "A\r\nBcc: x@y.ec" }, "VALIDATION_ERROR"],
      [{ security: "NONE", port: 1025 }, "EMAIL_PLAINTEXT_NOT_ALLOWED"],
      [{ username: null, password: "suelta" }, "EMAIL_USERNAME_REQUIRED"],
    ] as const) {
      const res = await call("adminA", "put").send(
        settings({ ...overrides, expectedVersion: before.version }),
      );
      expect(res.status, JSON.stringify(overrides)).toBe(400);
      expect(bodyOf(res).error.code, JSON.stringify(overrides)).toBe(code);
    }
    expect(bodyOf(await call("adminA", "get")).data.settings).toEqual(before);
  });

  it("un usuario nuevo exige su contraseña la primera vez", async () => {
    const { password: _password, ...withoutPassword } = settings();
    const res = await call("adminB", "put").send(withoutPassword);
    expect(res.status).toBe(400);
    expect(bodyOf(res).error.code).toBe("EMAIL_PASSWORD_REQUIRED");
  });

  it("sin usuario, la contraseña guardada se descarta", async () => {
    const current = bodyOf(await call("adminA", "get")).data.settings!;
    const { password: _password, ...withoutPassword } = settings();
    const res = await call("adminA", "put").send({
      ...withoutPassword,
      fromName: current.fromName,
      username: null,
      expectedVersion: current.version,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(bodyOf(res).data.settings).toMatchObject({ username: null, passwordSet: false });
    expect(await secretOf(companyA)).toBeNull();
  });

  it("el operador lee la disponibilidad del correo sin ningún dato del servidor", async () => {
    const res = await call("operatorA", "get", "/email/availability");
    expect(res.status).toBe(200);
    expect((res.body as { data: unknown }).data).toEqual({
      configured: true,
      deliveryEnabled: false,
      autoSend: true,
      testRecipient: "revision@empresa.ec",
    });
    const json = JSON.stringify(res.body);
    for (const leak of ["smtp.empresa.ec", "facturas@empresa.ec", "username", "password", "host"]) {
      expect(json).not.toContain(leak);
    }
    expect((await request(api.app).get("/api/v1/email/availability")).status).toBe(401);
  });

  it("el operador no consulta ni cambia el servidor, y nada revela la configuración", async () => {
    for (const res of [
      await call("operatorA", "get"),
      await call("operatorA", "put").send(settings()),
    ]) {
      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).not.toContain("smtp.empresa.ec");
    }
  });

  it("sin sesión no responde con datos", async () => {
    const res = await request(api.app).get("/api/v1/email/settings");
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).not.toContain("smtp.empresa.ec");
  });

  it("cada empresa ve y cambia solo su configuración", async () => {
    const b = await call("adminB", "get");
    expect(bodyOf(b).data.settings).toBeNull();
    const availability = await call("adminB", "get", "/email/availability");
    expect((availability.body as { data: unknown }).data).toEqual({
      configured: false,
      deliveryEnabled: false,
      autoSend: false,
      testRecipient: null,
    });
    const saved = await call("adminB", "put").send(settings({ host: "smtp.b.ec" }));
    expect(saved.status).toBe(200);
    expect(bodyOf(await call("adminA", "get")).data.settings?.host).toBe("smtp.empresa.ec");
    expect(bodyOf(await call("adminB", "get")).data.settings?.host).toBe("smtp.b.ec");
    // El sobre de la empresa B no se abre con el contexto de la A: cada uno lleva su empresa.
    const secretB = await secretOf(companyB);
    expect(secretB?.companyId).toBe(companyB);
  });
});

describe("despliegue que admite el buzón de pruebas sin cifrado", () => {
  let db: MigratedSchema;
  let api: ReturnType<typeof buildEmailApp>;
  let cookie: string;

  beforeAll(async () => {
    db = await createMigratedSchema("email_settings_plain");
    api = buildEmailApp(db, { policy: { plaintextAllowed: true, deliveryEnabled: true } });
    const companyId = await insertCompany(db.database.prisma, "Empresa Revisión");
    await createMember(api.uow, companyId, { name: "Admin", email: "admin@r.ec", role: "ADMIN" });
    cookie = await sessionCookie(api.app, "admin@r.ec");
  });

  afterAll(async () => {
    await db.drop();
  });

  it("acepta Mailpit sin cifrado ni usuario, y lo informa en la consulta", async () => {
    const res = await request(api.app).put("/api/v1/email/settings").set("Cookie", cookie).send({
      host: "mailpit",
      port: 1025,
      security: "NONE",
      username: null,
      fromName: "Revisión",
      fromAddress: "facturas@revision.ec",
      bccAddress: null,
      autoSend: true,
      testRecipient: "revision@revision.ec",
      expectedVersion: null,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(bodyOf(res).data).toMatchObject({
      settings: { host: "mailpit", security: "NONE", passwordSet: false },
      deliveryEnabled: true,
      plaintextAllowed: true,
    });
  });
});

describe("instalación sin custodia de secretos", () => {
  let db: MigratedSchema;
  let api: ReturnType<typeof buildEmailApp>;
  let cookie: string;

  beforeAll(async () => {
    db = await createMigratedSchema("email_settings_nocustody");
    api = buildEmailApp(db, { custody: { enabled: false } });
    const companyId = await insertCompany(db.database.prisma, "Empresa Sin Custodia");
    await createMember(api.uow, companyId, { name: "Admin", email: "admin@s.ec", role: "ADMIN" });
    cookie = await sessionCookie(api.app, "admin@s.ec");
  });

  afterAll(async () => {
    await db.drop();
  });

  it("no guarda una contraseña sin custodia", async () => {
    const res = await request(api.app).put("/api/v1/email/settings").set("Cookie", cookie).send({
      host: "smtp.empresa.ec",
      port: 587,
      security: "STARTTLS",
      username: "facturas@empresa.ec",
      password: "clave",
      fromName: "Empresa",
      fromAddress: "facturas@empresa.ec",
      bccAddress: null,
      autoSend: true,
      testRecipient: null,
      expectedVersion: null,
    });
    expect(res.status).toBe(409);
    expect(bodyOf(res).error.code).toBe("EMAIL_CUSTODY_DISABLED");
  });
});
