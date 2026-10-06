// Proveedores que pueden ser sujeto retenido (add-withholding-receipts, tarea 6.1, design D3 y D21):
// el puerto `WithheldPartyReader` sobre la lectura de terceros de `parties`, compuesto como en
// `main.ts`, y la búsqueda `/withholding-receipts/suppliers`. Solo proveedores activos con RUC,
// cédula o pasaporte de la empresa de la sesión; nunca el consumidor final, un cliente sin el rol de
// proveedor, uno inactivo, uno con identificación del exterior ni el de otra empresa.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { WithholdingSupplierView } from "@facturador/contracts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { supplierReader } from "../../src/modules/parties/infrastructure/index.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { readyCompany, type ReadyCompany } from "./emission-harness.ts";
import { buildTaxpayerApp } from "./taxpayer-harness.ts";

type Body = {
  data: WithholdingSupplierView[];
  meta: { page: number; pageSize: number; total: number };
  error: { code: string };
};
const bodyOf = (res: { body: unknown }) => res.body as Body;

describe("proveedores que pueden ser sujeto retenido", () => {
  let db: MigratedSchema;
  let api: ReturnType<typeof buildTaxpayerApp>;
  let a: ReadyCompany;
  let b: ReadyCompany;

  const party = (
    company: ReadyCompany,
    identificationType: string,
    identification: string,
    legalName: string,
    extra: { roles?: string[]; status?: string } = {},
  ) =>
    db.database.prisma.party.create({
      data: {
        companyId: company.companyId,
        identificationType,
        identification,
        legalName,
        roles: extra.roles ?? ["SUPPLIER"],
        status: extra.status ?? "ACTIVE",
        searchName: legalName.toLowerCase(),
        searchIdentification: identification.toLowerCase(),
        createdBy: company.adminId,
        updatedBy: company.adminId,
      },
    });
  const search = (cookie: string, query = "") =>
    request(api.app).get(`/api/v1/withholding-receipts/suppliers${query}`).set("Cookie", cookie);

  beforeAll(async () => {
    db = await createMigratedSchema("withholding_suppliers");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    api = buildTaxpayerApp(db);
    a = await readyCompany(api, db, { slug: "retencion-proveedores-a" });
    b = await readyCompany(api, db, { slug: "retencion-proveedores-b" });
    await party(a, "05", "1710034065", "Ana Cédula Proveedora");
    await party(a, "06", "PAS123456", "John Passport Supplier");
    await party(a, "04", "1799999999001", "Mixta Cliente y Proveedor", {
      roles: ["CUSTOMER", "SUPPLIER"],
    });
    await party(a, "08", "EXT-998877", "Foreign Supplier LLC");
    await party(a, "04", "1798888888001", "Proveedor Inactivo S.A.", { status: "INACTIVE" });
    await party(a, "05", "0912345678", "Solo Cliente", { roles: ["CUSTOMER"] });
    await party(b, "04", "1797777777001", "Proveedor de la Empresa B");
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it("devuelve solo los proveedores activos con RUC, cédula o pasaporte de la empresa", async () => {
    const res = await search(a.cookies.operator);
    expect(res.status).toBe(200);
    expect(bodyOf(res).data.map((s) => [s.identificationType, s.legalName])).toEqual([
      ["05", "Ana Cédula Proveedora"],
      ["06", "John Passport Supplier"],
      ["04", "Mixta Cliente y Proveedor"],
      ["04", "PROVEEDORA DEL SUR S.A."],
    ]);
    expect(bodyOf(res).meta).toEqual({ page: 1, pageSize: 25, total: 4 });
    expect(Object.keys(bodyOf(res).data[0]!).sort()).toEqual([
      "id",
      "identification",
      "identificationType",
      "legalName",
    ]);
  });

  it("nunca ofrece el consumidor final, un cliente, uno inactivo ni uno del exterior", async () => {
    const names = bodyOf(await search(a.cookies.admin)).data.map((s) => s.legalName);
    expect(names).not.toContain("CONSUMIDOR FINAL");
    expect(names).not.toContain("Solo Cliente");
    expect(names).not.toContain("Proveedor Inactivo S.A.");
    expect(names).not.toContain("Foreign Supplier LLC");
    expect(names).not.toContain("EL PERNO CIA. LTDA.");
  });

  it("busca por identificación o por razón social, con paginación", async () => {
    expect(
      bodyOf(await search(a.cookies.operator, "?search=1710")).data.map((s) => s.legalName),
    ).toEqual(["Ana Cédula Proveedora"]);
    expect(
      bodyOf(await search(a.cookies.operator, "?search=proveedora")).data.map((s) => s.legalName),
    ).toEqual(["Ana Cédula Proveedora", "PROVEEDORA DEL SUR S.A."]);
    const page = bodyOf(await search(a.cookies.operator, "?pageSize=1&page=2"));
    expect(page.data.map((s) => s.legalName)).toEqual(["John Passport Supplier"]);
    expect(page.meta).toEqual({ page: 2, pageSize: 1, total: 4 });
  });

  it("otra empresa no se filtra en ninguna dirección", async () => {
    expect(bodyOf(await search(a.cookies.operator, "?search=empresa b")).data).toEqual([]);
    expect(bodyOf(await search(b.cookies.operator)).data.map((s) => s.legalName)).toEqual([
      "Proveedor de la Empresa B",
      "PROVEEDORA DEL SUR S.A.",
    ]);
    expect(
      bodyOf(await search(b.cookies.operator, `?search=${encodeURIComponent("Ana Cédula")}`)).data,
    ).toEqual([]);
  });

  it("el puerto lee un tercero por empresa e identificador, con su rol y si es el consumidor final", async () => {
    const reader = supplierReader(db.database.prisma);
    expect(await reader.find(a.companyId, a.supplierId)).toEqual({
      id: a.supplierId,
      status: "ACTIVE",
      identificationType: "04",
      identification: "1791234567001",
      legalName: "PROVEEDORA DEL SUR S.A.",
      roles: ["SUPPLIER"],
      consumerFinal: false,
    });
    expect(await reader.find(a.companyId, a.consumerFinalId)).toMatchObject({
      identificationType: "07",
      consumerFinal: true,
    });
    expect(await reader.find(b.companyId, a.supplierId)).toBeNull();
  });

  it("sin sesión responde 401", async () => {
    expect((await request(api.app).get("/api/v1/withholding-receipts/suppliers")).status).toBe(401);
  });
});
