// Datos de Retenciones (add-withholding-receipts, design D20, D21 y D24): la consulta y el detalle
// desde el snapshot, los borradores con la vista previa del servidor, las opciones utilizables, los
// proveedores que pueden ser sujeto retenido, la emisión con una Idempotency-Key estable por
// confirmación y el reintento de la firma. Toda mutación pasa por useMutationFeedback.
"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  IDEMPOTENCY_KEY_HEADER,
  withholdingDraftSummaryViewSchema,
  withholdingDraftViewSchema,
  withholdingListMetaSchema,
  withholdingOptionsViewSchema,
  withholdingReceiptSummaryViewSchema,
  withholdingReceiptViewSchema,
  withholdingSupplierViewSchema,
  type CreateWithholdingDraftInput,
  type InvoiceState,
  type UpdateWithholdingDraftInput,
  type WithholdingDraftView,
  type WithholdingReceiptView,
  type WithholdingSupplierView,
} from "@facturador/contracts";
import { z } from "zod";
import type { EntityPage, EntityPickerQuery } from "@/components/entity-picker-dialog";
import { useMutationFeedback, type SuccessFeedback } from "@/components/feedback";
import { apiFetch, apiFetchPage } from "@/lib/api";

export const WITHHOLDINGS_KEY = ["withholding-receipts"] as const;
export const WITHHOLDING_DRAFTS_KEY = ["withholding-receipt-drafts"] as const;
export const WITHHOLDING_OPTIONS_KEY = ["withholding-receipt-options"] as const;

const draftPath = (id: string) => `/withholding-receipts/drafts/${encodeURIComponent(id)}`;
const receiptPath = (id: string) => `/withholding-receipts/${encodeURIComponent(id)}`;

/** Cada cuánto se refresca una retención con una interacción con el SRI en curso. */
const TRANSMISSION_REFRESH_MS = 5_000;

/** Mensajes de los conflictos que el usuario puede resolver, con lo que conviene hacer. */
export const WITHHOLDING_CONFLICT_MESSAGES: Record<string, string> = {
  WITHHOLDING_DRAFT_CHANGED:
    "Alguien cambió este borrador mientras lo revisabas. Recárgalo para ver la versión vigente.",
  WITHHOLDING_DRAFT_ALREADY_EMITTED:
    "Este borrador ya se emitió. Encuentra la retención en la lista de retenciones.",
  WITHHOLDING_RESOURCE_LIMIT:
    "El borrador supera un límite de recursos del sistema (no es una regla del SRI). Quita documentos, impuestos, pagos o retenciones.",
  WITHHOLDING_ENTRY_NOT_USABLE:
    "Un concepto o código ya no está vigente o habilitado. Elige otro con la vista previa actualizada.",
  WITHHOLDING_SUBJECT_INACTIVE:
    "El proveedor está desactivado. Actívalo en Terceros o elige otro proveedor.",
  WITHHOLDING_SUBJECT_NOT_SUPPLIER:
    "El tercero ya no tiene el rol de proveedor. Agrégaselo en Terceros o elige otro proveedor.",
  WITHHOLDING_FISCAL_PERIOD_IN_FUTURE:
    "El período fiscal es posterior al mes de emisión. Elige el mes de emisión o uno anterior.",
  WITHHOLDING_SUPPORT_DATE_AFTER_ISSUE:
    "Un documento sustento tiene una fecha posterior a la de emisión. Corrige su fecha.",
  IDEMPOTENCY_KEY_REUSED:
    "La solicitud de emisión ya se usó con otro contenido. Recarga el borrador y vuelve a emitir.",
};

export type WithholdingReceiptsQuery = {
  search: string;
  state: InvoiceState | undefined;
  /** `MM/AAAA`. */
  fiscalPeriod: string | undefined;
  page: number;
  pageSize: number;
};

export function useWithholdingReceipts(query: WithholdingReceiptsQuery, enabled: boolean) {
  return useQuery({
    queryKey: [...WITHHOLDINGS_KEY, "list", query],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({
        page: String(query.page),
        pageSize: String(query.pageSize),
      });
      if (query.search) params.set("search", query.search);
      if (query.state) params.set("state", query.state);
      if (query.fiscalPeriod) params.set("fiscalPeriod", query.fiscalPeriod);
      return apiFetchPage(`/withholding-receipts?${params.toString()}`, {
        schema: z.array(withholdingReceiptSummaryViewSchema),
        meta: withholdingListMetaSchema,
        signal,
      });
    },
  });
}

export function useWithholdingReceipt(id: string, enabled: boolean) {
  return useQuery({
    queryKey: [...WITHHOLDINGS_KEY, "detail", id],
    enabled,
    queryFn: ({ signal }) =>
      apiFetch(receiptPath(id), { schema: withholdingReceiptViewSchema, signal }),
    // Mientras el SRI procesa, el estado se actualiza solo.
    refetchInterval: (query) =>
      query.state.data?.transmission.inProgress ? TRANSMISSION_REFRESH_MS : false,
  });
}

export function useWithholdingDrafts(query: { page: number; pageSize: number }, enabled: boolean) {
  return useQuery({
    queryKey: [...WITHHOLDING_DRAFTS_KEY, "list", query],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      apiFetchPage(`/withholding-receipts/drafts?page=${query.page}&pageSize=${query.pageSize}`, {
        schema: z.array(withholdingDraftSummaryViewSchema),
        meta: withholdingListMetaSchema,
        signal,
      }),
  });
}

export function useWithholdingDraft(id: string, enabled: boolean) {
  return useQuery({
    queryKey: [...WITHHOLDING_DRAFTS_KEY, "detail", id],
    enabled,
    queryFn: ({ signal }) =>
      apiFetch(draftPath(id), { schema: withholdingDraftViewSchema, signal }),
  });
}

/** Impuestos, conceptos, códigos, sustentos, tarifas, formas de pago y límites utilizables. */
export function useWithholdingOptions(enabled: boolean) {
  return useQuery({
    queryKey: WITHHOLDING_OPTIONS_KEY,
    enabled,
    queryFn: ({ signal }) =>
      apiFetch("/withholding-receipts/options", { schema: withholdingOptionsViewSchema, signal }),
  });
}

export function useSaveWithholdingDraft(options: {
  onSuccess: (draft: WithholdingDraftView) => void;
  onError: (error: unknown) => boolean;
  /** Crear el borrador al elegir el proveedor no es "guardar": tiene su propio aviso. */
  success?: string;
}) {
  return useMutationFeedback({
    mutationFn: ({
      id,
      input,
    }: {
      id: string | null;
      input: CreateWithholdingDraftInput | UpdateWithholdingDraftInput;
    }) =>
      id
        ? apiFetch(draftPath(id), {
            method: "PUT",
            json: input,
            schema: withholdingDraftViewSchema,
          })
        : apiFetch("/withholding-receipts/drafts", {
            method: "POST",
            json: input,
            schema: withholdingDraftViewSchema,
          }),
    success: () => options.success ?? "Guardaste el borrador.",
    invalidate: [WITHHOLDING_DRAFTS_KEY],
    errorMessages: WITHHOLDING_CONFLICT_MESSAGES,
    onSuccess: options.onSuccess,
    onError: options.onError,
  });
}

export function useDeleteWithholdingDraft(options: { onSuccess?: () => void } = {}) {
  return useMutationFeedback({
    mutationFn: (id: string) => apiFetch(draftPath(id), { method: "DELETE" }),
    success: () => "Eliminaste el borrador.",
    invalidate: [WITHHOLDING_DRAFTS_KEY],
    ...(options.onSuccess ? { onSuccess: options.onSuccess } : {}),
  });
}

/** Aviso de una retención tras emitirla o reintentar su firma. */
function receiptFeedback(receipt: WithholdingReceiptView, signedMessage: string): SuccessFeedback {
  if (receipt.state === "SIGNED") return signedMessage;
  return {
    tone: "warning",
    message: receipt.diagnostic
      ? `La retención ${receipt.documentNumber} quedó procesando: ${receipt.diagnostic.message}`
      : `La retención ${receipt.documentNumber} quedó procesando.`,
  };
}

/** Emitir: la Idempotency-Key la genera la confirmación y se repite en los reintentos (design D16). */
export function useEmitWithholding(options: {
  onSuccess: (receipt: WithholdingReceiptView) => void;
  onError: (error: unknown) => boolean;
}) {
  return useMutationFeedback({
    mutationFn: ({
      draft,
      idempotencyKey,
    }: {
      draft: { id: string; version: number };
      idempotencyKey: string;
    }) =>
      apiFetch("/withholding-receipts", {
        method: "POST",
        headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
        json: { draftId: draft.id, expectedVersion: draft.version },
        schema: withholdingReceiptViewSchema,
      }),
    success: (receipt) =>
      receiptFeedback(receipt, `Emitiste la retención ${receipt.documentNumber}.`),
    invalidate: [[...WITHHOLDING_DRAFTS_KEY, "list"], WITHHOLDINGS_KEY],
    errorMessages: WITHHOLDING_CONFLICT_MESSAGES,
    onSuccess: options.onSuccess,
    onError: options.onError,
  });
}

export function useRetryWithholdingSigning() {
  return useMutationFeedback({
    mutationFn: (id: string) =>
      apiFetch(`${receiptPath(id)}/signing-attempts`, {
        method: "POST",
        schema: withholdingReceiptViewSchema,
      }),
    success: (receipt) =>
      receiptFeedback(receipt, `Firmaste la retención ${receipt.documentNumber}.`),
    invalidate: [WITHHOLDINGS_KEY],
  });
}

/** Proveedores activos con RUC, cédula o pasaporte, por identificación o razón social. */
export async function fetchWithholdingSuppliers({
  search,
  page,
  pageSize,
  signal,
}: EntityPickerQuery): Promise<EntityPage<WithholdingSupplierView>> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (search) params.set("search", search);
  const { data, meta } = await apiFetchPage(
    `/withholding-receipts/suppliers?${params.toString()}`,
    {
      schema: z.array(withholdingSupplierViewSchema),
      meta: withholdingListMetaSchema,
      signal,
    },
  );
  return { items: data, total: meta.total };
}
