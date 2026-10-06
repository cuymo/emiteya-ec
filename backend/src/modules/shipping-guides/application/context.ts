// Contexto de la evaluación de una guía de remisión (add-shipping-guides, design D12 y D13): lee por
// `(company_id, id)` solo lo que el borrador referencia (terceros, establecimientos, productos y
// facturas), la preparación de la empresa, del punto, de la firma y del esquema, y entrega la
// evaluación pura con la fecha dada (la de hoy en la vista previa y la de la reserva al emitir). La
// usan la vista previa del borrador, la comprobación previa de la emisión y, otra vez, la
// transacción de reserva.
import type { ShippingGuideIssue, ShippingGuideLimits } from "@facturador/contracts";
import type { RegisteredSchema } from "../../sri-engine/application/ports.ts";
import { registeredSchema } from "../../sri-engine/application/schemas.ts";
import type { IssuerConfig, IssuerPoint } from "../domain/build-snapshot.ts";
import type { ShippingGuideDraftContent } from "../domain/draft.ts";
import {
  evaluateShippingGuide,
  type GuideEstablishment,
  type GuideInvoice,
  type GuideParty,
  type GuideProduct,
  type ShippingGuideEvaluation,
} from "../domain/evaluation.ts";
import type {
  GuideInvoiceSource,
  ShippingGuideReads,
  ShippingInvoiceReader,
  ShippingPartyReader,
  ShippingProductReader,
} from "./ports.ts";

/** Tipo y versión del XSD de la guía de remisión de este cambio. */
export const SHIPPING_GUIDE_SCHEMA = { documentType: "06", version: "1.1.0" } as const;

export type ContextReads = Readonly<{
  reads: ShippingGuideReads;
  parties: ReturnType<ShippingPartyReader>;
  products: ReturnType<ShippingProductReader>;
  invoices: ReturnType<ShippingInvoiceReader>;
}>;

export type ShippingGuideContext = Readonly<{
  config: IssuerConfig | null;
  point: (IssuerPoint & Readonly<{ available: boolean }>) | null;
  schema: RegisteredSchema | null;
  parties: ReadonlyMap<string, GuideParty>;
  establishments: ReadonlyMap<string, GuideEstablishment>;
  products: ReadonlyMap<string, GuideProduct>;
  invoices: ReadonlyMap<string, ContextInvoice>;
  evaluation: ShippingGuideEvaluation;
}>;

/** La factura sustento leída, con su integridad como la evalúa la guía. */
export type ContextInvoice = GuideInvoiceSource & GuideInvoice;

export const contextInvoice = (invoice: GuideInvoiceSource): ContextInvoice => ({
  ...invoice,
  intact: invoice.integrity.intact,
});

const issue = (code: ShippingGuideIssue["code"], message: string): ShippingGuideIssue => ({
  code,
  message,
  field: null,
  recipient: null,
  detail: null,
});

/** Preparación de la empresa, del punto, de la firma y del esquema. */
async function readiness(
  reads: ShippingGuideReads,
  companyId: string,
  emissionPointId: string | null,
): Promise<
  Pick<ShippingGuideContext, "config" | "point" | "schema"> & { issues: ShippingGuideIssue[] }
> {
  const issues: ShippingGuideIssue[] = [];
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
    issues.push({
      ...issue("SHIPPING_GUIDE_DRAFT_INCOMPLETE", "Elige el punto de emisión de la guía."),
      field: "emissionPointId",
    });
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
    SHIPPING_GUIDE_SCHEMA.documentType,
    SHIPPING_GUIDE_SCHEMA.version,
  );
  if (!schema) {
    issues.push(
      issue(
        "SCHEMA_NOT_AVAILABLE",
        "El esquema XSD de la guía de remisión 1.1.0 no está registrado.",
      ),
    );
  }
  return { config, point, schema, issues };
}

/** Lee cada identificador una vez; uno ausente es un recurso que no existe en la empresa. */
async function readAll<T>(
  ids: Iterable<string>,
  read: (id: string) => Promise<T | null>,
): Promise<Map<string, T>> {
  const result = new Map<string, T>();
  await Promise.all(
    [...new Set(ids)].map(async (id) => {
      const found = await read(id);
      if (found !== null) result.set(id, found);
    }),
  );
  return result;
}

/** Los identificadores que el borrador referencia. */
export function referencesOf(draft: Omit<ShippingGuideDraftContent, "emissionPointId">) {
  const parties: string[] = [];
  const establishments: string[] = [];
  const products: string[] = [];
  const invoices: string[] = [];
  if (draft.transporter?.source === "PARTY") parties.push(draft.transporter.partyId);
  if (draft.originEstablishmentId) establishments.push(draft.originEstablishmentId);
  for (const recipient of draft.recipients) {
    if (recipient.recipient?.kind === "PARTY") parties.push(recipient.recipient.partyId);
    if (recipient.recipient?.kind === "OWN_COMPANY") {
      establishments.push(recipient.recipient.destinationEstablishmentId);
    }
    if (recipient.support?.kind === "INTERNAL_INVOICE") invoices.push(recipient.support.invoiceId);
    for (const detail of recipient.details) if (detail.productId) products.push(detail.productId);
  }
  return { parties, establishments, products, invoices };
}

export async function loadShippingGuideContext(
  source: ContextReads,
  companyId: string,
  draft: ShippingGuideDraftContent,
  date: string,
  limits: ShippingGuideLimits,
): Promise<ShippingGuideContext> {
  const refs = referencesOf(draft);
  const [ready, parties, establishments, products, invoices] = await Promise.all([
    readiness(source.reads, companyId, draft.emissionPointId),
    readAll(refs.parties, (id) => source.parties.find(companyId, id)),
    readAll(refs.establishments, (id) => source.reads.establishment(companyId, id)),
    readAll(refs.products, (id) => source.products.find(companyId, id)),
    readAll(refs.invoices, async (id) => {
      const invoice = await source.invoices.find(companyId, id);
      return invoice && contextInvoice(invoice);
    }),
  ]);
  const evaluation = evaluateShippingGuide({
    issueDate: date,
    // Sin configuración, la preparación lo informa; la factura se compara con el ambiente vigente.
    environment: ready.config?.environment ?? "TEST",
    draft,
    company: ready.config
      ? { ruc: ready.config.profile.ruc, legalName: ready.config.profile.legalName }
      : null,
    parties,
    establishments,
    products,
    invoices,
    limits,
    readiness: ready.issues,
  });
  return {
    config: ready.config,
    point: ready.point,
    schema: ready.schema,
    parties,
    establishments,
    products,
    invoices,
    evaluation,
  };
}
