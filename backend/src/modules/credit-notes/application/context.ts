// Contexto de la evaluación de una nota (add-credit-notes, design D3, D4 y D10): lee la factura de
// origen con su integridad, la capacidad acreditable vigente, la devolvible de sus productos y la
// preparación de la empresa, y entrega la evaluación pura. La usan la vista previa del borrador, la
// comprobación previa de la emisión y, otra vez, la transacción de reserva.
import { compareDecimalStrings, type CreditNoteIssue } from "@facturador/contracts";
import type { RegisteredSchema } from "../../sri-engine/application/ports.ts";
import { registeredSchema } from "../../sri-engine/application/schemas.ts";
import type { IssuerConfig, IssuerPoint } from "../domain/build-snapshot.ts";
import type { CreditNoteDraftRecord } from "../domain/draft.ts";
import {
  evaluateCreditNote,
  type CreditInvoice,
  type CreditNoteEvaluation,
} from "../domain/evaluation.ts";
import type {
  CreditCapacityRepository,
  CreditCapacityState,
  CreditNotesReads,
  CreditSource,
  InvoiceCreditSourceReader,
  ReturnCapacity,
} from "./ports.ts";

/** Tipo y versión del XSD de la nota de crédito de este cambio. */
export const CREDIT_NOTE_SCHEMA = { documentType: "04", version: "1.1.0" } as const;

export type ContextReads = Readonly<{
  reads: CreditNotesReads;
  invoices: ReturnType<InvoiceCreditSourceReader>;
  capacity: Pick<CreditCapacityRepository, "read">;
  returns: Pick<ReturnType<ReturnCapacity>, "available">;
}>;

export type CreditContext = Readonly<{
  invoice: CreditSource;
  config: IssuerConfig | null;
  point: (IssuerPoint & Readonly<{ available: boolean }>) | null;
  schema: RegisteredSchema | null;
  capacity: CreditCapacityState;
  returnable: ReadonlyMap<string, string>;
  evaluation: CreditNoteEvaluation;
}>;

const issue = (code: CreditNoteIssue["code"], message: string): CreditNoteIssue => ({
  code,
  message,
  line: null,
});

const ENVIRONMENT_LABELS = { TEST: "pruebas", PRODUCTION: "producción" } as const;

/** La factura de origen como la evalúa el dominio. */
export function creditInvoiceOf(invoice: CreditSource): CreditInvoice {
  return {
    state: invoice.state,
    intact: invoice.integrity.intact,
    consumerFinal: invoice.consumerFinal,
    total: invoice.totals.total,
    lines: invoice.lines,
  };
}

/** Preparación de la empresa, del punto, de la firma y del esquema, en el orden de design D4. */
async function readiness(
  reads: CreditNotesReads,
  companyId: string,
  invoice: CreditSource,
  emissionPointId: string | null,
): Promise<Pick<CreditContext, "config" | "point" | "schema"> & { issues: CreditNoteIssue[] }> {
  const issues: CreditNoteIssue[] = [];
  const config = await reads.currentConfig(companyId);
  if (!config) {
    issues.push(
      issue(
        "TAXPAYER_NOT_CONFIGURED",
        "Registra los datos tributarios de la empresa antes de emitir.",
      ),
    );
  } else if (config.environment !== invoice.environment) {
    issues.push(
      issue(
        "CREDIT_NOTE_INVOICE_NOT_ELIGIBLE",
        `La factura es del ambiente de ${ENVIRONMENT_LABELS[invoice.environment]} y la empresa emite en ${ENVIRONMENT_LABELS[config.environment]}: la nota de crédito debe ser del mismo ambiente.`,
      ),
    );
  }
  const point = emissionPointId ? await reads.emissionPoint(companyId, emissionPointId) : null;
  if (!emissionPointId) {
    issues.push(
      issue("CREDIT_NOTE_DRAFT_INCOMPLETE", "Elige el punto de emisión de la nota de crédito."),
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
    CREDIT_NOTE_SCHEMA.documentType,
    CREDIT_NOTE_SCHEMA.version,
  );
  if (!schema) {
    issues.push(
      issue(
        "SCHEMA_NOT_AVAILABLE",
        "El esquema XSD de la nota de crédito 1.1.0 no está registrado.",
      ),
    );
  }
  return { config, point, schema, issues };
}

/** Productos de las líneas que afectaban al inventario: los únicos con retorno físico posible. */
const returnableProducts = (invoice: CreditSource) => [
  ...new Set(
    invoice.lines.filter((line) => line.inventoryAffectsStock).map((line) => line.productId),
  ),
];

export async function loadCreditContext(
  source: ContextReads,
  companyId: string,
  invoice: CreditSource,
  draft: Pick<CreditNoteDraftRecord, "emissionPointId" | "cause" | "reason" | "lines">,
  declarations?: Readonly<{ version: number; statements: readonly string[] }>,
): Promise<CreditContext> {
  const ready = await readiness(source.reads, companyId, invoice, draft.emissionPointId);
  const capacity = await source.capacity.read(companyId, invoice.id);
  const products = returnableProducts(invoice);
  const returnable =
    products.length > 0
      ? await source.returns.available(companyId, invoice.id, products)
      : new Map<string, string>();
  const evaluation = evaluateCreditNote({
    invoice: creditInvoiceOf(invoice),
    credit: { reserved: capacity.reserved, applied: capacity.applied, credited: capacity.credited },
    returnable,
    request: {
      cause: draft.cause,
      reason: draft.reason,
      lines: draft.lines,
      ...(declarations ? { declarations } : {}),
    },
    readiness: ready.issues,
  });
  return {
    invoice,
    config: ready.config,
    point: ready.point,
    schema: ready.schema,
    capacity,
    returnable,
    evaluation,
  };
}

/** Retornos físicos por producto de las líneas resueltas, para reservar la capacidad devolvible. */
export function returnsOf(context: CreditContext): { productId: string; quantity: string }[] {
  const products = new Map(context.invoice.lines.map((line) => [line.position, line.productId]));
  return context.evaluation.lines
    .filter((line) => compareDecimalStrings(line.physicalReturn, "0") > 0)
    .map((line) => ({ productId: products.get(line.position)!, quantity: line.physicalReturn }));
}
