// API del logo (design D5 y D12): cuerpo binario, tipos de contenido, límite, cabeceras de la
// descarga, permisos y aislamiento por empresa.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pngBytes } from "../fixtures/images.ts";
import { createMember, type AuthApp } from "./auth-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertCompany } from "./fixtures.ts";
import { TEST_LOGO_MAX_BYTES, buildTaxpayerApp, sessionCookie } from "./taxpayer-harness.ts";

type Body = { data: Record<string, unknown>; error: { code: string; message: string } };
const bodyOf = (res: { body: unknown }) => res.body as Body;

const PROFILE = {
  ruc: "1790012345001",
  legalName: "Comercial Andina S.A.",
  headOfficeAddress: "Quito",
  accountingRequired: true,
};

/** Lee la respuesta como bytes, sin interpretarla: en el parser, la respuesta es el stream. */
function binary(res: request.Response, done: (error: Error | null, body: Buffer) => void) {
  const stream = res as unknown as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  stream.on("data", (chunk: Buffer) => chunks.push(chunk));
  stream.on("end", () => done(null, Buffer.concat(chunks)));
}

describe("API del logo", () => {
  let db: MigratedSchema;
  let api: AuthApp;
  const cookies: Record<string, string> = {};
  const logo = pngBytes(80, 40, 9);

  beforeAll(async () => {
    db = await createMigratedSchema("taxpayer_logo_api");
    api = buildTaxpayerApp(db);
    const companyA = await insertCompany(db.database.prisma, "Empresa A");
    const companyB = await insertCompany(db.database.prisma, "Empresa B");
    for (const [key, companyId, email, role] of [
      ["adminA", companyA, "admin@a.ec", "ADMIN"],
      ["operatorA", companyA, "operador@a.ec", "OPERATOR"],
      ["adminB", companyB, "admin@b.ec", "ADMIN"],
    ] as const) {
      await createMember(api.uow, companyId, { name: key, email, role });
      cookies[key] = await sessionCookie(api.app, email);
    }
    for (const who of ["adminA", "adminB"]) {
      const res = await request(api.app)
        .put("/api/v1/taxpayer")
        .set("Cookie", cookies[who]!)
        .send({ ...PROFILE, expectedVersion: null });
      expect(res.status).toBe(200);
    }
  });

  afterAll(async () => {
    await db.drop();
  });

  const upload = (who: string, content: Buffer, type = "image/png", version = "1") =>
    request(api.app)
      .put(`/api/v1/taxpayer/logo?expectedVersion=${version}`)
      .set("Cookie", cookies[who]!)
      .set("Content-Type", type)
      .send(content);

  const download = (who: string) =>
    request(api.app)
      .get("/api/v1/taxpayer/logo")
      .set("Cookie", cookies[who]!)
      .buffer(true)
      .parse(binary);

  it("publica el límite del logo en la configuración", async () => {
    const res = await request(api.app).get("/api/v1/taxpayer").set("Cookie", cookies.adminA!);
    expect(bodyOf(res).data.logoMaxBytes).toBe(TEST_LOGO_MAX_BYTES);
  });

  it("sin logo responde 404", async () => {
    expect((await download("adminA")).status).toBe(404);
  });

  it("rechaza un tipo de contenido que no es de imagen con 415", async () => {
    const res = await upload("adminA", logo, "text/plain");
    expect(res.status).toBe(415);
    expect(bodyOf(res).error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  it("rechaza una imagen sobre el límite con 413 y el límite en el mensaje", async () => {
    const res = await upload("adminA", Buffer.concat([logo, Buffer.alloc(TEST_LOGO_MAX_BYTES)]));
    expect(res.status).toBe(413);
    expect(bodyOf(res).error).toMatchObject({
      code: "LOGO_TOO_LARGE",
      message: "El logo supera el límite de 64 KB.",
    });
  });

  it("rechaza un archivo declarado PNG cuyo contenido no lo es", async () => {
    const res = await upload("adminA", Buffer.from("<svg/>"), "image/png");
    expect(res.status).toBe(400);
    expect(bodyOf(res).error.message).toBe("El logo debe ser una imagen PNG o JPEG.");
  });

  it("exige la versión esperada en la consulta", async () => {
    const res = await request(api.app)
      .put("/api/v1/taxpayer/logo")
      .set("Cookie", cookies.adminA!)
      .set("Content-Type", "application/octet-stream")
      .send(logo);
    expect(res.status).toBe(400);
  });

  it("carga el logo y lo sirve con su tipo detectado, nosniff y ETag", async () => {
    const res = await upload("adminA", logo, "application/octet-stream");
    expect(res.status).toBe(200);
    const view = bodyOf(res).data as {
      version: number;
      logo: { sha256: string; sizeBytes: number };
    };
    expect(view.version).toBe(2);
    expect(view.logo.sizeBytes).toBe(logo.length);

    const got = await download("adminA");
    expect(got.status).toBe(200);
    expect(got.headers["content-type"]).toBe("image/png");
    expect(got.headers["x-content-type-options"]).toBe("nosniff");
    expect(got.headers["cache-control"]).toBe("private, no-cache");
    expect(got.headers.etag).toBe(`"${view.logo.sha256}"`);
    expect(Buffer.compare(got.body as Buffer, logo)).toBe(0);

    const revalidated = await request(api.app)
      .get("/api/v1/taxpayer/logo")
      .set("Cookie", cookies.adminA!)
      .set("If-None-Match", `"${view.logo.sha256}"`);
    expect(revalidated.status).toBe(304);
  });

  it("otra empresa nunca recibe el logo ajeno", async () => {
    expect((await download("adminB")).status).toBe(404);
  });

  it("el operador recibe 403 al consultar, cargar o eliminar el logo", async () => {
    expect((await download("operatorA")).status).toBe(403);
    expect((await upload("operatorA", logo, "image/png", "2")).status).toBe(403);
    const removed = await request(api.app)
      .delete("/api/v1/taxpayer/logo?expectedVersion=2")
      .set("Cookie", cookies.operatorA!);
    expect(removed.status).toBe(403);
  });

  it("elimina el logo con una versión nueva", async () => {
    const res = await request(api.app)
      .delete("/api/v1/taxpayer/logo?expectedVersion=2")
      .set("Cookie", cookies.adminA!);
    expect(res.status).toBe(200);
    expect(bodyOf(res).data).toMatchObject({ version: 3, logo: null });
    expect((await download("adminA")).status).toBe(404);
  });
});
