// Tipos de comprobante que el sistema emite (add-credit-notes, design D2; add-debit-notes, design
// D20; add-withholding-receipts, design D21; add-shipping-guides, design D22; document-emission,
// "Tipos de comprobante que el sistema emite"): la factura, la nota de crédito, la nota de débito, el
// comprobante de retención y la guía de remisión tienen sus rutas; una liquidación de compra no tiene
// ninguna. El registro de OpenAPI coincide con las rutas que atiende Express
// (`identity/openapi-routes.test.ts`), así que basta con revisarlo.
import { describe, expect, it } from "vitest";
import { IDEMPOTENCY_KEY_HEADER, apiRoutes } from "@facturador/contracts";

const NOT_EMITTED = /purchase|settlement|liquidaci/i;

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

  it("no existe ninguna ruta de una liquidación de compra", () => {
    expect(apiRoutes.filter((route) => NOT_EMITTED.test(route.path)).map((r) => r.path)).toEqual(
      [],
    );
  });
});
