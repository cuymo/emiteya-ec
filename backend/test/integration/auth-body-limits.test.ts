// Cuerpo acotado y tipo de contenido de /api/auth/* con Better Auth real (enforce-api-origin-and-body-
// limits, tarea 2.2, design D6): un cliente HTTP de Node crudo controla `Content-Length` y `chunked`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listenRaw, type RawServer } from "../support/raw-http.ts";
import { BASE_URL, PASSWORD, buildAuthApp, createMember, type AuthApp } from "./auth-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertCompany } from "./fixtures.ts";

const LIMIT = 8192;
const MARKER = "cuerpo-que-no-debe-registrarse";

/** Un JSON válido de exactamente `size` bytes: el objeto seguido de espacios. */
function paddedJson(value: object, size: number): string {
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json) > size) throw new Error("El objeto ya supera el tamaño pedido");
  return json + " ".repeat(size - Buffer.byteLength(json));
}

const sessionCookie = (headers: { "set-cookie"?: string[] }) =>
  (headers["set-cookie"] ?? []).map((cookie) => cookie.split(";")[0]).join("; ");

describe("cuerpo de /api/auth", () => {
  let db: MigratedSchema;
  let harness: AuthApp;
  let server: RawServer;
  let companyId: string;
  let counter = 0;

  async function newMember() {
    counter++;
    const email = `limite-${counter}@auth.ec`;
    await createMember(harness.uow, companyId, { name: "Usuario", email });
    return email;
  }
  const json = { "content-type": "application/json", origin: BASE_URL };
  const signIn = (body: RawBody, headers: Record<string, string> = json) =>
    server.send({ path: "/api/auth/sign-in/email", headers, body });
  type RawBody = Parameters<RawServer["send"]>[0]["body"];

  beforeAll(async () => {
    db = await createMigratedSchema("auth_body_limits");
    companyId = await insertCompany(db.database.prisma, "Empresa");
    harness = buildAuthApp(db);
    server = await listenRaw(harness.app);
  });

  afterAll(async () => {
    await server.close();
    await db.drop();
  });

  it("el inicio de sesión, el cierre de sesión con {} y el cambio de contraseña funcionan igual", async () => {
    const email = await newMember();
    const signedIn = await signIn(JSON.stringify({ email, password: PASSWORD }), {
      "content-type": "application/json; charset=utf-8",
      origin: BASE_URL,
    });
    expect(signedIn.status).toBe(200);
    const cookie = sessionCookie(signedIn.headers);
    expect(cookie).not.toBe("");

    const changed = await server.send({
      path: "/api/auth/change-password",
      headers: { ...json, cookie },
      body: JSON.stringify({
        currentPassword: PASSWORD,
        newPassword: "contrasena-nueva-del-limite",
      }),
    });
    expect(changed.status).toBe(200);

    const signedOut = await server.send({
      path: "/api/auth/sign-out",
      headers: { ...json, cookie: sessionCookie(changed.headers) || cookie },
      body: "{}",
    });
    expect(signedOut.status).toBe(200);
  });

  it("un cuerpo de exactamente 8192 bytes se procesa, y uno de 8193 recibe 413", async () => {
    const email = await newMember();
    const credentials = { email, password: PASSWORD };
    const atLimit = await signIn(paddedJson(credentials, LIMIT));
    expect(atLimit.status).toBe(200);

    const over = await signIn(paddedJson(credentials, LIMIT + 1));
    expect(over.status).toBe(413);
    expect(JSON.parse(over.body)).toMatchObject({ error: { code: "PAYLOAD_TOO_LARGE" } });
    expect(over.headers["set-cookie"]).toBeUndefined();
  });

  it("un Content-Length mayor que 8192 recibe 413 sin enviar el cuerpo", async () => {
    const res = await server.send({
      path: "/api/auth/sign-in/email",
      headers: { ...json, "content-length": String(LIMIT + 1000) },
      headersOnly: true,
    });
    expect(res.status).toBe(413);
    expect(JSON.parse(res.body)).toMatchObject({ error: { code: "PAYLOAD_TOO_LARGE" } });
  });

  it("en modo chunked, sin Content-Length, cuenta los bytes recibidos", async () => {
    // En HTTP/1.1, una petición sin Content-Length solo lleva cuerpo en modo chunked.
    const email = await newMember();
    const body = paddedJson({ email, password: PASSWORD }, LIMIT - 100);
    const under = await signIn([body.slice(0, 50), body.slice(50, 4000), body.slice(4000)]);
    expect(under.status).toBe(200);

    const big = paddedJson({ email, password: PASSWORD }, LIMIT + 2000);
    const over = await signIn([big.slice(0, 4000), big.slice(4000, 8000), big.slice(8000)]);
    expect(over.status).toBe(413);
    expect(over.headers["set-cookie"]).toBeUndefined();
  });

  it("sin cuerpo ni Content-Type, la petición no recibe 415", async () => {
    const email = await newMember();
    const cookie = sessionCookie(
      (await signIn(JSON.stringify({ email, password: PASSWORD }))).headers,
    );
    const res = await server.send({
      path: "/api/auth/sign-out",
      headers: { origin: BASE_URL, cookie },
    });
    expect(res.status).not.toBe(415);
    expect(res.status).toBe(200);
  });

  it.each([
    "text/plain",
    "application/x-www-form-urlencoded",
    "multipart/form-data; boundary=limite",
    "application/xml",
  ])("un cuerpo %s recibe 415 y Better Auth no lo procesa", async (contentType) => {
    const email = await newMember();
    const res = await signIn(JSON.stringify({ email, password: PASSWORD, marca: MARKER }), {
      "content-type": contentType,
      origin: BASE_URL,
    });
    expect(res.status).toBe(415);
    expect(JSON.parse(res.body)).toMatchObject({ error: { code: "UNSUPPORTED_MEDIA_TYPE" } });
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(res.body).not.toContain(MARKER);
  });

  it("un cuerpo sin Content-Type recibe 415", async () => {
    const res = await server.send({
      path: "/api/auth/sign-in/email",
      headers: { origin: BASE_URL },
      body: JSON.stringify({ email: "sin-tipo@auth.ec", password: PASSWORD }),
    });
    expect(res.status).toBe(415);
  });

  it("los rechazos no repiten el cuerpo, y los logs no tienen la contraseña, la cookie ni el cuerpo", async () => {
    const email = await newMember();
    const secretPassword = "contrasena-que-no-debe-aparecer";
    const signedIn = await signIn(JSON.stringify({ email, password: PASSWORD }));
    const cookie = sessionCookie(signedIn.headers);

    const big = await signIn(paddedJson({ email, password: secretPassword, marca: MARKER }, 9000), {
      ...json,
      cookie,
    });
    expect(big.status).toBe(413);
    const plain = await signIn(JSON.stringify({ email, password: secretPassword, marca: MARKER }), {
      "content-type": "text/plain",
      origin: BASE_URL,
      cookie,
    });
    expect(plain.status).toBe(415);

    for (const res of [big, plain]) {
      expect(res.body).not.toContain(MARKER);
      expect(res.body).not.toContain(secretPassword);
    }
    const logs = harness.logs();
    const token = decodeURIComponent(cookie.split("=")[1] ?? "");
    for (const secret of [MARKER, secretPassword, PASSWORD, token.split(".")[0]!]) {
      expect(logs).not.toContain(secret);
    }
  });
});
