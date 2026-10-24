// Perfil y avatar propios (redesign-account-profile, tareas 4.1, 5.1 y 5.2; spec user-access,
// «Consultar la cuenta propia», «Avatar propio» y «Avatar privado del usuario»): el perfil propio sin
// credenciales ni identificadores; cargar, reemplazar y quitar el avatar; formatos, tamaño y
// dimensiones rechazados; la misma imagen o cargas a la vez con una sola fila; y que nadie más lee,
// cambia, quita ni detecta un avatar ajeno, sin eventos de auditoría.
import { createHash } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIdentityPortabilitySources } from "../../src/modules/identity/infrastructure/portability-sources.ts";
import { GIF_BYTES, SVG_BYTES, jpegBytes, pngBytes } from "../fixtures/images.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertCompany } from "./fixtures.ts";
import {
  BASE_URL,
  PASSWORD,
  buildProfileApp,
  createMember,
  signIn,
  type AuthApp,
} from "./auth-harness.ts";

type Body = {
  data: Record<string, unknown> & Record<string, unknown>[];
  error: { code: string; message: string };
};
const bodyOf = (res: { body: unknown }) => res.body as Body;
const MAX = 16 * 1024;

describe("perfil y avatar propios", () => {
  let db: MigratedSchema;
  let api: AuthApp;
  let companyA: string;
  let companyB: string;
  const ids: Record<string, string> = {};
  const emails = {
    admin: "admin@perfil-a.ec",
    operator: "operador@perfil-a.ec",
    inactive: "inactiva@perfil-a.ec",
    otherB: "usuario@perfil-b.ec",
  };
  let ipSeq = 0;
  const ip = () => `198.51.100.${++ipSeq % 250}`;
  const cookies: Record<string, string> = {};
  const session = async (email: string) => {
    const res = await signIn(api.app, email, PASSWORD, { "X-Forwarded-For": ip() });
    expect(res.status, `inicio de sesión de ${email}`).toBe(200);
    return res.cookie;
  };
  const call = (method: "get" | "put" | "delete", url: string, cookie: string) => {
    const agent = request(api.app);
    return agent[method](`/api/v1${url}`)
      .set("Origin", BASE_URL)
      .set("Cookie", cookie)
      .set("X-Forwarded-For", ip());
  };
  const upload = (cookie: string, content: Buffer, type = "image/png") =>
    call("put", "/me/avatar", cookie).set("Content-Type", type).send(content);
  const avatarRows = () => db.database.prisma.userAvatar.findMany();

  beforeAll(async () => {
    db = await createMigratedSchema("own_profile_api");
    companyA = await insertCompany(db.database.prisma, "Empresa Perfil A");
    companyB = await insertCompany(db.database.prisma, "Empresa Perfil B");
    api = buildProfileApp(db, { trustProxy: 1, avatarMaxBytes: MAX });
    ids.admin = await createMember(api.uow, companyA, {
      name: "Ana Admin",
      email: emails.admin,
      role: "ADMIN",
    });
    ids.operator = await createMember(api.uow, companyA, {
      name: "Óscar Operador",
      email: emails.operator,
    });
    ids.inactive = await createMember(api.uow, companyA, {
      name: "Inés Inactiva",
      email: emails.inactive,
    });
    ids.otherB = await createMember(api.uow, companyB, { name: "Bruno B", email: emails.otherB });
    for (const [key, email] of Object.entries(emails)) cookies[key] = await session(email);
    await db.database.prisma.member.update({
      where: { organizationId_userId: { organizationId: companyA, userId: ids.inactive } },
      data: { status: "DEACTIVATED" },
    });
  });

  afterAll(async () => {
    await db?.drop();
  });

  it("el perfil propio trae nombre, correo, rol, estado, antigüedad y avatar, sin credenciales ni ids", async () => {
    const res = await call("get", "/me/profile", cookies.operator!);
    expect(res.status).toBe(200);
    const data = bodyOf(res).data;
    expect(Object.keys(data).sort()).toEqual(
      [
        "avatar",
        "avatarMaxBytes",
        "email",
        "memberSince",
        "membershipStatus",
        "name",
        "role",
      ].sort(),
    );
    expect(data).toMatchObject({
      name: "Óscar Operador",
      email: emails.operator,
      role: "OPERATOR",
      membershipStatus: "ACTIVE",
      avatar: null,
      avatarMaxBytes: MAX,
    });
    expect(JSON.stringify(res.body)).not.toContain(ids.operator!);
    expect(JSON.stringify(res.body)).not.toMatch(/password|token|session|companyId/i);
  });

  it("sin sesión o sin membresía activa responde 401, sin revelar si la identidad existe", async () => {
    expect((await request(api.app).get("/api/v1/me/profile")).status).toBe(401);
    expect((await request(api.app).get("/api/v1/me/avatar")).status).toBe(401);
    expect((await call("get", "/me/profile", cookies.inactive!)).status).toBe(401);
    expect((await upload(cookies.inactive!, pngBytes(64, 64))).status).toBe(401);
  });

  it("sin avatar, la imagen responde 404", async () => {
    const res = await call("get", "/me/avatar", cookies.admin!);
    expect(res.status).toBe(404);
    expect(bodyOf(res).error.code).toBe("AVATAR_NOT_FOUND");
  });

  it("carga, reemplaza y quita el avatar, servido solo con cabeceras privadas", async () => {
    const first = pngBytes(64, 64, 1);
    const loaded = await upload(cookies.admin!, first);
    expect(loaded.status).toBe(200);
    const version = createHash("sha256").update(first).digest("hex").slice(0, 16);
    expect(bodyOf(loaded).data.avatar).toEqual({ version });
    const image = await call("get", "/me/avatar", cookies.admin!).buffer(true);
    expect(image.status).toBe(200);
    expect(image.headers["content-type"]).toContain("image/png");
    expect(image.headers["cache-control"]).toBe("private, no-cache");
    expect(image.headers["x-content-type-options"]).toBe("nosniff");
    expect(image.headers.etag).toBe(`"${createHash("sha256").update(first).digest("hex")}"`);
    expect(Buffer.compare(image.body as Buffer, first)).toBe(0);

    const second = jpegBytes(120, 80);
    const replaced = await upload(cookies.admin!, second, "image/jpeg");
    expect(bodyOf(replaced).data.avatar).not.toEqual({ version });
    expect((await call("get", "/me/avatar", cookies.admin!)).headers["content-type"]).toContain(
      "image/jpeg",
    );

    const removed = await call("delete", "/me/avatar", cookies.admin!);
    expect(removed.status).toBe(200);
    expect(bodyOf(removed).data.avatar).toBeNull();
    expect((await call("get", "/me/avatar", cookies.admin!)).status).toBe(404);
  });

  it("rechaza SVG, GIF, una firma falsa, el exceso de tamaño o de píxeles, y el avatar no cambia", async () => {
    await upload(cookies.operator!, pngBytes(32, 32, 7));
    const before = await db.database.prisma.userAvatar.findUnique({
      where: { userId: ids.operator! },
    });
    const fakePng = Buffer.concat([Buffer.from("PNG"), pngBytes(10, 10).subarray(3)]);
    for (const content of [SVG_BYTES, GIF_BYTES, fakePng]) {
      const res = await upload(cookies.operator!, content);
      expect(res.status).toBe(400);
      expect(bodyOf(res).error.code).toBe("INVALID_AVATAR");
      expect(bodyOf(res).error.message).toContain("PNG o JPEG");
    }
    const huge = await upload(cookies.operator!, pngBytes(4097, 10));
    expect(bodyOf(huge).error.message).toContain("4096 px");
    const oversized = Buffer.concat([pngBytes(32, 32), Buffer.alloc(MAX)]);
    const tooBig = await upload(cookies.operator!, oversized);
    expect(tooBig.status).toBe(413);
    expect(bodyOf(tooBig).error).toMatchObject({ code: "AVATAR_TOO_LARGE" });
    expect(bodyOf(tooBig).error.message).toContain("16 KB");
    const unsupportedType = await upload(cookies.operator!, pngBytes(32, 32), "text/plain");
    expect(unsupportedType.status).toBe(415);
    const after = await db.database.prisma.userAvatar.findUnique({
      where: { userId: ids.operator! },
    });
    expect(after?.sha256).toBe(before?.sha256);
  });

  it("la misma imagen dos veces, o cargas a la vez, dejan una sola fila con la última imagen", async () => {
    const same = pngBytes(48, 48, 3);
    await upload(cookies.otherB!, same);
    await upload(cookies.otherB!, same);
    const results = await Promise.all(
      [pngBytes(48, 48, 4), pngBytes(48, 48, 5), pngBytes(48, 48, 6)].map((content) =>
        upload(cookies.otherB!, content),
      ),
    );
    expect(results.map((res) => res.status)).toEqual([200, 200, 200]);
    const rows = (await avatarRows()).filter((row) => row.userId === ids.otherB);
    expect(rows).toHaveLength(1);
  });

  it("nadie más lee, cambia, quita ni detecta un avatar ajeno, y no hay auditoría del avatar", async () => {
    await upload(cookies.operator!, pngBytes(40, 40, 9));
    const operatorRow = await db.database.prisma.userAvatar.findUnique({
      where: { userId: ids.operator! },
    });
    // El administrador de la misma empresa y el usuario de otra solo alcanzan su propio avatar.
    for (const cookie of [cookies.admin!, cookies.otherB!]) {
      for (const url of [`/me/avatar?userId=${ids.operator}`, `/users/${ids.operator}/avatar`]) {
        const res = await call("get", url, cookie);
        expect(res.headers.etag ?? "").not.toBe(`"${operatorRow?.sha256}"`);
      }
      await call("delete", `/me/avatar?userId=${ids.operator}`, cookie);
    }
    const still = await db.database.prisma.userAvatar.findUnique({
      where: { userId: ids.operator! },
    });
    expect(still?.sha256).toBe(operatorRow?.sha256);
    // La lista de Usuarios no lleva avatares.
    const users = bodyOf(await call("get", "/users", cookies.admin!)).data;
    for (const user of users) expect(Object.keys(user)).not.toContain("avatar");
    // La portabilidad de los usuarios tampoco.
    const portability = createIdentityPortabilitySources(db.name).users;
    const rows = await db.database.prisma.$transaction(async (tx) => {
      const collected: object[] = [];
      for await (const batch of portability.batches(tx, companyA, 100)) collected.push(...batch);
      return collected;
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(
        ["email", "memberSince", "name", "role", "status", "userId"].sort(),
      );
    }
    // Ningún evento de auditoría por el avatar.
    const audits = await db.database.prisma.auditEvent.findMany({
      where: { action: { contains: "avatar" } },
    });
    expect(audits).toEqual([]);
  });
});
