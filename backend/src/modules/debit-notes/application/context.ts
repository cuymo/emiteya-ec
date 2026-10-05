// Contexto de la evaluación de una nota de débito (add-debit-notes, design D3, D4, D6 y D8): lee la
// factura de origen con su integridad y sus tratamientos de IVA, la preparación de la empresa y la
// forma de pago resuelta por el catálogo en la fecha dada, y entrega la evaluación pura. La usan la
// vista previa del borrador, la comprobación previa de la emisión y, otra vez, la transacción de
// reserva. No lee capacidades ni inventario (design D12).
import type { DebitNoteIssue } from "@facturador/contracts";
import type { RegisteredSchema } from "../../sri-engine/application/ports.ts";
import { registeredSchema } from "../../sri-engine/application/schemas.ts";
import type { IssuerConfig, IssuerPoint } from "../domain/build-snapshot.ts";
import type { DebitNoteDraftContent } from "../domain/draft.ts";
import {
  evaluateDebitNote,
  type DebitInvoice,
  type DebitNoteEvaluation,
  type ResolvedPaymentMethod,
} from "../domain/evaluation.ts";
import { invoiceTaxTreatments, type InvoiceTaxTreatment } from "../domain/treatments.ts";
import type { DebitNotesReads, DebitSource, InvoiceSourceReader } from "./ports.ts";

/** Tipo y versión del XSD de la nota de débito de este cambio. */
export const DEBIT_NOTE_SCHEMA = { documentType: "05", version: "1.0.0" } as const;

export type ContextReads = Readonly<{
  reads: DebitNotesReads;
  invoices: ReturnType<InvoiceSourceReader>;
}>;

export type DebitContext = Readonly<{
  invoice: DebitSource;
  treatments: readonly InvoiceTaxTreatment[];
  config: IssuerConfig | null;
  point: (IssuerPoint & Readonly<{ available: boolean }>) | null;
  schema: RegisteredSchema | null;
  payment: ResolvedPaymentMethod | null;
  evaluation: DebitNoteEvaluation;
}>;

const issue = (code: DebitNoteIssue["code"], message: string): DebitNoteIssue => ({
  code,
  message,
  concept: null,
});

/** La factura de origen como la evalúa el dominio. */
export function debitInvoiceOf(
  invoice: DebitSource,
  treatments: readonly InvoiceTaxTreatment[],
): DebitInvoice {
  return {
    state: invoice.state,
    intact: invoice.integrity.intact,
    consumerFinal: invoice.consumerFinal,
    environment: invoice.environment,
    treatments,
  };
}

/** Preparación de la empresa, del punto, de la firma y del esquema, en el orden de design D4. */
async function readiness(
  reads: DebitNotesReads,
  companyId: string,
  emissionPointId: string | null,
): Promise<Pick<DebitContext, "config" | "point" | "schema"> & { issues: DebitNoteIssue[] }> {
  const issues: DebitNoteIssue[] = [];
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
      issue("DEBIT_NOTE_DRAFT_INCOMPLETE", "Elige el punto de emisión de la nota de débito."),
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
    DEBIT_NOTE_SCHEMA.documentType,
    DEBIT_NOTE_SCHEMA.version,
  );
  if (!schema) {
    issues.push(
      issue(
        "SCHEMA_NOT_AVAILABLE",
        "El esquema XSD de la nota de débito 1.0.0 no está registrado.",
      ),
    );
  }
  return { config, point, schema, issues };
}

/**
 * La forma de pago del borrador resuelta con el resolver de `catalogs` en la fecha (design D8):
 * existe, tiene versión vigente y está habilitada para la empresa, o no es utilizable.
 */
export async function resolvePaymentMethod(
  reads: DebitNotesReads,
  companyId: string,
  entryKey: string | null,
  date: string,
): Promise<ResolvedPaymentMethod | null> {
  if (entryKey === null) return null;
  const available = (await reads.paymentMethods(companyId, date)).get(entryKey);
  const version = available?.usable ? available.applicable : null;
  return {
    entryKey,
    usable: version !== null && version !== undefined,
    version: version
      ? {
          code: version.code,
          versionId: version.id,
          datasetVersion: version.datasetVersion,
          officialLabel: version.officialLabel,
        }
      : null,
  };
}

export async function loadDebitContext(
  source: ContextReads,
  companyId: string,
  invoice: DebitSource,
  draft: DebitNoteDraftContent,
  date: string,
  declarations?: Readonly<{ version: number; statements: readonly string[] }>,
): Promise<DebitContext> {
  const treatments = invoiceTaxTreatments(invoice.lines);
  const ready = await readiness(source.reads, companyId, draft.emissionPointId);
  const payment = await resolvePaymentMethod(source.reads, companyId, draft.paymentMethod, date);
  const evaluation = evaluateDebitNote({
    invoice: debitInvoiceOf(invoice, treatments),
    companyEnvironment: ready.config?.environment ?? null,
    request: {
      concepts: draft.concepts,
      payment,
      ...(declarations ? { declarations } : {}),
    },
    readiness: ready.issues,
  });
  return {
    invoice,
    treatments,
    config: ready.config,
    point: ready.point,
    schema: ready.schema,
    payment,
    evaluation,
  };
}
