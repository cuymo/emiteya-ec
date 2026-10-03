// Lectura de los datos de la evaluación de una factura (add-invoice-emission, design D6): resuelve
// las referencias del borrador en la empresa y la disponibilidad de los catálogos en la fecha de
// emisión, y entrega la entrada de `evaluateInvoice`. La usan la vista previa y la emisión.
import { registeredSchema } from "../../sri-engine/application/schemas.ts";
import type { RegisteredSchema } from "../../sri-engine/application/ports.ts";
import type { DraftContent } from "../domain/draft.ts";
import {
  CONSUMER_FINAL,
  type AvailabilityLike,
  type EvaluationInput,
  type EvaluationProduct,
} from "../domain/evaluation.ts";
import type {
  ActiveCertificateRead,
  CatalogReads,
  EmissionConfig,
  EvaluationReads,
} from "./ports.ts";

/** Tipo y versión del XSD de la factura de este cambio. */
export const INVOICE_DOCUMENT_TYPE = "01";
export const INVOICE_SCHEMA = { documentType: "01", version: "1.1.0" } as const;

export type EvaluationContext = Readonly<{
  input: EvaluationInput;
  config: EmissionConfig | null;
  certificate: ActiveCertificateRead | null;
  /** Esquema registrado de la factura con sus imports, o null si falta. */
  schema: RegisteredSchema | null;
}>;

/** Lecturas de catálogos memorizadas en una solicitud: la lista de borradores evalúa varios. */
export function cachedCatalogReads(catalogs: CatalogReads): CatalogReads {
  const memo = new Map<string, Promise<unknown>>();
  const once = <T>(key: string, read: () => Promise<T>): Promise<T> => {
    const cached = memo.get(key);
    if (cached) return cached as Promise<T>;
    const pending = read();
    memo.set(key, pending);
    return pending;
  };
  return {
    availability: (companyId, catalogType, date) =>
      once(`availability:${companyId}:${catalogType}:${date}`, () =>
        catalogs.availability(companyId, catalogType, date),
      ),
    identificationRule: (code, date) =>
      once(`identification:${code}:${date}`, () => catalogs.identificationRule(code, date)),
    consumerFinalPolicy: (date) => once(`policy:${date}`, () => catalogs.consumerFinalPolicy(date)),
    specialCases: () => once("special-cases", () => catalogs.specialCases()),
    schemaRegistry: () => once("schema-registry", () => catalogs.schemaRegistry()),
  };
}

export async function readEvaluation(
  reads: EvaluationReads,
  companyId: string,
  draft: DraftContent,
  issueDate: string,
  maxLines: number,
): Promise<EvaluationContext> {
  const config = await reads.currentConfig(companyId);
  const point = draft.emissionPointId
    ? await reads.emissionPoint(companyId, draft.emissionPointId)
    : null;
  const certificate = await reads.activeCertificate(companyId);
  const buyer = draft.buyerPartyId ? await reads.party(companyId, draft.buyerPartyId) : null;

  const products = new Map<string, EvaluationProduct | null>();
  for (const { productId } of draft.lines) {
    if (!products.has(productId))
      products.set(productId, await reads.product(companyId, productId));
  }
  const catalogTypes = new Set(
    [...products.values()].flatMap((product) => product?.taxes.map((tax) => tax.catalogType) ?? []),
  );
  const taxes = new Map<string, ReadonlyMap<string, AvailabilityLike>>();
  for (const catalogType of [...catalogTypes].sort()) {
    taxes.set(catalogType, await reads.catalogs.availability(companyId, catalogType, issueDate));
  }
  const paymentMethods = await reads.catalogs.availability(companyId, "payment-method", issueDate);
  const buyerIdentificationTypeUsable = buyer
    ? (await reads.catalogs.identificationRule(buyer.identificationType, issueDate)) !== null
    : false;
  const consumerFinalPolicy =
    buyer?.systemRecord === CONSUMER_FINAL
      ? await reads.catalogs.consumerFinalPolicy(issueDate)
      : null;
  const specialCases = await reads.catalogs.specialCases();
  const schema = registeredSchema(
    await reads.catalogs.schemaRegistry(),
    INVOICE_SCHEMA.documentType,
    INVOICE_SCHEMA.version,
  );

  return {
    input: {
      issueDate,
      maxLines,
      draft,
      config: config
        ? {
            versionId: config.versionId,
            version: config.version,
            profile: config.config.profile,
            environment: config.config.environment,
          }
        : null,
      point,
      certificate,
      buyer,
      buyerIdentificationTypeUsable,
      products,
      taxes,
      paymentMethods,
      consumerFinalPolicy,
      specialCases,
      schemaAvailable: schema !== null,
    },
    config,
    certificate,
    schema,
  };
}
