// Prueba end-to-end de add-parties-and-products (tarea 8.1, design D18) contra el backend real:
// arranca main.ts sobre un esquema vacío, que crea la empresa con su consumidor final, recorre por
// HTTP terceros, productos y la habilitación de su tarifa, y arranca otra vez sobre el mismo esquema.
import type { PartyView, ProductView } from "@facturador/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { startE2eBackend, type E2eBackend } from "./e2e-backend.ts";

const ADMIN = { email: "admin@e2e-terceros.ec", password: "contrasena-admin-e2e-1" };
const OPERATOR = {
  name: "Olga Operadora",
  email: "operador@e2e-terceros.ec",
  password: "contrasena-operador-e2e-1",
};

describe("flujo completo de terceros y productos", () => {
  let db: MigratedSchema;
  let backend: E2eBackend;

  const start = () => startE2eBackend({ label: "end_to_end_parties", admin: ADMIN, db });

  beforeAll(async () => {
    db = await createMigratedSchema("end_to_end_parties");
    backend = await start();
  }, 120_000);

  afterAll(async () => {
    await backend?.stop();
    await db?.drop();
  });

  async function signIn(email: string, password: string) {
    const { status, cookie } = await backend.signIn(email, password);
    expect(status).toBe(200);
    return cookie;
  }

  async function api<T>(method: string, path: string, cookie: string, body?: unknown) {
    const res = await backend.fetchApi(method, path, cookie, body);
    const json = (await res.json()) as { data: T; error?: { code: string } };
    return { status: res.status, data: json.data, error: json.error };
  }

  const consumerFinals = () =>
    db.database.prisma.party.findMany({ where: { systemRecord: "CONSUMER_FINAL" } });

  it("crea el consumidor final al arrancar, registra, revisa por la habilitación y no duplica al rearrancar", async () => {
    // 1. El arranque crea la empresa con su consumidor final.
    const company = await db.database.prisma.organization.findFirstOrThrow();
    const initial = await consumerFinals();
    expect(initial).toHaveLength(1);
    expect(initial[0]).toMatchObject({
      companyId: company.id,
      identificationType: "07",
      identification: "9999999999999",
      legalName: "CONSUMIDOR FINAL",
      status: "ACTIVE",
    });

    const admin = await signIn(ADMIN.email, ADMIN.password);
    expect((await api("POST", "/users", admin, { ...OPERATOR, role: "OPERATOR" })).status).toBe(
      201,
    );
    const operator = await signIn(OPERATOR.email, OPERATOR.password);

    // 2. El operador registra un tercero y un producto con IVA 15 %.
    const party = await api<PartyView>("POST", "/parties", operator, {
      identificationType: "04",
      identification: "1790012345001",
      legalName: "Comercial Andina S.A.",
      roles: ["CUSTOMER"],
    });
    expect(party).toMatchObject({ status: 201, data: { identificationTypeLabel: "RUC" } });
    const product = await api<ProductView>("POST", "/products", operator, {
      kind: "GOOD",
      mainCode: "CEM-50",
      name: "Cemento 50 kg",
      unitPrice: "8.75",
      taxes: { iva: "4" },
    });
    expect(product).toMatchObject({
      status: 201,
      data: { unitPrice: "8.75", taxConfiguration: { status: "READY" } },
    });

    // 3. El administrador deshabilita esa tarifa y el producto pasa a revisión, sin tocarlo.
    expect(
      (
        await api("PUT", "/fiscal-catalogs/iva-rate/entries/4/enablement", admin, {
          enabled: false,
        })
      ).status,
    ).toBe(200);
    const review = await api<ProductView>("GET", `/products/${product.data.id}`, operator);
    expect(review.data).toMatchObject({
      version: 1,
      taxConfiguration: {
        status: "REVIEW_REQUIRED",
        reasons: [{ slot: "iva", entryKey: "4", reason: "DISABLED" }],
      },
    });

    // 4. El operador no puede desactivar.
    expect(
      await api("PUT", `/parties/${party.data.id}/status`, operator, { status: "INACTIVE" }),
    ).toMatchObject({ status: 403, error: { code: "FORBIDDEN" } });
    expect(
      await api("PUT", `/products/${product.data.id}/status`, operator, { status: "INACTIVE" }),
    ).toMatchObject({ status: 403, error: { code: "FORBIDDEN" } });

    // 5. La auditoría tiene exactamente los eventos esperados; el consumidor final no se audita.
    const events = await db.database.prisma.auditEvent.findMany({
      orderBy: { occurredAt: "asc" },
    });
    expect(events.map((e) => [e.actorType, e.action])).toEqual([
      ["SYSTEM", "company.provisioned"],
      ["USER", "user.created"],
      ["USER", "party.created"],
      ["USER", "product.created"],
      ["USER", "fiscal_catalog.entry_disabled"],
    ]);

    // 6. Un segundo arranque no duplica ni modifica el consumidor final.
    await backend.stop();
    backend = await start();
    expect(await consumerFinals()).toEqual(initial);
    const again = await signIn(ADMIN.email, ADMIN.password);
    const search = await api<PartyView[]>("GET", "/parties?search=consumidor", again);
    expect(search.data).toHaveLength(1);
    expect(search.data[0]).toMatchObject({ systemRecord: "CONSUMER_FINAL" });
  }, 180_000);
});
