// API de establecimientos y puntos de emisión (design D12): permisos por rol, aislamiento por
// empresa, rutas anidadas, campos no permitidos y lista con disponibilidad.
import request from "../support/http-client.ts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMember, type AuthApp } from "./auth-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertCompany } from "./fixtures.ts";
import { buildTaxpayerApp, sessionCookie } from "./taxpayer-harness.ts";

type Establishment = {
  id: string;
  code: string;
  address: string;
  status: string;
  emissionPoints: { id: string; code: string; status: string; available: boolean }[];
};
type Body = { data: unknown; error: { code: string; message: string } };
const bodyOf = (res: { body: unknown }) => res.body as Body;

describe("API de establecimientos y puntos de emisión", () => {
  let db: MigratedSchema;
  let api: AuthApp;
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    db = await createMigratedSchema("establishments_api");
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
  });

  afterAll(async () => {
    await db.drop();
  });

  const call = (method: "get" | "post" | "put", path: string, who: string) =>
    request(api.app)[method](`/api/v1${path}`).set("Cookie", cookies[who]!);

  it("el administrador crea establecimientos y puntos", async () => {
    const second = await call("post", "/establishments", "adminA").send({
      code: "002",
      address: "Guayaquil",
    });
    const first = await call("post", "/establishments", "adminA").send({
      code: "001",
      address: "Quito",
    });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    ids.first = (bodyOf(first).data as Establishment).id;
    ids.second = (bodyOf(second).data as Establishment).id;
    const point = await call("post", `/establishments/${ids.first}/emission-points`, "adminA").send(
      { code: "001" },
    );
    expect(point.status).toBe(201);
    expect(bodyOf(point).data).toMatchObject({ code: "001", status: "ACTIVE", available: true });
    ids.point = (bodyOf(point).data as { id: string }).id;
    const other = await call("post", "/establishments", "adminB").send({
      code: "001",
      address: "Cuenca",
    });
    ids.other = (bodyOf(other).data as Establishment).id;
  });

  it("el operador lista los establecimientos ordenados por código con su disponibilidad", async () => {
    const res = await call("get", "/establishments", "operatorA");
    expect(res.status).toBe(200);
    const list = bodyOf(res).data as Establishment[];
    expect(list.map((e) => e.code)).toEqual(["001", "002"]);
    expect(list[0]!.emissionPoints).toEqual([
      { id: ids.point, code: "001", status: "ACTIVE", available: true },
    ]);
    expect(Object.keys(list[0]!).sort()).toEqual([
      "address",
      "code",
      "emissionPoints",
      "id",
      "status",
    ]);
  });

  it("el operador recibe 403 en cada mutación y cada intento es un evento de seguridad", async () => {
    const before = api.events.length;
    const attempts = [
      call("post", "/establishments", "operatorA").send({ code: "003", address: "Loja" }),
      call("put", `/establishments/${ids.first}`, "operatorA").send({ address: "Otra" }),
      call("put", `/establishments/${ids.first}/status`, "operatorA").send({ status: "INACTIVE" }),
      call("post", `/establishments/${ids.first}/emission-points`, "operatorA").send({
        code: "002",
      }),
      call(
        "put",
        `/establishments/${ids.first}/emission-points/${ids.point}/status`,
        "operatorA",
      ).send({ status: "INACTIVE" }),
    ];
    for (const attempt of attempts) expect((await attempt).status).toBe(403);
    expect(
      api.events.slice(before).filter((e) => e.type === "authorization_denied" && e.status === 403),
    ).toHaveLength(5);
  });

  it("un establecimiento de otra empresa responde 404 con un evento de seguridad", async () => {
    const before = api.events.length;
    const res = await call("put", `/establishments/${ids.other}`, "adminA").send({
      address: "Robada",
    });
    expect(res.status).toBe(404);
    expect(bodyOf(res).error.code).toBe("ESTABLISHMENT_NOT_FOUND");
    const status = await call("put", `/establishments/${ids.other}/status`, "adminA").send({
      status: "INACTIVE",
    });
    expect(status.status).toBe(404);
    expect(
      api.events.slice(before).filter((e) => e.type === "authorization_denied" && e.status === 404),
    ).toHaveLength(2);
    const list = bodyOf(await call("get", "/establishments", "adminB")).data as Establishment[];
    expect(list[0]).toMatchObject({ address: "Cuenca", status: "ACTIVE" });
  });

  it("un punto pedido bajo otro establecimiento responde 404", async () => {
    const res = await call(
      "put",
      `/establishments/${ids.second}/emission-points/${ids.point}/status`,
      "adminA",
    ).send({ status: "INACTIVE" });
    expect(res.status).toBe(404);
    expect(bodyOf(res).error.code).toBe("EMISSION_POINT_NOT_FOUND");
  });

  it("rechaza companyId y code en la corrección de la dirección", async () => {
    for (const extra of [{ companyId: "otra" }, { code: "009" }]) {
      const res = await call("put", `/establishments/${ids.first}`, "adminA").send({
        address: "Quito centro",
        ...extra,
      });
      expect(res.status, JSON.stringify(extra)).toBe(400);
      expect(bodyOf(res).error.message).toBe("La solicitud contiene campos no permitidos.");
    }
  });

  it("ninguna ruta cambia el código ni el establecimiento de un punto", async () => {
    const res = await call(
      "put",
      `/establishments/${ids.first}/emission-points/${ids.point}`,
      "adminA",
    ).send({ code: "009" });
    expect(res.status).toBe(404);
    expect(bodyOf(res).error.code).toBe("ROUTE_NOT_FOUND");
  });

  it("responde 409 por código duplicado y 400 por formato", async () => {
    const duplicate = await call("post", "/establishments", "adminA").send({
      code: "001",
      address: "Otra",
    });
    expect(duplicate.status).toBe(409);
    expect(bodyOf(duplicate).error.message).toBe("Ya existe un establecimiento con el código 001.");
    const invalid = await call("post", "/establishments", "adminA").send({
      code: "1",
      address: "Otra",
    });
    expect(invalid.status).toBe(400);
    expect(bodyOf(invalid).error.message).toBe("El código debe tener exactamente tres dígitos.");
  });

  it("desactivar el establecimiento deja sus puntos no disponibles en la lista", async () => {
    const res = await call("put", `/establishments/${ids.first}/status`, "adminA").send({
      status: "INACTIVE",
    });
    expect(res.status).toBe(200);
    expect(bodyOf(res).data).toMatchObject({
      status: "INACTIVE",
      emissionPoints: [{ status: "ACTIVE", available: false }],
    });
  });
});
