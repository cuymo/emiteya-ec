// Rutas de borradores y facturas bajo /api/v1 (add-invoice-emission, design D13). La empresa, el
// rol y el autor salen del contexto de la sesión; un recurso de otra empresa es `404`.
import { Router, type Response } from "express";
import type {
  DraftSummaryView,
  DraftView,
  InvoiceTotalsView,
  ListMeta,
} from "@facturador/contracts";
import { contextOf } from "../../../identity/infrastructure/http/request-context.ts";
import type { DraftDetails, Drafts } from "../../application/drafts.ts";
import type { InvoiceTotals } from "../../domain/amounts.ts";

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

const param = (value: unknown) => String(value);

export function invoicesRouter({ drafts }: { drafts: Drafts }): Router {
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

  return router;
}
