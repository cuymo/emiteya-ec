// Los datos del harness visual del editor tienen la forma exacta de los contratos de la API
// (productize-invoice-editor-and-composition-foundation, tarea 1.1). Si un contrato cambia, la
// revisión visual dejaría de enseñar la pantalla real; esta prueba lo detecta antes.
import { apiRoutes } from "@facturador/contracts";
import { describe, expect, it } from "vitest";
import { editorReply, INVOICE_DRAFTS } from "../visual/editor-fixtures";

function schemaFor(path: string, status: number) {
  const relative = path.replace(/^\/api\/v1/, "");
  const route = apiRoutes.find(
    (candidate) =>
      candidate.method === "get" &&
      new RegExp(`^${candidate.path.replace(/:[A-Za-z]+/g, "[^/]+")}$`).test(relative),
  );
  if (!route) throw new Error(`Sin contrato para GET ${path}`);
  const schema = route.responses[status]?.schema;
  if (!schema) throw new Error(`Sin esquema ${status} para GET ${path}`);
  return schema;
}

const PATHS = [
  "/api/v1/establishments",
  "/api/v1/me/default-emission-point",
  "/api/v1/parties?status=ACTIVE&pageSize=10",
  "/api/v1/parties?search=9999999999999&status=ACTIVE&pageSize=10",
  "/api/v1/products?status=ACTIVE&page=1&pageSize=25",
  "/api/v1/products/tax-summary",
  "/api/v1/taxpayer",
  "/api/v1/fiscal-catalogs/payment-method/entries",
  "/api/v1/fiscal-catalogs/iva-rate/entries",
  "/api/v1/fiscal-catalogs/ice-rate/entries",
  "/api/v1/fiscal-catalogs/irbpnr-rate/entries",
  "/api/v1/credit-notes/drafts/cnd-1",
  "/api/v1/credit-notes/invoices/inv-1/credit",
  "/api/v1/invoices/drafts/no-existe",
  ...Object.keys(INVOICE_DRAFTS).map((id) => `/api/v1/invoices/drafts/${id}`),
];

describe("datos del harness visual del editor", () => {
  it.each(PATHS)("GET %s cumple su contrato", (target) => {
    const url = new URL(target, "http://visual.test");
    const reply = editorReply("GET", url.pathname, url.searchParams);
    expect(reply).not.toBeNull();
    const result = schemaFor(url.pathname, reply!.status).safeParse(reply!.body);
    expect(result.error?.issues ?? []).toEqual([]);
  });

  it("no simula escrituras: la revisión no guarda ni emite", () => {
    const query = new URLSearchParams();
    expect(editorReply("PUT", "/api/v1/invoices/drafts/borrador-listo", query)).toBeNull();
    expect(editorReply("POST", "/api/v1/invoices/drafts", query)).toBeNull();
    expect(editorReply("POST", "/api/v1/invoices/drafts/borrador-listo/emit", query)).toBeNull();
  });
});
