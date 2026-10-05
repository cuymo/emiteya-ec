// Tipos de comprobante que el sistema emite (add-credit-notes, design D2; document-emission, "Tipos
// de comprobante que el sistema emite"): la factura y la nota de crédito tienen su operación de
// emisión con `Idempotency-Key`; una nota de débito, una retención, una guía de remisión o una
// liquidación de compra no tienen ninguna. El registro de OpenAPI coincide con las rutas que atiende
// Express (`identity/openapi-routes.test.ts`), así que basta con revisarlo.
import { describe, expect, it } from "vitest";
import { IDEMPOTENCY_KEY_HEADER, apiRoutes } from "@facturador/contracts";

const NOT_EMITTED =
  /debit|d[eé]bito|withholding|retenci|shipping|remisi|gu[ií]a|purchase|settlement|liquidaci/i;

describe("tipos de comprobante emitidos", () => {
  it("solo la factura y la nota de crédito tienen una operación de emisión", () => {
    const emissions = apiRoutes
      .filter(
        (route) =>
          route.method === "post" &&
          !route.path.includes(":") &&
          route.request?.headers?.shape[IDEMPOTENCY_KEY_HEADER] !== undefined,
      )
      .map((route) => route.path)
      .sort();
    expect(emissions).toEqual(["/credit-notes", "/invoices"]);
  });

  it("no existe ninguna ruta de una nota de débito, una retención, una guía o una liquidación", () => {
    expect(apiRoutes.filter((route) => NOT_EMITTED.test(route.path)).map((r) => r.path)).toEqual(
      [],
    );
  });
});
