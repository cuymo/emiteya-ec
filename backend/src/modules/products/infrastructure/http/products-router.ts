// Rutas de productos bajo /api/v1 (add-parties-and-products, design D11). No hay ruta de borrado:
// los productos se desactivan. `tax-summary` va antes de `:productId`.
import { Router, type Response } from "express";
import type {
  CatalogRateView,
  ListMeta,
  ProductTaxSummaryView,
  ProductView,
} from "@facturador/contracts";
import { contextOf } from "../../../identity/infrastructure/http/request-context.ts";
import type { EntryAvailability } from "../../application/ports.ts";
import type { ProductResult, Products } from "../../application/products.ts";

function rateOf(availability: EntryAvailability | null): CatalogRateView | null {
  const version = availability ? (availability.applicable ?? availability.latest) : null;
  if (!version?.taxKind || !version.sriTaxCode || !version.rateKind) return null;
  return {
    taxKind: version.taxKind,
    sriTaxCode: version.sriTaxCode,
    rateKind: version.rateKind,
    percentage: version.percentage,
  };
}

export function toProductView(product: ProductResult): ProductView {
  const reasons = new Map(
    product.taxConfiguration.reasons.map((reason) => [reason.slot, reason.reason]),
  );
  return {
    id: product.id,
    kind: product.kind,
    mainCode: product.mainCode,
    auxiliaryCode: product.auxiliaryCode,
    name: product.name,
    description: product.description,
    unitPrice: product.unitPrice,
    stockTracked: product.stockTracked,
    status: product.status,
    version: product.version,
    taxes: product.taxDetails.map((tax) => ({
      slot: tax.slot,
      catalogType: tax.catalogType as ProductView["taxes"][number]["catalogType"],
      entryKey: tax.entryKey,
      code: tax.code,
      officialLabel: tax.availability
        ? (tax.availability.applicable ?? tax.availability.latest).officialLabel
        : null,
      rate: rateOf(tax.availability),
      usable: tax.availability?.usable ?? false,
      reason: reasons.get(tax.slot) ?? null,
    })),
    taxConfiguration: {
      status: product.taxConfiguration.status,
      reasons: product.taxConfiguration.reasons.map((reason) => ({
        slot: reason.slot,
        catalogType: reason.catalogType as ProductView["taxes"][number]["catalogType"],
        entryKey: reason.entryKey,
        code: reason.code,
        reason: reason.reason,
      })),
      evaluatedOn: product.taxConfiguration.evaluatedOn,
    },
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}

function send<T>(res: Response, status: number, data: T, meta?: ListMeta) {
  res.status(status).json(meta ? { data, meta } : { data });
}

export function productsRouter(products: Products): Router {
  const router = Router();

  router.get("/products", async (req, res) => {
    const { items, meta } = await products.list(contextOf(res), req.query);
    send(res, 200, items.map(toProductView), meta);
  });

  router.post("/products", async (req, res) => {
    send(res, 201, toProductView(await products.create(contextOf(res), req.body)));
  });

  router.get("/products/tax-summary", async (_req, res) => {
    const summary = await products.taxSummary(contextOf(res));
    send(res, 200, summary as ProductTaxSummaryView);
  });

  router.get("/products/:productId", async (req, res) => {
    send(res, 200, toProductView(await products.get(contextOf(res), req.params.productId)));
  });

  router.put("/products/:productId", async (req, res) => {
    send(
      res,
      200,
      toProductView(await products.update(contextOf(res), req.params.productId, req.body)),
    );
  });

  router.put("/products/:productId/status", async (req, res) => {
    send(
      res,
      200,
      toProductView(await products.changeStatus(contextOf(res), req.params.productId, req.body)),
    );
  });

  return router;
}
