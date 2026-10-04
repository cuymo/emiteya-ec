// Contratos del inventario (add-minimal-inventory, tarea 2.1, design D7 a D10): cantidades como
// texto exacto, cuerpos estrictos sin empresa, estados derivados y avisos del borrador.
import { describe, expect, it } from "vitest";
import {
  INVENTORY_ERROR_CODES,
  STOCK_LIST_FILTERS,
  STOCK_MOVEMENT_TYPES,
  STOCK_TRACKING_STATES,
  STOCK_TRACKING_STATE_LABELS,
  draftPreviewViewSchema,
  initializeStockSchema,
  listStockItemsQuerySchema,
  listStockMovementsQuerySchema,
  stockAdjustmentSchema,
  stockEntrySchema,
  stockItemViewSchema,
  stockMovementHeadersSchema,
  stockTrackingSchema,
  stockWarningSchema,
} from "@facturador/contracts";

const messages = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((issue) => issue.message) ?? [];

describe("estados y tipos del inventario", () => {
  it("cuatro estados derivados, con etiqueta, y los filtros de la lista", () => {
    expect(STOCK_TRACKING_STATES).toEqual([
      "NOT_TRACKED",
      "TRACKED_NOT_INITIALIZED",
      "TRACKED_INITIALIZED",
      "DISABLED_INITIALIZED",
    ]);
    expect(Object.keys(STOCK_TRACKING_STATE_LABELS)).toEqual([...STOCK_TRACKING_STATES]);
    expect(STOCK_LIST_FILTERS).toEqual([
      "TRACKED_NOT_INITIALIZED",
      "TRACKED_INITIALIZED",
      "DISABLED_INITIALIZED",
      "NEGATIVE",
    ]);
    expect(STOCK_MOVEMENT_TYPES).toEqual([
      "INICIAL",
      "ENTRADA_MANUAL",
      "SALIDA_FACTURA",
      "DEVOLUCION_NC",
      "AJUSTE",
    ]);
    expect(INVENTORY_ERROR_CODES).toContain("STOCK_TRACKING_MANAGED_BY_INVENTORY");
  });

  it("sin inicializar, el saldo es null y nunca cero", () => {
    const item = {
      productId: "p-1",
      mainCode: "CEM-50",
      auxiliaryCode: null,
      name: "Cemento",
      productStatus: "ACTIVE",
      state: "TRACKED_NOT_INITIALIZED",
      balance: null,
      negative: false,
      lastMovementAt: null,
    };
    expect(stockItemViewSchema.parse(item).balance).toBeNull();
    expect(stockItemViewSchema.safeParse({ ...item, balance: 0 }).success).toBe(false);
    expect(stockItemViewSchema.parse({ ...item, balance: "-3", negative: true }).balance).toBe(
      "-3",
    );
  });
});

describe("solicitudes del inventario", () => {
  it("inicializar admite cero y rechaza negativos, siete decimales y números JSON", () => {
    expect(initializeStockSchema.parse({ quantity: "0" })).toEqual({ quantity: "0", note: null });
    expect(initializeStockSchema.parse({ quantity: "12.5", note: "  Conteo  " })).toEqual({
      quantity: "12.5",
      note: "Conteo",
    });
    for (const quantity of ["-1", "1.0000001", 5]) {
      expect(initializeStockSchema.safeParse({ quantity }).success, String(quantity)).toBe(false);
    }
  });

  it("una entrada es mayor que cero", () => {
    expect(stockEntrySchema.parse({ quantity: "10" }).quantity).toBe("10");
    expect(messages(stockEntrySchema.safeParse({ quantity: "0.000" }))).toEqual([
      "La cantidad de una entrada debe ser mayor que cero.",
    ]);
    expect(stockEntrySchema.safeParse({ quantity: "-2" }).success).toBe(false);
  });

  it("un ajuste tiene signo, no es cero, cabe en el dominio de las cantidades y lleva motivo", () => {
    expect(stockAdjustmentSchema.parse({ delta: "-4", reason: " Merma " })).toEqual({
      delta: "-4",
      reason: "Merma",
    });
    expect(stockAdjustmentSchema.parse({ delta: "2.5", reason: "Conteo" }).delta).toBe("2.5");
    expect(messages(stockAdjustmentSchema.safeParse({ delta: "0.00", reason: "Merma" }))).toEqual([
      "Un ajuste no puede ser de cero.",
    ]);
    // "-0" no es un texto decimal válido: lo rechaza la representación universal.
    expect(stockAdjustmentSchema.safeParse({ delta: "-0.00", reason: "Merma" }).success).toBe(
      false,
    );
    expect(messages(stockAdjustmentSchema.safeParse({ delta: "-1" }))).toEqual([
      "El motivo del ajuste es obligatorio.",
    ]);
    expect(messages(stockAdjustmentSchema.safeParse({ delta: "-1", reason: "   " }))).toEqual([
      "El motivo del ajuste es obligatorio.",
    ]);
    expect(
      stockAdjustmentSchema.safeParse({ delta: "-1000000000000000000", reason: "x" }).success,
    ).toBe(false);
    expect(stockAdjustmentSchema.safeParse({ delta: "1.0000001", reason: "x" }).success).toBe(
      false,
    );
    expect(stockAdjustmentSchema.safeParse({ delta: -1, reason: "x" }).success).toBe(false);
  });

  it("los cuerpos rechazan la empresa y otros campos", () => {
    for (const [schema, body] of [
      [initializeStockSchema, { quantity: "1", companyId: "otra" }],
      [stockEntrySchema, { quantity: "1", companyId: "otra" }],
      [stockAdjustmentSchema, { delta: "1", reason: "x", companyId: "otra" }],
      [stockTrackingSchema, { tracked: false, companyId: "otra" }],
    ] as const) {
      expect(messages(schema.safeParse(body))).toEqual([
        "La solicitud contiene campos no permitidos.",
      ]);
    }
  });

  it("la clave de idempotencia es obligatoria y con el formato común", () => {
    expect(stockMovementHeadersSchema.safeParse({ "Idempotency-Key": "abc-123" }).success).toBe(
      true,
    );
    expect(stockMovementHeadersSchema.safeParse({}).success).toBe(false);
    expect(stockMovementHeadersSchema.safeParse({ "Idempotency-Key": "con espacio" }).success).toBe(
      false,
    );
  });
});

describe("consultas del inventario", () => {
  it("la lista filtra por estado y pagina", () => {
    expect(listStockItemsQuerySchema.parse({ state: "NEGATIVE", page: "2" })).toMatchObject({
      state: "NEGATIVE",
      page: 2,
      pageSize: 25,
    });
    expect(listStockItemsQuerySchema.safeParse({ state: "RESERVED" }).success).toBe(false);
  });

  it("el kárdex rechaza un rango invertido", () => {
    expect(
      messages(listStockMovementsQuerySchema.safeParse({ from: "2026-10-31", to: "2026-10-01" })),
    ).toEqual(["La fecha final no puede ser anterior a la inicial."]);
    expect(
      listStockMovementsQuerySchema.parse({ from: "2026-10-01", to: "2026-10-31" }),
    ).toMatchObject({ from: "2026-10-01", to: "2026-10-31" });
  });
});

describe("avisos de existencias del borrador", () => {
  it("van aparte de los problemas que bloquean y sin saldo cuando no hay inventario", () => {
    expect(
      stockWarningSchema.parse({
        code: "STOCK_NOT_INITIALIZED",
        productId: "p-1",
        requested: "7",
        balance: null,
      }).balance,
    ).toBeNull();
    expect(
      stockWarningSchema.safeParse({
        code: "STOCK_BELOW_REQUESTED",
        productId: "p-1",
        requested: "7",
        balance: "5",
      }).success,
    ).toBe(true);
    expect(draftPreviewViewSchema.shape.stockWarnings).toBeDefined();
    expect(draftPreviewViewSchema.shape.issues).toBeDefined();
  });
});
