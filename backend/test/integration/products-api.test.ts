// API de productos con dos empresas (add-parties-and-products, specs `products` y `audit-trail`):
// precio exacto sin impuestos, referencias fiscales validadas con la disponibilidad de `catalogs`,
// estado tributario derivado que sigue a la habilitación y a la vigencia sin tocar las referencias,
// coherencia del tipo sobre el estado final, unicidad del código con altas simultáneas, corrección
// con versión, búsqueda, recuentos, permisos, aislamiento y auditoría.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProductTaxSummaryView, ProductView } from "@facturador/contracts";
import { DATASET_FILES } from "../../src/modules/catalogs/datasets/index.ts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { createMember } from "./auth-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertCompany } from "./fixtures.ts";
import { buildTaxpayerApp, sessionCookie } from "./taxpayer-harness.ts";

type Body = {
  data: ProductView & ProductView[] & ProductTaxSummaryView;
  meta?: { page: number; pageSize: number; total: number };
  error: { code: string; message: string };
};
const bodyOf = (res: { body: unknown }) => res.body as Body;
// 10:00 del 3 de octubre de 2026 en Ecuador.
const NOW = new Date("2026-10-03T15:00:00Z");
const IVA = 2;

describe("API de productos", () => {
  let db: MigratedSchema;
  let api: ReturnType<typeof buildTaxpayerApp>;
  let companyA: string;
  let companyB: string;
  let now = NOW;
  const cookies: Record<string, string> = {};

  const call = (who: string, method: "get" | "post" | "put", path: string) =>
    request(api.app)[method](`/api/v1${path}`).set("Cookie", cookies[who]!);
  const create = (who: string, body: Record<string, unknown>) =>
    call(who, "post", "/products").send(body);
  const get = async (who: string, id: string) =>
    bodyOf(await call(who, "get", `/products/${id}`)).data;
  const list = async (who: string, query = "") =>
    bodyOf(await call(who, "get", `/products${query}`));
  const summary = async (who: string) =>
    bodyOf(await call(who, "get", "/products/tax-summary")).data;
  const enable = (who: string, catalog: string, key: string, enabled: boolean) =>
    call(who, "put", `/fiscal-catalogs/${catalog}/entries/${key}/enablement`).send({ enabled });
  const audits = (companyId: string) =>
    db.database.prisma.auditEvent.findMany({
      where: { companyId, action: { startsWith: "product." } },
      orderBy: { occurredAt: "asc" },
    });
  const product = (overrides: Record<string, unknown> = {}) => ({
    kind: "GOOD",
    name: "Cemento 50 kg",
    unitPrice: "8.75",
    taxes: { iva: "4" },
    ...overrides,
  });
  async function created(who: string, overrides: Record<string, unknown>) {
    const res = await create(who, product(overrides));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return bodyOf(res).data;
  }
  const update = (who: string, view: ProductView, overrides: Record<string, unknown>) =>
    call(who, "put", `/products/${view.id}`).send({
      kind: view.kind,
      mainCode: view.mainCode,
      auxiliaryCode: view.auxiliaryCode,
      name: view.name,
      description: view.description,
      unitPrice: view.unitPrice,
      stockTracked: view.stockTracked,
      taxes: Object.fromEntries(view.taxes.map((t) => [t.slot, t.entryKey])),
      expectedVersion: view.version,
      ...overrides,
    });

  beforeAll(async () => {
    db = await createMigratedSchema("products_api");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    api = buildTaxpayerApp(db, { now: () => now });
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

  describe("catálogo y precio", () => {
    it("registra un bien con su precio sin impuestos y su IVA, listo para facturar", async () => {
      const view = await created("operatorA", { mainCode: "CEM-50" });
      expect(view).toMatchObject({
        kind: "GOOD",
        mainCode: "CEM-50",
        unitPrice: "8.75",
        stockTracked: false,
        status: "ACTIVE",
        version: 1,
        taxConfiguration: { status: "READY", reasons: [], evaluatedOn: "2026-10-03" },
      });
      expect(view.taxes).toEqual([
        {
          slot: "iva",
          catalogType: "iva-rate",
          entryKey: "4",
          code: "4",
          officialLabel: "15%",
          rate: { taxKind: "IVA", sriTaxCode: "2", rateKind: "PERCENTAGE", percentage: "15" },
          usable: true,
          reason: null,
        },
      ]);
      expect(view).not.toHaveProperty("total");
    });

    it("un servicio sin código principal se crea; los datos fuera de límites se rechazan", async () => {
      expect(
        (await create("adminA", product({ kind: "SERVICE", name: "Instalación" }))).status,
      ).toBe(201);
      for (const body of [
        product({ name: "" }),
        product({ mainCode: "X".repeat(26) }),
        product({ mainCode: "A\nB" }),
      ]) {
        expect((await create("adminA", body)).status).toBe(400);
      }
    });

    it("el precio es exacto: límites, forma canónica y rechazos sin redondear", async () => {
      for (const [unitPrice, stored] of [
        ["0", "0"],
        ["0.000001", "0.000001"],
        ["0.123456", "0.123456"],
        ["999999999999999999", "999999999999999999"],
        ["999999999999.999999", "999999999999.999999"],
        ["12.50", "12.5"],
        ["10", "10"],
      ]) {
        const view = await created("adminA", { unitPrice });
        expect(view.unitPrice).toBe(stored);
        expect((await get("adminA", view.id)).unitPrice).toBe(stored);
      }
      const message = async (unitPrice: unknown) =>
        bodyOf(await create("adminA", product({ unitPrice }))).error.message;
      expect(await message("1000000000000000000")).toBe("Admite como máximo 18 dígitos enteros.");
      expect(await message("1234567890123.123456")).toBe("Admite como máximo 18 dígitos en total.");
      expect(await message("1.1234567")).toBe("Admite como máximo 6 decimales.");
      expect(await message("1.1234560")).toBe("Admite como máximo 6 decimales.");
      for (const bad of [12.5, "-1", "1e3", "1,50", "01.5"]) {
        expect((await create("adminA", product({ unitPrice: bad }))).status, String(bad)).toBe(400);
      }
    });
  });

  describe("impuestos", () => {
    it("el IVA es obligatorio, uno como máximo de cada impuesto y nunca un porcentaje", async () => {
      expect(bodyOf(await create("adminA", product({ taxes: {} }))).error.message).toBe(
        "La tarifa de IVA es obligatoria.",
      );
      expect(
        (await create("adminA", product({ taxes: { iva: "4", ice: ["3011", "3021"] } }))).status,
      ).toBe(400);
      expect((await create("adminA", product({ taxes: { iva: "15%" } }))).status).toBe(400);
      expect((await create("adminA", product({ taxes: { iva: 15 } }))).status).toBe(400);
    });

    it("el IRBPNR en un servicio se rechaza con un código estable", async () => {
      await enable("adminA", "irbpnr-rate", "5001", true);
      const res = await create(
        "adminA",
        product({ kind: "SERVICE", taxes: { iva: "4", irbpnr: "5001" } }),
      );
      expect(bodyOf(res).error).toMatchObject({ code: "PRODUCT_GOODS_ONLY" });
      expect(bodyOf(res).error.message).toContain("IRBPNR");
    });

    it("un ICE no habilitado se rechaza y, habilitado, se acepta y refiere su variante exacta", async () => {
      const refused = await create(
        "adminA",
        product({ taxes: { iva: "4", ice: "3041-GRAN-ESCALA" } }),
      );
      expect(bodyOf(refused).error).toMatchObject({ code: "PRODUCT_TAX_UNAVAILABLE" });
      expect(bodyOf(refused).error.message).toContain("no está habilitada");
      await enable("adminA", "ice-rate", "3041-GRAN-ESCALA", true);
      const view = await created("adminA", {
        name: "Cerveza",
        taxes: { iva: "4", ice: "3041-GRAN-ESCALA" },
      });
      expect(view.taxes[1]).toMatchObject({
        slot: "ice",
        code: "3041",
        entryKey: "3041-GRAN-ESCALA",
      });
      expect(view.taxConfiguration).toMatchObject({
        status: "INCOMPLETE",
        reasons: [{ slot: "ice", code: "3041", reason: "NO_CALCULATION_DATA" }],
      });
    });

    it("una entrada inexistente se rechaza", async () => {
      expect(bodyOf(await create("adminA", product({ taxes: { iva: "99" } }))).error.code).toBe(
        "PRODUCT_TAX_UNAVAILABLE",
      );
    });
  });

  describe("estado tributario", () => {
    it("IRBPNR e IVA diferenciado sin datos de cálculo quedan INCOMPLETE; se guardan igual", async () => {
      const bottle = await created("adminA", { name: "Agua", taxes: { iva: "4", irbpnr: "5001" } });
      expect(bottle.taxConfiguration).toMatchObject({
        status: "INCOMPLETE",
        reasons: [{ slot: "irbpnr", reason: "NO_CALCULATION_DATA" }],
      });
      expect(
        (await created("adminA", { name: "Diferenciado", taxes: { iva: "8" } })).taxConfiguration
          .status,
      ).toBe("INCOMPLETE");
    });

    it("deshabilitar la tarifa que usa un producto lo deja en revisión sin tocar su referencia", async () => {
      const view = await created("adminA", {
        name: "Doce",
        mainCode: "DOCE-1",
        taxes: { iva: "2" },
      });
      await enable("adminA", "iva-rate", "2", false);
      const review = await get("adminA", view.id);
      expect(review.taxConfiguration).toMatchObject({
        status: "REVIEW_REQUIRED",
        reasons: [{ slot: "iva", entryKey: "2", reason: "DISABLED" }],
      });
      expect(review.taxes[0]).toMatchObject({ entryKey: "2", usable: false, reason: "DISABLED" });
      expect(review.version).toBe(1);

      // Corregir el precio sin tocar los impuestos se acepta y sigue en revisión.
      const fixed = await update("adminA", review, { unitPrice: "9.10" });
      expect(bodyOf(fixed).data).toMatchObject({
        unitPrice: "9.1",
        taxConfiguration: { status: "REVIEW_REQUIRED" },
      });
      expect(bodyOf(fixed).data.taxes[0]!.entryKey).toBe("2");

      const filtered = await list("adminA", "?taxStatus=REVIEW_REQUIRED&pageSize=100");
      expect(filtered.data.map((p) => p.id)).toContain(view.id);
      expect(filtered.data.every((p) => p.taxConfiguration.status === "REVIEW_REQUIRED")).toBe(
        true,
      );
      expect(filtered.meta!.total).toBe(filtered.data.length);

      await enable("adminA", "iva-rate", "2", true);
      expect((await get("adminA", view.id)).taxConfiguration.status).toBe("READY");
    });
  });

  describe("coherencia entre el tipo, el control de stock y el IRBPNR", () => {
    it("de bien a servicio conservando el IRBPNR o el control de stock se rechaza; quitándolos se acepta", async () => {
      const good = await created("adminA", {
        name: "Bebida",
        stockTracked: true,
        taxes: { iva: "4", irbpnr: "5001" },
      });
      const keepIrbpnr = await update("adminA", good, { kind: "SERVICE", stockTracked: false });
      expect(bodyOf(keepIrbpnr).error).toMatchObject({ code: "PRODUCT_GOODS_ONLY" });
      expect(bodyOf(keepIrbpnr).error.message).toContain("IRBPNR");
      const keepStock = await update("adminA", good, {
        kind: "SERVICE",
        taxes: { iva: "4", irbpnr: null },
      });
      expect(bodyOf(keepStock).error.message).toContain("control de stock");
      expect(await get("adminA", good.id)).toMatchObject({
        kind: "GOOD",
        stockTracked: true,
        version: 1,
      });

      const ok = await update("adminA", good, {
        kind: "SERVICE",
        stockTracked: false,
        taxes: { iva: "4", irbpnr: null },
      });
      expect(bodyOf(ok).data).toMatchObject({ kind: "SERVICE", stockTracked: false, version: 2 });
      expect(bodyOf(ok).data.taxes.map((t) => t.slot)).toEqual(["iva"]);
    });

    it("un servicio con control de stock se rechaza", async () => {
      expect(
        bodyOf(await create("adminA", product({ kind: "SERVICE", stockTracked: true }))).error.code,
      ).toBe("PRODUCT_GOODS_ONLY");
    });
  });

  describe("código principal", () => {
    it("repetido, también si está desactivado, se rechaza; sin código no chocan; otra empresa lo puede usar", async () => {
      expect(bodyOf(await create("adminA", product({ mainCode: "CEM-50" }))).error.code).toBe(
        "PRODUCT_MAIN_CODE_TAKEN",
      );
      const inactive = await created("adminA", { mainCode: "BAJA-1" });
      await call("adminA", "put", `/products/${inactive.id}/status`).send({ status: "INACTIVE" });
      expect(bodyOf(await create("adminA", product({ mainCode: "BAJA-1" }))).error.code).toBe(
        "PRODUCT_MAIN_CODE_TAKEN",
      );
      expect((await create("adminA", product({ name: "Sin código 1" }))).status).toBe(201);
      expect((await create("adminA", product({ name: "Sin código 2" }))).status).toBe(201);
      expect((await create("adminB", product({ mainCode: "CEM-50" }))).status).toBe(201);
    });

    it("dos altas simultáneas con el mismo código dejan exactamente un producto", async () => {
      const body = product({ mainCode: "SIM-1" });
      const results = await Promise.all([create("adminA", body), create("adminA2", body)]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(results.find((r) => r.status === 409)!.body).toMatchObject({
        error: { code: "PRODUCT_MAIN_CODE_TAKEN" },
      });
      expect(
        await db.database.prisma.product.count({
          where: { companyId: companyA, mainCode: "SIM-1" },
        }),
      ).toBe(1);
    });
  });

  describe("corrección y estado", () => {
    it("versión desactualizada y correcciones simultáneas: se aplica exactamente una", async () => {
      const view = await created("adminA", { mainCode: "CORR-1" });
      expect(bodyOf(await update("adminA", view, { name: "Corregido" })).data.version).toBe(2);
      expect(bodyOf(await update("adminA2", view, { name: "Pisado" })).error.code).toBe(
        "PRODUCT_CHANGED",
      );
      const fresh = await get("adminA", view.id);
      const results = await Promise.all([
        update("adminA", fresh, { name: "Uno" }),
        update("adminA2", fresh, { name: "Dos" }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect((await get("adminA", view.id)).version).toBe(3);
    });

    it("desactiva, reactiva y repetir no cambia nada", async () => {
      const view = await created("adminA", { mainCode: "EST-1", name: "Estado" });
      await call("adminA", "put", `/products/${view.id}/status`).send({ status: "INACTIVE" });
      expect((await list("adminA", "?search=est-1")).data).toEqual([]);
      expect((await list("adminA", "?search=est-1&status=INACTIVE")).data.map((p) => p.id)).toEqual(
        [view.id],
      );
      const again = await call("adminA", "put", `/products/${view.id}/status`).send({
        status: "INACTIVE",
      });
      expect(bodyOf(again).data).toMatchObject({ status: "INACTIVE", version: 2 });
      await call("adminA", "put", `/products/${view.id}/status`).send({ status: "ACTIVE" });
      expect((await list("adminA", "?search=est-1")).data.map((p) => p.id)).toEqual([view.id]);
    });
  });

  describe("búsqueda", () => {
    it("por prefijo de código principal o auxiliar sin mayúsculas, y por nombre sin tildes", async () => {
      await created("adminA", { mainCode: "ZZ-PRINC", name: "Primero" });
      await created("adminA", { auxiliaryCode: "zz-aux", name: "Segundo" });
      await created("adminA", { name: "Café molido" });
      const names = (await list("adminA", "?search=ZZ")).data.map((p) => p.name).sort();
      expect(names).toEqual(["Primero", "Segundo"]);
      expect((await list("adminA", "?search=cafe")).data.map((p) => p.name)).toEqual([
        "Café molido",
      ]);
    });

    it("orden estable al recorrer las páginas aunque el nombre se repita", async () => {
      for (let i = 0; i < 5; i += 1) await created("adminA", { name: "Repetido" });
      const walk = async () => {
        const ids: string[] = [];
        for (let page = 1; page <= 3; page += 1) {
          const body = await list("adminA", `?search=repetido&pageSize=2&page=${page}`);
          expect(body.meta).toMatchObject({ page, total: 5 });
          ids.push(...body.data.map((p) => p.id));
        }
        return ids;
      };
      const first = await walk();
      expect(new Set(first).size).toBe(5);
      expect(await walk()).toEqual(first);
    });
  });

  describe("recuentos para Catálogos fiscales", () => {
    it("cuenta productos activos por entrada y por estado, sin los desactivados ni los de otra empresa", async () => {
      const ids = [];
      for (let i = 0; i < 3; i += 1) {
        ids.push((await created("adminA", { name: `Catorce ${i}`, taxes: { iva: "3" } })).id);
      }
      const off = await created("adminA", { name: "Catorce inactivo", taxes: { iva: "3" } });
      await call("adminA", "put", `/products/${off.id}/status`).send({ status: "INACTIVE" });
      await created("adminB", { name: "Catorce de B", taxes: { iva: "3" } });
      const counts = await summary("adminA");
      expect(
        counts.byEntry.find((e) => e.catalogType === "iva-rate" && e.entryKey === "3"),
      ).toEqual({
        catalogType: "iva-rate",
        entryKey: "3",
        activeProducts: 3,
      });
      expect(
        (await summary("adminB")).byEntry.find((e) => e.entryKey === "3")!.activeProducts,
      ).toBe(1);
      const before = counts.byStatus.REVIEW_REQUIRED;
      await enable("adminA", "iva-rate", "3", false);
      expect((await summary("adminA")).byStatus.REVIEW_REQUIRED).toBe(before + 3);
      expect((await summary("adminB")).byStatus.REVIEW_REQUIRED).toBe(0);
      await enable("adminA", "iva-rate", "3", true);
    });
  });

  describe("permisos y aislamiento", () => {
    it("el operador registra pero no desactiva", async () => {
      const view = await created("operatorA", { name: "Del operador" });
      expect(
        (await call("operatorA", "put", `/products/${view.id}/status`).send({ status: "INACTIVE" }))
          .status,
      ).toBe(403);
      expect((await get("adminA", view.id)).status).toBe("ACTIVE");
    });

    it("un producto de otra empresa responde como inexistente; un companyId en el cuerpo se rechaza", async () => {
      const fromB = await created("adminB", { name: "Solo de B", mainCode: "SOLO-B" });
      expect(bodyOf(await call("adminA", "get", `/products/${fromB.id}`)).error.code).toBe(
        "PRODUCT_NOT_FOUND",
      );
      expect((await update("adminA", fromB, { name: "X" })).status).toBe(404);
      expect(
        (await call("adminA", "put", `/products/${fromB.id}/status`).send({ status: "INACTIVE" }))
          .status,
      ).toBe(404);
      expect((await list("adminA", "?search=solo-b")).data).toEqual([]);
      expect(await get("adminB", fromB.id)).toMatchObject({ name: "Solo de B", version: 1 });
      expect((await create("adminA", product({ companyId: companyB }))).status).toBe(400);
    });
  });

  describe("auditoría", () => {
    it("registra el alta, el precio y los impuestos; una corrección solo descriptiva no", async () => {
      const view = await created("adminA", { mainCode: "AUD-1", name: "Auditado" });
      await update("adminA", view, { name: "Solo el nombre", description: "Nota interna" });
      const fresh = await get("adminA", view.id);
      await update("adminA", fresh, { unitPrice: "9.10", taxes: { iva: "2" } });
      const events = (await audits(companyA)).filter(
        (e) => (e.changes as { productId?: string }).productId === view.id,
      );
      expect(events.map((e) => e.action)).toEqual(["product.created", "product.updated"]);
      expect(events[0]!.changes).toMatchObject({
        mainCode: "AUD-1",
        kind: "GOOD",
        unitPrice: "8.75",
        "taxes.iva": "4",
        "taxes.ice": null,
      });
      expect(events[1]!.changes).toEqual({
        productId: view.id,
        "unitPrice.from": "8.75",
        "unitPrice.to": "9.1",
        "taxes.iva.from": "4",
        "taxes.iva.to": "2",
      });
    });

    it("los cambios rechazados no registran eventos", async () => {
      const view = await created("adminA", { mainCode: "AUD-2" });
      const count = async () => (await audits(companyA)).length;
      const before = await count();
      await create("adminA", product({ mainCode: "AUD-2" }));
      await create("adminA", product({ unitPrice: "1.1234567" }));
      await create("adminA", product({ taxes: { iva: "4", ice: "3021" } }));
      await update("adminA", { ...view, version: 9 }, { unitPrice: "1" });
      await call("operatorA", "put", `/products/${view.id}/status`).send({ status: "INACTIVE" });
      expect(await count()).toBe(before);
    });
  });

  describe("versiones posteriores de los catálogos", () => {
    it("una entrada sin versión aplicable hoy se rechaza; el cierre de una vigencia deja el producto en revisión", async () => {
      const fourteen = await created("adminA", {
        name: "Catorce cerrado",
        mainCode: "IVA14",
        taxes: { iva: "3" },
      });
      const iva = structuredClone(DATASET_FILES[IVA]) as {
        version: number;
        entries: Record<string, unknown>[];
      };
      iva.version = 2;
      iva.entries[2] = { ...iva.entries[2]!, effectiveTo: "2026-10-31" };
      iva.entries.push({
        ...iva.entries[4]!,
        entryKey: "11",
        code: "11",
        officialLabel: "16%",
        percentage: "16",
        effectiveFrom: "2027-01-01",
      });
      await loadInstalledFiscalCatalogs(db.database.prisma, [...DATASET_FILES, iva]);
      expect(
        bodyOf(await create("adminA", product({ taxes: { iva: "11" } }))).error.message,
      ).toContain("no tiene una versión vigente hoy");
      now = new Date("2026-10-31T15:00:00Z");
      expect((await get("adminA", fourteen.id)).taxConfiguration.status).toBe("READY");
      now = new Date("2026-11-01T15:00:00Z");
      const later = await get("adminA", fourteen.id);
      expect(later.taxConfiguration).toMatchObject({
        status: "REVIEW_REQUIRED",
        reasons: [{ slot: "iva", entryKey: "3", reason: "NOT_IN_FORCE" }],
        evaluatedOn: "2026-11-01",
      });
      expect(later.taxes[0]).toMatchObject({ entryKey: "3", officialLabel: "14%" });
      now = NOW;
    });
  });
});
