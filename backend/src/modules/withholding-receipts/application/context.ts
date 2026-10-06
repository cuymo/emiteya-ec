// Contexto de la evaluación de un comprobante de retención (add-withholding-receipts, design D3, D6,
// D11, D12 y D15): lee el sujeto retenido por `(company_id, id)`, la preparación de la empresa, los
// catálogos resueltos por `catalogs` con la fecha dada (la de hoy en la vista previa y la de la
// reserva al emitir) y los códigos de porcentaje de cada documento con la fecha de ese documento, y
// entrega la evaluación pura. La usan la vista previa del borrador, la comprobación previa de la
// emisión y, otra vez, la transacción de reserva.
import type { WithholdingIssue, WithholdingLimits } from "@facturador/contracts";
import type { RegisteredSchema } from "../../sri-engine/application/ports.ts";
import { registeredSchema } from "../../sri-engine/application/schemas.ts";
import type { IssuerConfig, IssuerPoint } from "../domain/build-snapshot.ts";
import type { WithholdingDraftContent } from "../domain/draft.ts";
import {
  evaluateWithholdingReceipt,
  supportTaxRateQueries,
  type CatalogVersion,
  type WithheldSubject,
  type WithholdingCatalogs,
  type WithholdingEvaluation,
} from "../domain/evaluation.ts";
import type { WithheldPartyReader, WithholdingReads } from "./ports.ts";

/** Tipo y versión del XSD del comprobante de retención de este cambio. */
export const WITHHOLDING_SCHEMA = { documentType: "07", version: "2.0.0" } as const;

export type ContextReads = Readonly<{
  reads: WithholdingReads;
  parties: ReturnType<WithheldPartyReader>;
}>;

export type WithholdingContext = Readonly<{
  subject: WithheldSubject | null;
  config: IssuerConfig | null;
  point: (IssuerPoint & Readonly<{ available: boolean }>) | null;
  schema: RegisteredSchema | null;
  catalogs: WithholdingCatalogs;
  evaluation: WithholdingEvaluation;
}>;

const issue = (code: WithholdingIssue["code"], message: string): WithholdingIssue => ({
  code,
  message,
  support: null,
  tax: null,
  payment: null,
  withholding: null,
});

/** Preparación de la empresa, del punto, de la firma y del esquema (design D15, paso 10). */
async function readiness(
  reads: WithholdingReads,
  companyId: string,
  emissionPointId: string | null,
): Promise<
  Pick<WithholdingContext, "config" | "point" | "schema"> & { issues: WithholdingIssue[] }
> {
  const issues: WithholdingIssue[] = [];
  const config = await reads.currentConfig(companyId);
  if (!config) {
    issues.push(
      issue(
        "TAXPAYER_NOT_CONFIGURED",
        "Registra los datos tributarios de la empresa antes de emitir.",
      ),
    );
  }
  const point = emissionPointId ? await reads.emissionPoint(companyId, emissionPointId) : null;
  if (!emissionPointId) {
    issues.push(
      issue(
        "WITHHOLDING_DRAFT_INCOMPLETE",
        "Elige el punto de emisión del comprobante de retención.",
      ),
    );
  } else if (!point) {
    issues.push(issue("EMISSION_POINT_NOT_FOUND", "El punto de emisión no existe en tu empresa."));
  } else if (!point.available) {
    issues.push(
      issue(
        "EMISSION_POINT_UNAVAILABLE",
        `El punto de emisión ${point.establishment.code}-${point.point.code} o su establecimiento está desactivado.`,
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
    WITHHOLDING_SCHEMA.documentType,
    WITHHOLDING_SCHEMA.version,
  );
  if (!schema) {
    issues.push(
      issue(
        "SCHEMA_NOT_AVAILABLE",
        "El esquema XSD del comprobante de retención 2.0.0 no está registrado.",
      ),
    );
  }
  return { config, point, schema, issues };
}

/**
 * Los catálogos de la evaluación (design D11 y D12): las retenciones, los tipos, los sustentos y las
 * formas de pago con la fecha de emisión y la habilitación de la empresa; los impuestos del documento
 * con la fecha de emisión; y sus códigos de porcentaje con la fecha de cada documento, sin
 * habilitación (son los impuestos del proveedor).
 */
export async function loadWithholdingCatalogs(
  reads: WithholdingReads,
  companyId: string,
  draft: Pick<WithholdingDraftContent, "supports">,
  date: string,
): Promise<WithholdingCatalogs> {
  const [withholdingTaxes, incomeConcepts, ivaCodes, documentTypes, supportCodes, paymentMethods] =
    await Promise.all([
      reads.availability(companyId, "withholding-tax", date),
      reads.availability(companyId, "withholding-income-concept", date),
      reads.availability(companyId, "withholding-iva-code", date),
      reads.availability(companyId, "support-document-type", date),
      reads.availability(companyId, "support-code", date),
      reads.availability(companyId, "payment-method", date),
    ]);
  const supportTaxes = new Map<string, CatalogVersion>();
  for (const code of ["2", "3", "5"]) {
    const version = await reads.resolve("tax", code, date);
    if (version) supportTaxes.set(code, version);
  }
  const supportTaxRates = new Map<string, CatalogVersion | null>();
  for (const query of supportTaxRateQueries(draft.supports)) {
    supportTaxRates.set(
      query.key,
      await reads.resolve(query.catalogType, query.entryKey, query.date),
    );
  }
  return {
    withholdingTaxes,
    incomeConcepts,
    ivaCodes,
    documentTypes,
    supportCodes,
    paymentMethods,
    supportTaxes,
    supportTaxRates,
  };
}

export async function loadWithholdingContext(
  source: ContextReads,
  companyId: string,
  draft: WithholdingDraftContent,
  date: string,
  limits: WithholdingLimits,
): Promise<WithholdingContext> {
  const subject = draft.partyId ? await source.parties.find(companyId, draft.partyId) : null;
  const ready = await readiness(source.reads, companyId, draft.emissionPointId);
  const catalogs = await loadWithholdingCatalogs(source.reads, companyId, draft, date);
  const evaluation = evaluateWithholdingReceipt({
    issueDate: date,
    draft,
    subject,
    catalogs,
    limits,
    specialTaxpayerNumber: ready.config?.profile.specialTaxpayerNumber ?? null,
    readiness: ready.issues,
  });
  return {
    subject,
    config: ready.config,
    point: ready.point,
    schema: ready.schema,
    catalogs,
    evaluation,
  };
}
