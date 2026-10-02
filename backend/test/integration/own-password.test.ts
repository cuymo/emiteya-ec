// Cambio de la contraseña propia con /api/auth/change-password (design D6): exige la actual, aplica
// la longitud configurada, invalida las demás sesiones y emite un evento de seguridad (D13).
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertCompany } from "./fixtures.ts";
import {
  BASE_URL,
  PASSWORD,
  buildUsersApp,
  createMember,
  signIn,
  type AuthApp,
} from "./auth-harness.ts";

describe("cambio de la contraseña propia", () => {
  let db: MigratedSchema;
  let api: AuthApp;
  let companyId: string;
  let ipSeq = 0;
  const ip = () => `192.0.2.${++ipSeq}`;

  beforeAll(async () => {
    db = await createMigratedSchema("own_password");
    companyId = await insertCompany(db.database.prisma, "Empresa");
    api = buildUsersApp(db, { trustProxy: 1 });
  });

  afterAll(async () => {
    await db.drop();
  });

  async function newUser(email: string) {
    const userId = await createMember(api.uow, companyId, { name: "Usuario", email });
    return userId;
  }
  const login = (email: string, password = PASSWORD) =>
    signIn(api.app, email, password, { "X-Forwarded-For": ip() });
  const changePassword = (cookie: string, body: Record<string, unknown>) =>
    request(api.app)
      .post("/api/auth/change-password")
      .set("Origin", BASE_URL)
      .set("Cookie", cookie)
      .set("X-Forwarded-For", ip())
      .send(body);
  const me = (cookie: string) =>
    request(api.app).get("/api/v1/me").set("Cookie", cookie).set("X-Forwarded-For", ip());

  it("con la contraseña actual correcta cambia la contraseña, invalida las demás sesiones y emite el evento", async () => {
    const email = "cambia@empresa.ec";
    const userId = await newUser(email);
    const current = (await login(email)).cookie;
    const other = (await login(email)).cookie;
    api.events.length = 0;

    const res = await changePassword(current, {
      currentPassword: PASSWORD,
      newPassword: "contrasena-propia-nueva-1",
      revokeOtherSessions: true,
    });
    expect(res.status).toBe(200);
    expect((await me(other)).status).toBe(401);
    expect((await login(email)).status).toBe(401);
    expect((await login(email, "contrasena-propia-nueva-1")).status).toBe(200);
    expect(api.events.filter((e) => e.type === "own_password_changed")).toEqual([
      expect.objectContaining({ actorUserId: userId, companyId }),
    ]);
    expect(await db.database.prisma.auditEvent.count({ where: { targetUserId: userId } })).toBe(0);
  });

  it("invalida las demás sesiones aunque el cliente pida no hacerlo", async () => {
    const email = "insiste@empresa.ec";
    await newUser(email);
    const current = (await login(email)).cookie;
    const other = (await login(email)).cookie;
    const res = await changePassword(current, {
      currentPassword: PASSWORD,
      newPassword: "contrasena-propia-nueva-2",
      revokeOtherSessions: false,
    });
    expect(res.status).toBe(200);
    expect((await me(other)).status).toBe(401);
  });

  it("con la contraseña actual incorrecta se rechaza y la contraseña no cambia", async () => {
    const email = "equivoca@empresa.ec";
    await newUser(email);
    const cookie = (await login(email)).cookie;
    api.events.length = 0;
    const res = await changePassword(cookie, {
      currentPassword: "no-es-la-actual-123",
      newPassword: "contrasena-propia-nueva-3",
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await login(email)).status).toBe(200);
    expect(api.events.filter((e) => e.type === "own_password_changed")).toEqual([]);
  });

  it("aplica la longitud configurada a la contraseña nueva", async () => {
    const email = "corta@empresa.ec";
    await newUser(email);
    const cookie = (await login(email)).cookie;
    const short = await changePassword(cookie, {
      currentPassword: PASSWORD,
      newPassword: "a".repeat(11),
    });
    expect(short.status).toBe(400);
    const long = await changePassword(cookie, {
      currentPassword: PASSWORD,
      newPassword: "a".repeat(129),
    });
    expect(long.status).toBe(400);
    expect((await login(email)).status).toBe(200);
    expect(
      (await changePassword(cookie, { currentPassword: PASSWORD, newPassword: "a".repeat(12) }))
        .status,
    ).toBe(200);
  });

  it("con otra política configurada, el mensaje indica la longitud vigente", async () => {
    const custom = buildUsersApp(db, {
      trustProxy: 1,
      settings: { password: { minLength: 16, maxLength: 64 } },
    });
    const email = "politica@empresa.ec";
    await createMember(custom.uow, companyId, { name: "Política", email });
    const { cookie } = await signIn(custom.app, email, PASSWORD, { "X-Forwarded-For": ip() });
    const res = await request(custom.app)
      .post("/api/auth/change-password")
      .set("Origin", BASE_URL)
      .set("Cookie", cookie)
      .set("X-Forwarded-For", ip())
      .send({ currentPassword: PASSWORD, newPassword: "a".repeat(15) });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      code: "PASSWORD_POLICY",
      message: "La contraseña debe tener al menos 16 caracteres.",
    });
    expect((await signIn(custom.app, email, PASSWORD, { "X-Forwarded-For": ip() })).status).toBe(
      200,
    );
  });

  it("una sesión sin membresía activa no puede cambiar la contraseña", async () => {
    const email = "desactivada@empresa.ec";
    const userId = await newUser(email);
    const cookie = (await login(email)).cookie;
    await db.database.prisma.member.update({
      where: { organizationId_userId: { organizationId: companyId, userId } },
      data: { status: "DEACTIVATED" },
    });
    const res = await changePassword(cookie, {
      currentPassword: PASSWORD,
      newPassword: "contrasena-propia-nueva-4",
    });
    expect(res.status).toBe(401);
  });

  it("sin sesión se rechaza", async () => {
    const res = await request(api.app)
      .post("/api/auth/change-password")
      .set("Origin", BASE_URL)
      .send({ currentPassword: PASSWORD, newPassword: "contrasena-propia-nueva-5" });
    expect(res.status).toBe(401);
  });
});
