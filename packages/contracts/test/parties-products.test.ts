// Contratos de terceros, productos y paginación común (add-parties-and-products, tarea 1.1).
import { describe, expect, it } from "vitest";
import {
  changePartyStatusSchema,
  changeProductStatusSchema,
  createPartySchema,
  createProductSchema,
  listPartiesQuerySchema,
  listProductsQuerySchema,
  listUsersQuerySchema,
  updatePartySchema,
  updateProductSchema,
} from "@facturador/contracts";

const messages = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((issue) => issue.message) ?? [];

const party = {
  identificationType: "04",
  identification: "1790012345001",
  legalName: "Comercial Andina S.A.",
};
const product = {
  kind: "GOOD",
  name: "Cemento 50 kg",
  unitPrice: "8.75",
  taxes: { iva: "4" },
};

describe("contrato de terceros", () => {
  it("normaliza un alta válida: opcionales vacíos como null y roles canónicos sin duplicados", () => {
    const parsed = createPartySchema.parse({
      ...party,
      legalName: "  Comercial Andina S.A.  ",
      address: "",
      roles: ["SUPPLIER", "CUSTOMER", "SUPPLIER"],
    });
    expect(parsed).toEqual({
      ...party,
      address: null,
      email: null,
      phone: null,
      roles: ["CUSTOMER", "SUPPLIER"],
    });
    expect(createPartySchema.parse(party).roles).toEqual([]);
  });

  it("rechaza companyId y campos desconocidos en los cuerpos", () => {
    for (const [schema, body] of [
      [createPartySchema, party],
      [updatePartySchema, { ...party, expectedVersion: 1 }],
      [changePartyStatusSchema, { status: "INACTIVE" }],
    ] as const) {
      const result = schema.safeParse({ ...body, companyId: "otra" });
      expect(result.success).toBe(false);
      expect(messages(result)).toContain("La solicitud contiene campos no permitidos.");
    }
  });

  it("rechaza datos fuera de sus límites", () => {
    expect(createPartySchema.safeParse({ ...party, legalName: "" }).success).toBe(false);
    expect(createPartySchema.safeParse({ ...party, legalName: "x".repeat(301) }).success).toBe(
      false,
    );
    expect(createPartySchema.safeParse({ ...party, email: "no-es-correo" }).success).toBe(false);
    expect(createPartySchema.safeParse({ ...party, identification: "1".repeat(21) }).success).toBe(
      false,
    );
    expect(createPartySchema.safeParse({ ...party, identificationType: "4" }).success).toBe(false);
    expect(createPartySchema.safeParse({ ...party, roles: ["DESTINATARIO"] }).success).toBe(false);
    expect(updatePartySchema.safeParse(party).success).toBe(false);
  });
});

describe("contrato de productos", () => {
  it("acepta un alta válida con ICE e IRBPNR vacíos por defecto", () => {
    expect(createProductSchema.parse(product)).toMatchObject({
      unitPrice: "8.75",
      stockTracked: false,
      mainCode: null,
      taxes: { iva: "4", ice: null, irbpnr: null },
    });
  });

  it("rechaza companyId y campos desconocidos en los cuerpos", () => {
    for (const [schema, body] of [
      [createProductSchema, product],
      [updateProductSchema, { ...product, expectedVersion: 1 }],
      [changeProductStatusSchema, { status: "INACTIVE" }],
    ] as const) {
      const result = schema.safeParse({ ...body, companyId: "otra" });
      expect(result.success).toBe(false);
      expect(messages(result)).toContain("La solicitud contiene campos no permitidos.");
    }
  });

  it("el precio es texto decimal exacto: 12 enteros y 6 decimales como máximo", () => {
    const price = (unitPrice: unknown) => createProductSchema.safeParse({ ...product, unitPrice });
    for (const ok of ["999999999999.999999", "0.000001", "0", "12.5"]) {
      expect(price(ok).success, ok).toBe(true);
    }
    expect(messages(price("1000000000000"))).toContain("Admite como máximo 12 dígitos enteros.");
    expect(messages(price("0.0000001"))).toContain("Admite como máximo 6 decimales.");
    expect(messages(price("1.1234560"))).toContain("Admite como máximo 6 decimales.");
    for (const bad of [12.5, "-1", "1e3", "1,50", "01.5", " 1", "1 000"]) {
      expect(price(bad).success, String(bad)).toBe(false);
    }
  });

  it("los impuestos refieren entradas: sin porcentajes, denominaciones ni arreglos", () => {
    const taxes = (value: unknown) => createProductSchema.safeParse({ ...product, taxes: value });
    expect(taxes({ iva: "4", ice: "3041-GRAN-ESCALA", irbpnr: "5001" }).success).toBe(true);
    expect(messages(taxes({}))).toContain("La tarifa de IVA es obligatoria.");
    expect(taxes({ iva: 15 }).success).toBe(false);
    expect(taxes({ iva: "15 %" }).success).toBe(false);
    expect(taxes({ iva: "IVA 15%" }).success).toBe(false);
    expect(taxes({ iva: "4", ice: ["3011", "3021"] }).success).toBe(false);
    expect(taxes([{ catalogType: "iva-rate", entryKey: "4" }]).success).toBe(false);
    expect(taxes({ iva: "4", percentage: "15" }).success).toBe(false);
  });
});

describe("paginación común", () => {
  it("25 por página por defecto, de 1 a 100, y un companyId en la consulta se ignora", () => {
    for (const schema of [listPartiesQuerySchema, listProductsQuerySchema]) {
      expect(schema.parse({ companyId: "otra" })).toMatchObject({
        page: 1,
        pageSize: 25,
        status: "ACTIVE",
        sort: "name",
        direction: "asc",
      });
      expect(schema.parse({ page: "3", pageSize: "100" })).toMatchObject({
        page: 3,
        pageSize: 100,
      });
      expect(messages(schema.safeParse({ pageSize: "101" }))).toContain(
        "El tamaño de página debe ser como máximo 100.",
      );
      expect(schema.safeParse({ pageSize: "0" }).success).toBe(false);
      expect(schema.safeParse({ search: "x".repeat(101) }).success).toBe(false);
    }
    expect(listPartiesQuerySchema.safeParse({ sort: "createdAt" }).success).toBe(false);
    expect(listProductsQuerySchema.parse({ taxStatus: "REVIEW_REQUIRED" }).taxStatus).toBe(
      "REVIEW_REQUIRED",
    );
  });

  it("la lista de usuarios conserva su propio esquema", () => {
    expect(listUsersQuerySchema.parse({})).toEqual({ page: 1, pageSize: 25 });
  });
});
