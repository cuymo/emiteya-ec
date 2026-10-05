// Rutas de las notas de crédito bajo /api/v1 (add-credit-notes, design D16). La empresa, el rol y el
// autor salen del contexto de la sesión; un recurso de otra empresa es `404`. Ninguna ruta envía al
// SRI ni expone XML o respuestas originales.
import { Router, type Response } from "express";
import { IDEMPOTENCY_KEY_HEADER, type ListMeta } from "@facturador/contracts";
import { contextOf } from "../../../identity/infrastructure/http/request-context.ts";
import type { CreditNotes } from "../../application/credit-notes.ts";
import type { CreditNoteDrafts } from "../../application/drafts.ts";
import type { CreditNoteEmission } from "../../application/emission.ts";
import {
  toCreditNoteDraftSummaryView,
  toCreditNoteDraftView,
  toCreditNoteView,
  toEligibleInvoiceView,
} from "./views.ts";

function send<T>(res: Response, status: number, data: T, meta?: ListMeta) {
  res.status(status).json(meta ? { data, meta } : { data });
}

const param = (value: unknown) => String(value);

export type CreditNotesRouterDependencies = {
  drafts: CreditNoteDrafts;
  emission: CreditNoteEmission;
  creditNotes: CreditNotes;
};

export function creditNotesRouter({
  drafts,
  emission,
  creditNotes,
}: CreditNotesRouterDependencies): Router {
  const router = Router();

  router.get("/credit-notes/eligible-invoices", async (req, res) => {
    const { items, meta } = await creditNotes.eligibleInvoices(contextOf(res), req.query);
    send(res, 200, items.map(toEligibleInvoiceView), meta);
  });

  router.get("/credit-notes/drafts", async (req, res) => {
    const { items, meta } = await drafts.list(contextOf(res), req.query);
    send(res, 200, items.map(toCreditNoteDraftSummaryView), meta);
  });

  router.post("/credit-notes/drafts", async (req, res) => {
    send(res, 201, toCreditNoteDraftView(await drafts.create(contextOf(res), req.body)));
  });

  router.get("/credit-notes/drafts/:draftId", async (req, res) => {
    send(
      res,
      200,
      toCreditNoteDraftView(await drafts.get(contextOf(res), param(req.params.draftId))),
    );
  });

  router.put("/credit-notes/drafts/:draftId", async (req, res) => {
    const details = await drafts.update(contextOf(res), param(req.params.draftId), req.body);
    send(res, 200, toCreditNoteDraftView(details));
  });

  router.delete("/credit-notes/drafts/:draftId", async (req, res) => {
    await drafts.remove(contextOf(res), param(req.params.draftId));
    res.status(204).end();
  });

  router.post("/credit-notes", async (req, res) => {
    const { document, replayed } = await emission.emit(
      contextOf(res),
      req.header(IDEMPOTENCY_KEY_HEADER),
      req.body,
    );
    send(res, replayed ? 200 : 201, toCreditNoteView(await creditNotes.details(document)));
  });

  router.post("/credit-notes/:creditNoteId/signing-attempts", async (req, res) => {
    const details = await creditNotes.retrySigning(contextOf(res), param(req.params.creditNoteId));
    send(res, 200, toCreditNoteView(details));
  });

  return router;
}
