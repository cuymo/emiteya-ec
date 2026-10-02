// API de la configuración tributaria (design D12): permisos, sesión, lista permitida y aislamiento.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMember, type AuthApp } from "./auth-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertCompany } from "./fixtures.ts";
import { TEST_LOGO_MAX_BYTES, buildTaxpayerApp, sessionCookie } from "./taxpayer-harness.ts";

type Body = { data: Record<string, unknown>; error: { code: string; message: string } };
const bodyOf = (res: { body: unknown }) => res.body as Body;

const PROFILE = {
  ruc: "1790012345001",
  legalName: "Comercial Andina S.A.",
  headOfficeAddress: "Av. Amazonas N24-03, Quito",
  accountingRequired: false,
};

describe("API de la configuración tributaria", () => {
  let db: MigratedSchema;
  let api: AuthApp;
  const cookies: Record<string, string> = {};

  beforeAll(async () => {
    db = await createMigratedSchema("taxpayer_api");
    api = buildTaxpayerApp(db);
    const companyA = await insertCompany(db.database.prisma, "Empresa A");
    const companyB = await insertCompany(db.database.prisma, "Empresa B");
    const members = [
      ["adminA", companyA, "admin@a.ec", "ADMIN"],
      ["operatorA", companyA, "operador@a.ec", "OPERATOR"],
      ["adminB", companyB, "admin@b.ec", "ADMIN"],
    ] as const;
    for (const [key, companyId, email, role] of members) {
      await createMember(api.uow, companyId, { name: key, email, role });
      cookies[key] = await sessionCookie(api.app, email);
    }
  });

  afterAll(async () => {
    await db.drop();
  });

  const call = (method: "get" | "put", path: string, who?: string) => {
    const req = request(api.app)[method](`/api/v1${path}`);
    return who ? req.set("Cookie", cookies[who]!) : req;
  };

  it("sin sesión responde 401", async () => {
    const res = await call("get", "/taxpayer");
    expect(res.status).toBe(401);
  });

  it("sin datos registrados responde la configuración vacía en Pruebas", async () => {
    const res = await call("get", "/taxpayer", "adminA");
    expect(res.status).toBe(200);
    expect(bodyOf(res).data).toEqual({
      configured: false,
      version: null,
      environment: "TEST",
      taxIdentityLocked: false,
      profile: null,
      logo: null,
      logoMaxBytes: TEST_LOGO_MAX_BYTES,
      updatedAt: null,
    });
  });

  it("registra los datos y responde la versión con la lista permitida", async () => {
    const res = await call("put", "/taxpayer", "adminA").send({
      ...PROFILE,
      expectedVersion: null,
    });
    expect(res.status).toBe(200);
    expect(bodyOf(res).data).toMatchObject({
      configured: true,
      version: 1,
      environment: "TEST",
      taxIdentityLocked: false,
      logo: null,
      profile: { ...PROFILE, tradeName: null, providerRuc: null, largeTaxpayer: false },
    });
    expect(Object.keys(bodyOf(res).data).sort()).toEqual(
      [
        "configured",
        "environment",
        "logo",
        "logoMaxBytes",
        "profile",
        "taxIdentityLocked",
        "updatedAt",
        "version",
      ].sort(),
    );
  });

  it("rechaza companyId, el ambiente o el bloqueo dentro del perfil", async () => {
    for (const extra of [
      { companyId: "otra" },
      { environment: "PRODUCTION" },
      { taxIdentityLocked: false },
    ]) {
      const res = await call("put", "/taxpayer", "adminA").send({
        ...PROFILE,
        expectedVersion: 1,
        ...extra,
      });
      expect(res.status, JSON.stringify(extra)).toBe(400);
      expect(bodyOf(res).error.message).toBe("La solicitud contiene campos no permitidos.");
    }
  });

  it("indica el campo inválido en el mensaje", async () => {
    const res = await call("put", "/taxpayer", "adminA").send({
      ...PROFILE,
      ruc: "123",
      expectedVersion: 1,
    });
    expect(res.status).toBe(400);
    expect(bodyOf(res).error.message).toBe("El RUC debe tener 13 dígitos y terminar en 001.");
  });

  it("responde 409 con una versión desactualizada", async () => {
    const res = await call("put", "/taxpayer", "adminA").send({
      ...PROFILE,
      legalName: "Otra S.A.",
      expectedVersion: null,
    });
    expect(res.status).toBe(409);
    expect(bodyOf(res).error.code).toBe("CONFIG_VERSION_CONFLICT");
  });

  it("cambia el ambiente por su propia ruta", async () => {
    const res = await call("put", "/taxpayer/environment", "adminA").send({
      environment: "PRODUCTION",
      expectedVersion: 1,
    });
    expect(res.status).toBe(200);
    expect(bodyOf(res).data).toMatchObject({ version: 2, environment: "PRODUCTION" });
  });

  it("el operador recibe 403 en las tres rutas y cada intento es un evento de seguridad", async () => {
    const before = api.events.length;
    const attempts = [
      call("get", "/taxpayer", "operatorA"),
      call("put", "/taxpayer", "operatorA").send({ ...PROFILE, expectedVersion: 2 }),
      call("put", "/taxpayer/environment", "operatorA").send({
        environment: "TEST",
        expectedVersion: 2,
      }),
    ];
    for (const attempt of attempts) expect((await attempt).status).toBe(403);
    expect(
      api.events
        .slice(before)
        .filter((event) => event.type === "authorization_denied" && event.status === 403),
    ).toHaveLength(3);
  });

  it("cada empresa ve solo su configuración", async () => {
    const res = await call("get", "/taxpayer", "adminB");
    expect(bodyOf(res).data).toMatchObject({ configured: false, environment: "TEST" });
  });
});
