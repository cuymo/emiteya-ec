// Tipos de comprobante que el sistema emite (add-credit-notes, design D2; add-debit-notes, design
// D20; add-withholding-receipts, design D21; add-shipping-guides, design D22; add-purchase-settlements,
// design D21; document-emission, "Tipos de comprobante que el sistema emite"): la factura, la
// liquidación de compra, la nota de crédito, la nota de débito, el comprobante de retención y la guía
// de remisión tienen sus rutas, cada tipo bajo su prefijo. El registro de OpenAPI coincide con las
// rutas que atiende Express (`identity/openapi-routes.test.ts`), así que basta con revisarlo.
import { describe, expect, it } from "vitest";
import { IDEMPOTENCY_KEY_HEADER, apiRoutes } from "@facturador/contracts";

const EMITTED_PREFIXES = [
  "/credit-notes",
  "/debit-notes",
  "/invoices",
  "/purchase-settlements",
  "/shipping-guides",
  "/withholding-receipts",
];
const PURCHASE = /purchase|settlement|liquidaci/i;

describe("tipos de comprobante emitidos", () => {
  it("la factura, la nota de crédito, la nota de débito, la retención y la guía tienen una operación de emisión", () => {
    const emissions = apiRoutes
      .filter(
        (route) =>
          route.method === "post" &&
          !route.path.includes(":") &&
          route.request?.headers?.shape[IDEMPOTENCY_KEY_HEADER] !== undefined,
      )
      .map((route) => route.path)
      .sort();
    expect(emissions).toEqual([
      "/credit-notes",
      "/debit-notes",
      "/invoices",
      "/shipping-guides",
      "/withholding-receipts",
    ]);
  });

  it("los seis tipos tienen rutas bajo su prefijo, también la liquidación de compra", () => {
    for (const prefix of EMITTED_PREFIXES) {
      expect(
        apiRoutes.some((route) => route.path === prefix || route.path.startsWith(`${prefix}/`)),
        prefix,
      ).toBe(true);
    }
    // Ninguna ruta de la liquidación vive fuera de su prefijo.
    expect(
      apiRoutes
        .filter((route) => PURCHASE.test(route.path))
        .filter((route) => !route.path.startsWith("/purchase-settlements"))
        .map((route) => route.path),
    ).toEqual([]);
  });
});
