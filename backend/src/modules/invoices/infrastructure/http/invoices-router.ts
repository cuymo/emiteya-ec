// Rutas de borradores y facturas bajo /api/v1 (add-invoice-emission, design D13; add-sri-transmission,
// design D18). La empresa, el rol y el autor salen del contexto de la sesión; un recurso de otra
// empresa es `404`. La emisión mide sus etapas (design D16) y solo con EMISSION_STAGE_TIMINGS=1 las
// devuelve en `Server-Timing`. Ninguna ruta envía al SRI ni expone XML o respuestas originales.
import { Router, type Response } from "express";
import {
  IDEMPOTENCY_KEY_HEADER,
  type DraftSummaryView,
  type DraftView,
  type InvoiceSummaryView,
  type InvoiceTotalsView,
  type InvoiceTransmissionView,
  type InvoiceView,
  type ListMeta,
  type SriMessageView,
} from "@facturador/contracts";
import { AppError } from "../../../../platform/http/errors.ts";
import {
  createStageTimings,
  serverTimingHeader,
} from "../../../../platform/metrics/stage-timings.ts";
import type { StoredDocument } from "../../../fiscal/application/ports.ts";
import { contextOf } from "../../../identity/infrastructure/http/request-context.ts";
import { diagnosticMessage, isAttemptCode } from "../../application/diagnostics.ts";
import type { DraftDetails, Drafts } from "../../application/drafts.ts";
import type { Emission } from "../../application/emission.ts";
import type {
  InvoiceDetails,
  InvoiceListItem,
  InvoiceTransmission,
  Invoices,
} from "../../application/invoices.ts";
import { stopMessage } from "../../application/transmission-messages.ts";
import type { InvoiceTotals } from "../../domain/amounts.ts";
import type { InvoiceSnapshot } from "../../domain/snapshot.ts";
import { stockWarnings } from "../../domain/stock-warnings.ts";
import type { EmissionObserver, EmissionOutcome } from "../metrics.ts";
import { documentBuyer } from "../../../fiscal/application/ports.ts";

function send<T>(res: Response, status: number, data: T, meta?: ListMeta) {
  res.status(status).json(meta ? { data, meta } : { data });
}

const totalsView = (totals: InvoiceTotals): InvoiceTotalsView => ({
  withoutTaxes: totals.withoutTaxes,
  discount: totals.discount,
  taxes: totals.taxes.map(({ taxCode, rateCode, percentage, base, amount }) => ({
    taxCode,
    rateCode,
    percentage,
    base,
    amount,
  })),
  total: totals.total,
});

function emissionPointView({ input }: DraftDetails): DraftView["emissionPoint"] {
  if (!input.point) return null;
  return {
    id: input.point.point.id,
    establishmentCode: input.point.establishment.code,
    code: input.point.point.code,
    available:
      input.point.point.status === "ACTIVE" && input.point.establishment.status === "ACTIVE",
  };
}

function buyerView({ input }: DraftDetails): DraftView["buyer"] {
  const buyer = input.buyer;
  if (!buyer) return null;
  return {
    id: buyer.id,
    identificationType: buyer.identificationType,
    identification: buyer.identification,
    legalName: buyer.legalName,
    status: buyer.status,
    systemRecord: buyer.systemRecord === "CONSUMER_FINAL" ? "CONSUMER_FINAL" : null,
  };
}

export function toDraftView(details: DraftDetails): DraftView {
  const { draft, input, evaluation } = details;
  return {
    id: draft.id,
    version: draft.version,
    emissionPoint: emissionPointView(details),
    buyer: buyerView(details),
    lines: draft.lines.map((line) => {
      const item = input.products.get(line.productId);
      return {
        position: line.position,
        product: {
          id: line.productId,
          mainCode: item?.mainCode ?? null,
          name: item?.name ?? "",
          unitPrice: item?.unitPrice ?? "0",
          status: item?.status ?? "INACTIVE",
        },
        quantity: line.quantity,
        discount: line.discount,
      };
    }),
    payments: draft.payments.map((payment) => {
      const method = input.paymentMethods.get(payment.paymentMethod);
      return {
        position: payment.position,
        paymentMethod: payment.paymentMethod,
        code: method?.code ?? payment.paymentMethod,
        officialLabel: method ? (method.applicable ?? method.latest).officialLabel : null,
        amount: payment.amount,
      };
    }),
    preview: {
      evaluatedOn: input.issueDate,
      lines: evaluation.lines.map((line) => ({
        position: line.position,
        unitPrice: line.unitPrice,
        taxableBase: line.taxableBase,
        taxes: line.taxes.map(({ taxCode, rateCode, percentage, base, amount }) => ({
          taxCode,
          rateCode,
          percentage,
          base,
          amount,
        })),
      })),
      totals: evaluation.totals ? totalsView(evaluation.totals) : null,
      issues: [...evaluation.issues],
      stockWarnings: stockWarnings(input),
    },
    createdAt: draft.createdAt.toISOString(),
    createdBy: draft.createdBy,
    updatedAt: draft.updatedAt.toISOString(),
    updatedBy: draft.updatedBy,
  };
}

export function toDraftSummaryView(details: DraftDetails): DraftSummaryView {
  return {
    id: details.draft.id,
    version: details.draft.version,
    emissionPoint: emissionPointView(details),
    buyer: buyerView(details),
    lineCount: details.draft.lines.length,
    previewTotal: details.evaluation.totals?.total ?? null,
    updatedAt: details.draft.updatedAt.toISOString(),
  };
}

/** Artefacto firmado de una factura: solo su hash y su tamaño, nunca los bytes. */
export type ArtifactSummary = Readonly<{ sha256: string; sizeBytes: number }>;

function diagnosticView(document: StoredDocument): InvoiceView["diagnostic"] {
  const attempt = document.lastAttempt;
  if (document.state !== "RESERVED" || !attempt || !isAttemptCode(attempt.code)) return null;
  return {
    stage: attempt.stage as NonNullable<InvoiceView["diagnostic"]>["stage"],
    code: attempt.code,
    class: attempt.class,
    message: diagnosticMessage(attempt.code, attempt.detail),
    at: attempt.at.toISOString(),
    attemptCount: document.attemptCount,
  };
}

const messagesView = (messages: readonly SriMessageView[]): SriMessageView[] =>
  messages.map(({ identifier, message, additionalInformation, type }) => ({
    identifier,
    message,
    additionalInformation,
    type,
  }));

/** Resumen de la transmisión (design D18): sin respuestas originales, XML ni datos técnicos. */
function transmissionView({ document, transmission }: InvoiceDetails): InvoiceView["transmission"] {
  return {
    inProgress: transmission.inProgress,
    stopped: transmission.stopped
      ? {
          code: transmission.stopped.code,
          message: stopMessage(transmission.stopped.code),
          at: transmission.stopped.at.toISOString(),
        }
      : null,
    reconcilable: transmission.reconcilable,
    authorization: document.authorization
      ? {
          number: document.authorization.number,
          authorizedAt: document.authorization.date.toISOString(),
          environment: document.authorization.environment,
        }
      : null,
    lastResult: transmission.lastResult
      ? {
          operation: transmission.lastResult.operation,
          outcome: transmission.lastResult.outcome,
          at: transmission.lastResult.at.toISOString(),
          messages: messagesView(transmission.lastResult.messages),
        }
      : null,
  };
}

/** Factura desde su snapshot: lo que se emitió, aunque después cambien productos o configuración. */
export function toInvoiceView(details: InvoiceDetails): InvoiceView {
  const { document, artifact, authorizedArtifact } = details;
  const snapshot = document.snapshot as InvoiceSnapshot;
  const { issuer, buyer } = snapshot;
  return {
    id: document.id,
    documentType: document.documentType,
    environment: document.environment,
    documentNumber: document.documentNumber,
    accessKey: document.accessKey,
    issueDate: document.issueDate,
    state: document.state,
    issuer: {
      ruc: issuer.ruc,
      legalName: issuer.legalName,
      tradeName: issuer.tradeName,
      headOfficeAddress: issuer.headOfficeAddress,
      establishmentAddress: issuer.establishment.address,
      accountingRequired: issuer.accountingRequired,
      specialTaxpayerNumber: issuer.specialTaxpayerNumber,
      withholdingAgentResolution: issuer.withholdingAgentResolution,
      rimpeCategory: issuer.rimpeCategory,
    },
    buyer: {
      identificationType: buyer.identificationType,
      identification: buyer.identification,
      legalName: buyer.legalName,
      address: buyer.address,
      consumerFinal: buyer.consumerFinal,
    },
    lines: snapshot.lines.map((line) => ({
      position: line.position,
      mainCode: line.mainCode,
      auxiliaryCode: line.auxiliaryCode,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discount: line.discount,
      taxableBase: line.taxableBase,
      taxes: line.taxes.map(({ taxCode, rateCode, percentage, base, amount }) => ({
        taxCode,
        rateCode,
        percentage,
        base,
        amount,
      })),
    })),
    payments: snapshot.payments.map((payment) => ({ code: payment.code, amount: payment.amount })),
    totals: {
      withoutTaxes: snapshot.totals.withoutTaxes,
      discount: snapshot.totals.discount,
      taxes: snapshot.totals.taxes.map(({ taxCode, rateCode, percentage, base, amount }) => ({
        taxCode,
        rateCode,
        percentage,
        base,
        amount,
      })),
      total: snapshot.totals.total,
    },
    diagnostic: diagnosticView(document),
    artifact: artifact ? { sha256: artifact.sha256, sizeBytes: artifact.sizeBytes } : null,
    authorizedArtifact: authorizedArtifact
      ? { sha256: authorizedArtifact.sha256, sizeBytes: authorizedArtifact.sizeBytes }
      : null,
    transmission: transmissionView(details),
    createdAt: document.createdAt.toISOString(),
    signedAt: document.signedAt?.toISOString() ?? null,
  };
}

export function toInvoiceSummaryView({
  document,
  transmissionStopped,
}: InvoiceListItem): InvoiceSummaryView {
  const diagnostic = diagnosticView(document);
  return {
    id: document.id,
    documentNumber: document.documentNumber,
    environment: document.environment,
    issueDate: document.issueDate,
    buyerIdentification: documentBuyer(document).identification,
    buyerName: documentBuyer(document).name,
    total: documentBuyer(document).total,
    state: document.state,
    diagnosticCode: diagnostic?.code ?? null,
    transmissionStopped,
    createdAt: document.createdAt.toISOString(),
  };
}

/** Historial de la transmisión: transiciones e intentos resumidos (design D18). */
export function toTransmissionView({
  document,
  events,
  total,
}: InvoiceTransmission): InvoiceTransmissionView {
  return {
    invoiceId: document.id,
    state: document.state,
    events: events.map((event) =>
      event.kind === "TRANSITION"
        ? {
            kind: "TRANSITION",
            at: event.at.toISOString(),
            fromState: event.from,
            toState: event.to,
            cause: event.cause,
            actor: event.actor,
            actorName: event.actorName,
          }
        : {
            kind: "ATTEMPT",
            at: event.at.toISOString(),
            operation: event.operation,
            origin: event.origin,
            outcome: event.outcome,
            messages: messagesView(event.messages),
          },
    ),
    total,
  };
}

const param = (value: unknown) => String(value);

export type InvoicesRouterDependencies = {
  drafts: Drafts;
  emission: Emission;
  invoices: Invoices;
  /** Histograma de las etapas de la emisión, si hay registro de métricas. */
  observeEmission?: EmissionObserver;
  /** EMISSION_STAGE_TIMINGS: cabecera `Server-Timing` en la emisión. */
  serverTiming?: boolean;
};

const invoiceOf = (details: InvoiceDetails) => toInvoiceView(details);

export function invoicesRouter({
  drafts,
  emission,
  invoices,
  observeEmission,
  serverTiming,
}: InvoicesRouterDependencies): Router {
  const router = Router();

  router.get("/invoices/drafts", async (req, res) => {
    const { items, meta } = await drafts.list(contextOf(res), req.query);
    send(res, 200, items.map(toDraftSummaryView), meta);
  });

  router.post("/invoices/drafts", async (req, res) => {
    send(res, 201, toDraftView(await drafts.create(contextOf(res), req.body)));
  });

  router.get("/invoices/drafts/:draftId", async (req, res) => {
    send(res, 200, toDraftView(await drafts.get(contextOf(res), param(req.params.draftId))));
  });

  router.put("/invoices/drafts/:draftId", async (req, res) => {
    const details = await drafts.update(contextOf(res), param(req.params.draftId), req.body);
    send(res, 200, toDraftView(details));
  });

  router.delete("/invoices/drafts/:draftId", async (req, res) => {
    await drafts.remove(contextOf(res), param(req.params.draftId));
    res.status(204).end();
  });

  router.post("/invoices", async (req, res) => {
    const timings = createStageTimings();
    let outcome: EmissionOutcome = "error";
    let result: { view: InvoiceView; replayed: boolean };
    try {
      result = await timings.envelope("total", async () => {
        const { document, replayed } = await emission.emit(
          contextOf(res),
          req.header(IDEMPOTENCY_KEY_HEADER),
          req.body,
          timings,
        );
        return { view: invoiceOf(await invoices.details(document)), replayed };
      });
      outcome = result.replayed
        ? "replayed"
        : result.view.state === "SIGNED"
          ? "signed"
          : "reserved";
    } catch (error) {
      outcome = error instanceof AppError && error.status < 500 ? "rejected" : "error";
      throw error;
    } finally {
      observeEmission?.(timings.entries(), outcome);
      if (serverTiming) res.setHeader("Server-Timing", serverTimingHeader(timings.entries()));
    }
    send(res, result.replayed ? 200 : 201, result.view);
  });

  router.get("/invoices", async (req, res) => {
    const { items, meta } = await invoices.list(contextOf(res), req.query);
    send(res, 200, items.map(toInvoiceSummaryView), meta);
  });

  router.get("/invoices/:invoiceId", async (req, res) => {
    send(res, 200, invoiceOf(await invoices.get(contextOf(res), param(req.params.invoiceId))));
  });

  router.post("/invoices/:invoiceId/signing-attempts", async (req, res) => {
    const details = await invoices.retrySigning(contextOf(res), param(req.params.invoiceId));
    send(res, 200, invoiceOf(details));
  });

  router.get("/invoices/:invoiceId/transmission", async (req, res) => {
    const view = await invoices.transmission(contextOf(res), param(req.params.invoiceId));
    send(res, 200, toTransmissionView(view));
  });

  router.post("/invoices/:invoiceId/reconciliations", async (req, res) => {
    const details = await invoices.requestReconciliation(
      contextOf(res),
      param(req.params.invoiceId),
      req.body,
    );
    send(res, 202, invoiceOf(details));
  });

  return router;
}
