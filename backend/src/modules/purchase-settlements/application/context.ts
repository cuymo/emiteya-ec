// Contexto de la evaluación de una liquidación de compra (add-purchase-settlements, design D7, D9,
// D12 y D13): lee el proveedor y los productos por `(company_id, id)`, la preparación de la empresa y
// las tarifas de IVA y las formas de pago resueltas por `catalogs` con la fecha dada (la de hoy en la
// vista previa y la de la reserva al emitir), y entrega la evaluación pura. La usan la vista previa
// del borrador, la comprobación previa de la emisión y, otra vez, la transacción de reserva.
import type { PurchaseSettlementIssue, PurchaseSettlementLimits } from "@facturador/contracts";
import type { RegisteredSchema } from "../../sri-engine/application/ports.ts";
import { registeredSchema } from "../../sri-engine/application/schemas.ts";
import type { IssuerConfig, IssuerPoint } from "../domain/build-snapshot.ts";
import type { PurchaseSettlementDraftContent } from "../domain/draft.ts";
import {
  evaluatePurchaseSettlement,
  type PurchaseProduct,
  type PurchaseSettlementCatalogs,
  type PurchaseSettlementEvaluation,
  type PurchaseSupplier,
} from "../domain/evaluation.ts";
import type {
  PurchaseProductReader,
  PurchaseSettlementReads,
  PurchaseSupplierReader,
} from "./ports.ts";
import { unsupportedSpecialCase } from "../../fiscal/domain/special-cases.ts";

/** Tipo y versión del XSD de la liquidación de compra de este cambio. */
export const PURCHASE_SETTLEMENT_SCHEMA = { documentType: "03", version: "1.1.0" } as const;

export type ContextReads = Readonly<{
  reads: PurchaseSettlementReads;
  suppliers: ReturnType<PurchaseSupplierReader>;
  products: ReturnType<PurchaseProductReader>;
}>;

export type PurchaseSettlementContext = Readonly<{
  supplier: PurchaseSupplier | null;
  products: ReadonlyMap<string, PurchaseProduct | null>;
  config: IssuerConfig | null;
  point: (IssuerPoint & Readonly<{ available: boolean }>) | null;
  schema: RegisteredSchema | null;
  catalogs: PurchaseSettlementCatalogs;
  evaluation: PurchaseSettlementEvaluation;
}>;

const issue = (
  code: PurchaseSettlementIssue["code"],
  message: string,
  field: string | null = null,
): PurchaseSettlementIssue => ({ code, message, field, line: null, payment: null });

/** Preparación de la empresa, del punto, de la firma y del esquema (design D13). */
async function readiness(
  reads: PurchaseSettlementReads,
  companyId: string,
  emissionPointId: string | null,
): Promise<
  Pick<PurchaseSettlementContext, "config" | "point" | "schema"> & {
    issues: PurchaseSettlementIssue[];
  }
> {
  const issues: PurchaseSettlementIssue[] = [];
  const config = await reads.currentConfig(companyId);
  if (!config) {
    issues.push(
      issue(
        "TAXPAYER_NOT_CONFIGURED",
        "Registra los datos tributarios de la empresa antes de emitir.",
      ),
    );
  }
  // Casos especiales del emisor que el motor no soporta (block-unsupported-special-cases-before-
  // emission, design D2): se rechazan antes de reservar, con el mismo código que la factura.
  const special = config ? unsupportedSpecialCase(config.profile, "03") : null;
  if (special) issues.push(issue("SPECIAL_CASE_UNSUPPORTED", special.message));
  const point = emissionPointId ? await reads.emissionPoint(companyId, emissionPointId) : null;
  if (!emissionPointId) {
    issues.push(
      issue(
        "PURCHASE_SETTLEMENT_DRAFT_INCOMPLETE",
        "Elige el punto de emisión de la liquidación de compra.",
        "emissionPointId",
      ),
    );
  } else if (!point) {
    issues.push(
      issue(
        "EMISSION_POINT_NOT_FOUND",
        "El punto de emisión no existe en tu empresa.",
        "emissionPointId",
      ),
    );
  } else if (!point.available) {
    issues.push(
      issue(
        "EMISSION_POINT_UNAVAILABLE",
        `El punto de emisión ${point.establishment.code}-${point.point.code} o su establecimiento está desactivado.`,
        "emissionPointId",
      ),
    );
  }
  const certificate = await reads.activeCertificate(companyId);
  if (!certificate?.usable) {
    issues.push(
      issue(
        "SIGNING_CERTIFICATE_NOT_USABLE",
        "La empresa no tiene una firma electrónica utilizable: carga una vigente.",
      ),
    );
  }
  const schema = registeredSchema(
    await reads.schemaRegistry(),
    PURCHASE_SETTLEMENT_SCHEMA.documentType,
    PURCHASE_SETTLEMENT_SCHEMA.version,
  );
  if (!schema) {
    issues.push(
      issue(
        "SCHEMA_NOT_AVAILABLE",
        "El esquema XSD de la liquidación de compra 1.1.0 no está registrado.",
      ),
    );
  }
  return { config, point, schema, issues };
}

export async function loadPurchaseSettlementCatalogs(
  reads: PurchaseSettlementReads,
  companyId: string,
  date: string,
): Promise<PurchaseSettlementCatalogs> {
  const [ivaRates, paymentMethods] = await Promise.all([
    reads.availability(companyId, "iva-rate", date),
    reads.availability(companyId, "payment-method", date),
  ]);
  return { ivaRates, paymentMethods };
}

export async function loadPurchaseSettlementContext(
  source: ContextReads,
  companyId: string,
  draft: PurchaseSettlementDraftContent,
  date: string,
  limits: PurchaseSettlementLimits,
): Promise<PurchaseSettlementContext> {
  const supplier = draft.supplierPartyId
    ? await source.suppliers.find(companyId, draft.supplierPartyId)
    : null;
  const products = new Map<string, PurchaseProduct | null>();
  for (const id of new Set(draft.lines.map((line) => line.productId))) {
    if (id !== null) products.set(id, await source.products.find(companyId, id));
  }
  const ready = await readiness(source.reads, companyId, draft.emissionPointId);
  const catalogs = await loadPurchaseSettlementCatalogs(source.reads, companyId, date);
  const evaluation = evaluatePurchaseSettlement({
    issueDate: date,
    draft,
    supplier,
    products,
    catalogs,
    limits,
    readiness: ready.issues,
  });
  return {
    supplier,
    products,
    config: ready.config,
    point: ready.point,
    schema: ready.schema,
    catalogs,
    evaluation,
  };
}
