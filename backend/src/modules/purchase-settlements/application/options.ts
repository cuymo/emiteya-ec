// Opciones del borrador y búsqueda de proveedores (add-purchase-settlements, design D3, D4, D7, D9,
// D21 y D22). Las opciones son la política de procedencia con sus cuatro declaraciones, el aviso de la
// retención, la moneda, las tarifas de IVA utilizables (vigentes, habilitadas y con tarifa de
// cálculo) y las formas de pago de la empresa en la fecha de hoy, y los límites efectivos de
// recursos. Los proveedores son los terceros activos con el rol de proveedor, sin el consumidor
// final: solo la cédula y el pasaporte son seleccionables y los demás llevan el motivo.
import {
  PURCHASE_SETTLEMENT_CURRENCY,
  PURCHASE_SETTLEMENT_IDENTIFICATION_TYPES,
  PURCHASE_SETTLEMENT_WITHHOLDING_NOTICE,
  listPurchaseSettlementSuppliersQuerySchema,
  type PurchaseSettlementLimits,
  type PurchaseSettlementOptionsView,
  type PurchaseSettlementSupplierView,
  type RateKind,
} from "@facturador/contracts";
import { parseInput, type Authorizer } from "../../identity/application/authorization.ts";
import type { RequestContext } from "../../identity/application/request-context.ts";
import {
  ivaCalculationPercentage,
  type CatalogOption,
  type PurchaseSupplier,
} from "../domain/evaluation.ts";
import { purchaseSettlementPolicyView } from "../domain/preview.ts";
import type { ContextReads } from "./context.ts";
import type { Page } from "./drafts.ts";

export type PurchaseSettlementOptionsDependencies = {
  context: ContextReads;
  authorizer: Authorizer;
  limits: PurchaseSettlementLimits;
  today: () => string;
};

const usable = (options: ReadonlyMap<string, CatalogOption>) =>
  [...options.values()]
    .filter((option) => option.usable && option.applicable)
    .map((option) => option.applicable!)
    .sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }));

const SELECTABLE: ReadonlySet<string> = new Set(PURCHASE_SETTLEMENT_IDENTIFICATION_TYPES);

/** El proveedor para el selector: elegible o no, con el motivo cuando no lo es (design D4). */
export function toSupplierView(supplier: PurchaseSupplier): PurchaseSettlementSupplierView {
  const selectable = SELECTABLE.has(supplier.identificationType);
  return {
    id: supplier.id,
    identificationType: supplier.identificationType,
    identification: supplier.identification,
    legalName: supplier.legalName,
    address: supplier.address,
    selectable,
    reason: selectable
      ? null
      : supplier.identificationType === "04"
        ? "Tiene RUC: la liquidación de compra del sistema solo documenta compras a personas sin RUC activo (caso c) del art. 13)."
        : "Su identificación está fuera del alcance de la liquidación de compra del sistema: se admiten cédula y pasaporte.",
  };
}

export function createPurchaseSettlementOptions(deps: PurchaseSettlementOptionsDependencies) {
  const { authorizer } = deps;
  const { reads, suppliers } = deps.context;

  return {
    async options(ctx: RequestContext): Promise<PurchaseSettlementOptionsView> {
      authorizer.requirePermission(ctx, "purchaseSettlements.draft");
      const date = deps.today();
      const [ivaRates, payments] = await Promise.all([
        reads.availability(ctx.companyId, "iva-rate", date),
        reads.availability(ctx.companyId, "payment-method", date),
      ]);
      return {
        evaluatedOn: date,
        limits: { ...deps.limits },
        policy: purchaseSettlementPolicyView(),
        withholdingNotice: PURCHASE_SETTLEMENT_WITHHOLDING_NOTICE,
        currency: PURCHASE_SETTLEMENT_CURRENCY,
        // Solo las tarifas con un porcentaje de cálculo: el IVA diferenciado no se puede elegir.
        ivaRates: usable(ivaRates).flatMap((entry) => {
          const percentage = ivaCalculationPercentage(entry);
          return percentage === null || entry.rateKind === null
            ? []
            : [
                {
                  entryKey: entry.entryKey,
                  code: entry.code,
                  label: entry.officialLabel,
                  rateKind: entry.rateKind as RateKind,
                  percentage,
                },
              ];
        }),
        paymentMethods: usable(payments).map((entry) => ({
          entryKey: entry.entryKey,
          code: entry.code,
          label: entry.officialLabel,
        })),
      };
    },

    async suppliers(
      ctx: RequestContext,
      query: unknown,
    ): Promise<Page<PurchaseSettlementSupplierView>> {
      authorizer.requirePermission(ctx, "purchaseSettlements.draft");
      const { search, page, pageSize } = parseInput(
        listPurchaseSettlementSuppliersQuerySchema,
        query,
      );
      const { items, total } = await suppliers.searchSuppliers(ctx.companyId, {
        search,
        page,
        pageSize,
      });
      return { items: items.map(toSupplierView), meta: { page, pageSize, total } };
    },
  };
}

export type PurchaseSettlementOptions = ReturnType<typeof createPurchaseSettlementOptions>;
