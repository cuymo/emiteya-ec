// Borrador de liquidación de compra a página completa (add-purchase-settlements, design D24): flujo
// de riesgo (frontend-checklist.md). Usuario: administrador u operador con
// `purchaseSettlements.draft`. Objetivo: documentar una compra a un proveedor que no puede emitir
// comprobantes, sin equivocar su procedencia ni sus importes. Decisiones: el proveedor, las líneas y
// los pagos. Información mínima: proveedor con su dirección, líneas, pagos, importe total, problemas
// y el aviso de la retención. Acción principal: "Emitir liquidación de compra", que pide las cuatro
// declaraciones de procedencia por separado; secundaria: "Guardar borrador". P0: proveedor, importe
// total y problemas; P1: líneas, pagos y declaraciones; P2: códigos y unidades; P3 (identificadores
// y versiones): no se muestran. Los importes y los problemas son la vista previa del servidor del
// borrador guardado: el frontend no calcula dinero.
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  defaultEmissionPointViewSchema,
  type PartyRole,
  type PartyView,
  type PurchaseSettlementDraftView,
  type PurchaseSettlementOptionsView,
  type PurchaseSettlementStatement,
  type PurchaseSettlementSupplierView,
} from "@facturador/contracts";
import { ArrowLeft, Info, Plus, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useFieldArray, useForm, useWatch, type Resolver } from "react-hook-form";
import { AsyncButton } from "@/components/async-button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EntityPickerDialog } from "@/components/entity-picker-dialog";
import { errorMessage } from "@/components/feedback";
import { fieldAria, FormField } from "@/components/form-dialog";
import { useSession } from "@/components/session";
import { EmptyState, ErrorState, Skeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ApiError, apiFetch } from "@/lib/api";
import { formatPercentage, formatUsd } from "@/lib/decimal";
import { canSee } from "@/lib/permissions";
import { ENVIRONMENT_LABELS, useCompanyStatus } from "@/features/company/company-api";
import {
  DEFAULT_POINT_KEY,
  pointLabel,
  useEstablishments,
} from "@/features/establishments/establishments-api";
import { formatIssueDate } from "@/features/invoices/invoice-format";
import { PartyDialog } from "@/features/parties/party-dialog";
import {
  blankLine,
  blankPayment,
  formSchema,
  toForm,
  toInput,
  type FormValues,
  type SupplierValues,
} from "./purchase-settlement-draft-form";
import { IssueList, LineCard, PaymentRow } from "./purchase-settlement-lines";
import {
  PURCHASE_SETTLEMENTS_KEY,
  PURCHASE_SETTLEMENT_CONFLICT_MESSAGES,
  PURCHASE_SETTLEMENT_DRAFTS_KEY,
  fetchPurchaseSuppliers,
  useEmitPurchaseSettlement,
  usePurchaseSettlementDraft,
  usePurchaseSettlementOptions,
  useSavePurchaseSettlementDraft,
} from "./purchase-settlements-api";

/** Rol con que nace un proveedor creado desde la liquidación: marcado y visible, nunca en silencio. */
const SUPPLIER_ROLES: readonly PartyRole[] = ["SUPPLIER"];
const DECLARATIONS_NOTICE =
  "Son declaraciones tuyas sobre el proveedor y la operación: el sistema no puede comprobarlas ni consulta el estado del RUC. Quedan registradas con tu nombre y el momento de la emisión.";

/** Tras guardar, el editor se vuelve a montar con la versión nueva: el foco va al resumen. */
const focusAfterSave = { summary: false };

function useDefaultPoint(enabled: boolean) {
  return useQuery({
    queryKey: DEFAULT_POINT_KEY,
    enabled,
    queryFn: ({ signal }) =>
      apiFetch("/me/default-emission-point", { schema: defaultEmissionPointViewSchema, signal }),
  });
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-1.5">
      <h2 id={id} className="text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Alerta de la operación con una acción de recuperación opcional. */
function OperationAlert({
  message,
  action,
  alertRef,
}: {
  message: string;
  action?: ReactNode;
  alertRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={alertRef}
      role="alert"
      tabIndex={-1}
      className="flex flex-wrap items-center justify-between gap-1 rounded-md border border-danger/40 bg-danger/10 px-1.5 py-1 text-sm"
    >
      <p>{message}</p>
      {action}
    </div>
  );
}

/** El aviso de la retención: una obligación, nunca la evidencia de que la retención exista. */
function WithholdingNotice({ text }: { text: string }) {
  return (
    <p
      role="note"
      className="flex items-start gap-0.5 rounded-md border border-warning/40 bg-warning/10 px-1 py-0.5 text-sm"
    >
      <Info aria-hidden="true" className="mt-0.5 size-2 shrink-0 text-warning" />
      <span>{text}</span>
    </p>
  );
}

/**
 * Elegir el proveedor: terceros activos con el rol, los que no se pueden elegir deshabilitados con su
 * motivo; o registrar uno nuevo con el rol marcado a la vista. El tercero nuevo vuelve elegido.
 */
function SupplierChooser({
  open,
  onOpenChange,
  onChoose,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChoose: (supplier: SupplierValues & { address: string | null }) => void;
}) {
  const [creating, setCreating] = useState(false);
  return (
    <>
      <EntityPickerDialog<PurchaseSettlementSupplierView>
        open={open}
        onOpenChange={onOpenChange}
        title="Elegir proveedor"
        description="Terceros activos con el rol de proveedor. La liquidación admite cédula o pasaporte."
        searchLabel="Buscar por identificación o nombre"
        searchPlaceholder="Identificación o nombre"
        queryKey={[...PURCHASE_SETTLEMENTS_KEY, "suppliers"]}
        fetchPage={fetchPurchaseSuppliers}
        getKey={(supplier) => supplier.id}
        getLabel={(supplier) =>
          supplier.selectable
            ? `${supplier.legalName}, ${supplier.identification}`
            : `${supplier.legalName}, ${supplier.identification}, no se puede elegir`
        }
        isDisabled={(supplier) => !supplier.selectable}
        renderItem={(supplier) => (
          <span className="flex min-w-0 flex-col">
            <span className="font-medium break-words">{supplier.legalName}</span>
            <span className="text-sm text-foreground-muted tabular-nums">
              {supplier.identification}
            </span>
            {supplier.reason && <span className="text-xs text-danger">{supplier.reason}</span>}
          </span>
        )}
        onSelect={onChoose}
        quickOption={{
          label: "Nuevo proveedor",
          description: "Registrar un tercero con el rol de proveedor.",
          onSelect: () => setCreating(true),
        }}
        emptyTitle="No hay proveedores que coincidan"
        emptyDescription="Registra el proveedor o agrégale el rol de proveedor en Terceros."
      />
      <PartyDialog
        open={creating}
        party={null}
        initialRoles={SUPPLIER_ROLES}
        onClose={() => setCreating(false)}
        onShowExisting={() => {
          setCreating(false);
          onOpenChange(true);
        }}
        onSaved={(party: PartyView) => onChoose(party)}
      />
    </>
  );
}

function DraftEditor({
  draft,
  options,
  canEmit,
}: {
  draft: PurchaseSettlementDraftView;
  options: PurchaseSettlementOptionsView;
  canEmit: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [operationError, setOperationError] = useState<{ message: string; code?: string }>();
  const alertRef = useRef<HTMLDivElement>(null);
  /** La emisión acaba de fallar: al cerrar la confirmación, el foco va al aviso. */
  const emissionFailed = useRef(false);
  const summaryRef = useRef<HTMLHeadingElement>(null);
  const addLineRef = useRef<HTMLButtonElement>(null);
  const addPaymentRef = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [declared, setDeclared] = useState<PurchaseSettlementStatement[]>([]);
  const [choosing, setChoosing] = useState(false);
  // Una clave por versión del borrador (el editor se vuelve a montar con cada versión): un
  // reintento de la misma solicitud la repite y el servidor devuelve o retoma la misma liquidación.
  const idempotencyKey = useRef<string>("");
  const establishments = useEstablishments();
  const status = useCompanyStatus();
  const defaultPoint = useDefaultPoint(draft.emissionPoint === null);
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema) as unknown as Resolver<FormValues>,
    defaultValues: toForm(draft),
  });
  const { isDirty } = form.formState;
  const errors = form.formState.errors;
  const lines = useFieldArray({ control: form.control, name: "lines" });
  const payments = useFieldArray({ control: form.control, name: "payments" });
  const values = useWatch({ control: form.control });
  const pointId = values.emissionPointId ?? "";
  const supplier = values.supplier ?? null;

  // Un borrador sin punto empieza en el punto predeterminado del usuario, si sigue disponible.
  useEffect(() => {
    const point = defaultPoint.data?.available ? defaultPoint.data.emissionPoint.id : undefined;
    if (point && !form.getValues("emissionPointId")) {
      form.setValue("emissionPointId", point, { shouldDirty: true });
    }
  }, [defaultPoint.data, form]);

  useEffect(() => {
    if (operationError) alertRef.current?.focus();
  }, [operationError]);

  useEffect(() => {
    if (focusAfterSave.summary) {
      focusAfterSave.summary = false;
      summaryRef.current?.focus();
    }
  }, []);

  const fail = (error: unknown) => {
    setOperationError({
      message: errorMessage(error, PURCHASE_SETTLEMENT_CONFLICT_MESSAGES),
      ...(error instanceof ApiError ? { code: error.code } : {}),
    });
    return true;
  };
  const refresh = () => {
    setOperationError(undefined);
    void queryClient.invalidateQueries({
      queryKey: [...PURCHASE_SETTLEMENT_DRAFTS_KEY, "detail", draft.id],
    });
    void queryClient.invalidateQueries({ queryKey: PURCHASE_SETTLEMENTS_KEY });
  };
  const save = useSavePurchaseSettlementDraft({
    onSuccess: (saved) => {
      setOperationError(undefined);
      focusAfterSave.summary = true;
      queryClient.setQueryData([...PURCHASE_SETTLEMENT_DRAFTS_KEY, "detail", saved.id], saved);
    },
    onError: fail,
  });
  const emit = useEmitPurchaseSettlement({
    onSuccess: (settlement) => router.push(`/liquidaciones-compra/${settlement.id}`),
    onError: (error) => {
      emissionFailed.current = true;
      setConfirming(false);
      setDeclared([]);
      // Un proveedor, un producto, un catálogo o el borrador cambiaron: la vista previa se vuelve a
      // pedir. Un borrador cambiado se recarga a pedido: la versión nueva vuelve a montar el editor.
      if (
        error instanceof ApiError &&
        error.status === 409 &&
        error.code !== "PURCHASE_SETTLEMENT_DRAFT_CHANGED"
      )
        refresh();
      return fail(error);
    },
  });

  const points = (establishments.data ?? []).flatMap((establishment) =>
    establishment.emissionPoints
      .filter((point) => point.available || point.id === pointId)
      .map((point) => ({
        id: point.id,
        label: `${pointLabel(establishment, point)} · ${establishment.address}`,
      })),
  );

  const preview = draft.preview;
  const fresh = !isDirty;
  const issues = preview.issues;
  const lineIssues = (position: number) => issues.filter((issue) => issue.line === position);
  const paymentIssues = (position: number) => issues.filter((issue) => issue.payment === position);
  const generalIssues = issues.filter((issue) => issue.line === null && issue.payment === null);
  const environment = status.data ? ENVIRONMENT_LABELS[status.data.environment] : null;
  const emitBlocked = isDirty || issues.length > 0 || save.isPending;
  const emitHintId = useId();
  const emitHint = isDirty
    ? "Guarda los cambios antes de emitir."
    : issues.length > 0
      ? "Resuelve los problemas antes de emitir."
      : undefined;
  const { limits, policy } = options;
  const totals = preview.totals;
  const statements = policy.statements;
  const allDeclared = statements.every((statement) => declared.includes(statement.id));
  const addressHint =
    "La del proveedor, propuesta desde Terceros al elegirlo; corrígela si hace falta.";

  const onSave = form.handleSubmit((formValues) => {
    setOperationError(undefined);
    save.mutate({
      id: draft.id,
      input: { ...toInput(formValues), expectedVersion: draft.version },
    });
  });

  const chooseSupplier = (chosen: SupplierValues & { address: string | null }) => {
    form.setValue(
      "supplier",
      { id: chosen.id, legalName: chosen.legalName, identification: chosen.identification },
      { shouldDirty: true },
    );
    // La dirección se propone desde el tercero; nunca reemplaza una dirección escrita.
    if (chosen.address && !form.getValues("supplierAddress").trim()) {
      form.setValue("supplierAddress", chosen.address, { shouldDirty: true });
    }
  };
  const removeLine = (index: number) => {
    lines.remove(index);
    addLineRef.current?.focus();
  };
  const removePayment = (index: number) => {
    payments.remove(index);
    addPaymentRef.current?.focus();
  };

  const recovery =
    operationError?.code === "PURCHASE_SETTLEMENT_DRAFT_CHANGED" ? (
      <Button variant="outline" onClick={refresh}>
        Recargar borrador
      </Button>
    ) : operationError?.code === "PURCHASE_SETTLEMENT_DRAFT_ALREADY_EMITTED" ? (
      <Button asChild variant="outline">
        <Link href="/liquidaciones-compra">Ver liquidaciones de compra</Link>
      </Button>
    ) : undefined;

  /** Lo que falta o sobra de los pagos frente al importe total, según la vista previa. */
  const paymentsDifference =
    fresh && totals && preview.paymentsTotal !== null
      ? `Pagos ${formatUsd(preview.paymentsTotal)} de un importe total de ${formatUsd(totals.total)}.`
      : null;

  return (
    <section aria-labelledby="editor-titulo" className="flex flex-col gap-3">
      <Header title="Borrador de liquidación de compra" />

      {operationError && (
        <OperationAlert message={operationError.message} action={recovery} alertRef={alertRef} />
      )}

      <form noValidate onSubmit={onSave} className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-3">
          <Section title="Punto de emisión">
            <FormField id="punto" label="Punto de emisión">
              <Select
                {...fieldAria("punto", undefined)}
                value={pointId}
                onChange={(event) =>
                  form.setValue("emissionPointId", event.target.value, { shouldDirty: true })
                }
              >
                <option value="">Elige un punto</option>
                {points.map((point) => (
                  <option key={point.id} value={point.id}>
                    {point.label}
                  </option>
                ))}
              </Select>
            </FormField>
          </Section>

          <Section title="Proveedor">
            <p className="text-sm text-foreground-muted">
              Una persona natural con cédula o pasaporte y el rol de proveedor en Terceros.
            </p>
            {supplier ? (
              <p className="flex items-center gap-1 rounded-md border border-border bg-surface px-1.5 py-1 text-sm">
                <UserRound aria-hidden="true" className="size-2 shrink-0 text-foreground-muted" />
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium break-words">{supplier.legalName}</span>
                  <span className="text-foreground-muted tabular-nums">
                    {supplier.identification}
                  </span>
                </span>
              </p>
            ) : (
              <p className="text-sm text-foreground-muted">Todavía no elegiste el proveedor.</p>
            )}
            <Button variant="outline" className="self-start" onClick={() => setChoosing(true)}>
              {supplier ? "Cambiar proveedor" : "Elegir proveedor"}
            </Button>
            <SupplierChooser open={choosing} onOpenChange={setChoosing} onChoose={chooseSupplier} />
            <FormField
              id="direccion-proveedor"
              label="Dirección del proveedor"
              hint={addressHint}
              error={errors.supplierAddress?.message}
            >
              <Input
                autoComplete="off"
                {...fieldAria("direccion-proveedor", errors.supplierAddress?.message, addressHint)}
                {...form.register("supplierAddress")}
              />
            </FormField>
          </Section>

          <Section title="Líneas">
            <ol className="flex flex-col gap-1.5">
              {lines.fields.map((field, index) => (
                <LineCard
                  key={field.id}
                  form={form}
                  index={index}
                  options={options}
                  previewLine={
                    fresh ? preview.lines.find((line) => line.position === index + 1) : undefined
                  }
                  issues={fresh ? lineIssues(index + 1) : []}
                  canRemove={lines.fields.length > 1}
                  onRemove={() => removeLine(index)}
                />
              ))}
            </ol>
            <Button
              ref={addLineRef}
              variant="outline"
              className="self-start"
              disabled={lines.fields.length >= limits.lines}
              onClick={() => lines.append(blankLine())}
            >
              <Plus aria-hidden="true" />
              Agregar línea
            </Button>
            {lines.fields.length >= limits.lines && (
              <p className="text-xs text-foreground-muted">
                Llegaste al máximo de {limits.lines} líneas por liquidación, un límite del sistema
                (no del SRI).
              </p>
            )}
          </Section>

          <Section title="Pagos">
            <p className="text-sm text-foreground-muted">
              Cada pago lleva su forma de pago, su total, su plazo y su unidad de tiempo. La suma de
              los pagos debe ser exactamente el importe total.
            </p>
            <ol className="flex flex-col gap-1.5">
              {payments.fields.map((field, index) => (
                <PaymentRow
                  key={field.id}
                  form={form}
                  index={index}
                  options={options}
                  issues={fresh ? paymentIssues(index + 1) : []}
                  canRemove={payments.fields.length > 1}
                  onRemove={() => removePayment(index)}
                />
              ))}
            </ol>
            <Button
              ref={addPaymentRef}
              variant="outline"
              className="self-start"
              disabled={payments.fields.length >= limits.payments}
              onClick={() => payments.append(blankPayment())}
            >
              <Plus aria-hidden="true" />
              Agregar pago
            </Button>
            {payments.fields.length >= limits.payments && (
              <p className="text-xs text-foreground-muted">
                Llegaste al máximo de {limits.payments} pagos por liquidación, un límite del sistema
                (no del SRI).
              </p>
            )}
            {paymentsDifference && (
              <p className="text-sm text-foreground-muted tabular-nums">{paymentsDifference}</p>
            )}
          </Section>
        </div>

        <aside
          aria-labelledby="resumen-titulo"
          className="flex flex-col gap-2 lg:sticky lg:top-2 lg:self-start"
        >
          <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface p-2">
            <h2
              id="resumen-titulo"
              ref={summaryRef}
              tabIndex={-1}
              className="text-lg font-semibold"
            >
              Resumen
            </h2>
            {!fresh ? (
              <p className="text-sm text-foreground-muted">
                Guarda el borrador para revisarlo con los importes con que se emitirá.
              </p>
            ) : (
              <>
                <dl className="grid grid-cols-[1fr_auto] gap-x-2 gap-y-0.5 text-sm tabular-nums">
                  <dt>Proveedor</dt>
                  <dd className="text-right break-words">{preview.supplier?.legalName ?? "—"}</dd>
                  {totals ? (
                    <>
                      {totals.taxes.map((tax) => (
                        <div key={`base-${tax.rateCode}`} className="contents">
                          <dt>Subtotal {tax.label}</dt>
                          <dd className="text-right">{formatUsd(tax.base)}</dd>
                        </div>
                      ))}
                      <dt>Subtotal sin impuestos</dt>
                      <dd className="text-right">{formatUsd(totals.withoutTaxes)}</dd>
                      <dt>Descuento</dt>
                      <dd className="text-right">{formatUsd(totals.discount)}</dd>
                      {totals.taxes
                        .filter((tax) => tax.rateKind === "PERCENTAGE" && tax.percentage !== "0")
                        .map((tax) => (
                          <div key={`iva-${tax.rateCode}`} className="contents">
                            <dt>IVA {formatPercentage(tax.percentage)}</dt>
                            <dd className="text-right">{formatUsd(tax.amount)}</dd>
                          </div>
                        ))}
                      <dt className="font-semibold">Importe total</dt>
                      <dd className="text-right font-semibold">{formatUsd(totals.total)}</dd>
                    </>
                  ) : (
                    <>
                      <dt>Importe total</dt>
                      <dd className="text-right">—</dd>
                    </>
                  )}
                </dl>
                <p className="text-xs text-foreground-muted">
                  Vista previa del {formatIssueDate(preview.evaluatedOn)}, sin validez fiscal. No
                  reserva nada: la emisión vuelve a comprobar el proveedor, los productos y los
                  catálogos.
                </p>
                <WithholdingNotice text={preview.withholdingNotice} />
                <div className="flex flex-col gap-0.5 text-sm">
                  <h3 className="font-semibold">Al emitir declararás</h3>
                  <ul className="flex list-disc flex-col gap-0.5 pl-2">
                    {preview.policy.statements.map((statement) => (
                      <li key={statement.id}>{statement.text}</li>
                    ))}
                  </ul>
                </div>
              </>
            )}
            {fresh && generalIssues.length > 0 && (
              <div className="flex flex-col gap-0.5">
                <h3 className="text-sm font-semibold">Antes de emitir</h3>
                <IssueList issues={generalIssues} />
              </div>
            )}
            <p className="text-xs text-foreground-muted">
              Límites del sistema (no del SRI): {limits.lines} líneas y {limits.payments} pagos.
            </p>
          </div>
          <div className="flex flex-col gap-1">
            {canEmit && (
              <Button
                disabled={emitBlocked}
                aria-describedby={emitHint ? emitHintId : undefined}
                onClick={() => {
                  idempotencyKey.current ||= crypto.randomUUID();
                  setConfirming(true);
                }}
              >
                Emitir liquidación de compra
              </Button>
            )}
            {canEmit && emitHint && (
              <p id={emitHintId} className="text-xs text-foreground-muted">
                {emitHint}
              </p>
            )}
            <AsyncButton type="submit" variant="outline" pending={save.isPending}>
              Guardar borrador
            </AsyncButton>
          </div>
        </aside>
      </form>

      <ConfirmDialog
        open={confirming}
        onOpenChange={(open) => {
          setConfirming(open);
          if (!open) setDeclared([]);
        }}
        title="Emitir liquidación de compra"
        confirmLabel="Emitir liquidación de compra"
        pending={emit.isPending}
        confirmBlocked={!allDeclared}
        // Si la emisión falló, el foco va al aviso y no al botón que abrió la confirmación.
        onCloseAutoFocus={(event) => {
          if (!emissionFailed.current) return;
          emissionFailed.current = false;
          event.preventDefault();
          alertRef.current?.focus();
        }}
        onConfirm={() =>
          emit.mutate({
            draft: { id: draft.id, version: draft.version },
            idempotencyKey: idempotencyKey.current,
            policyVersion: policy.version,
            // En el orden de la política, solo las que el usuario marcó.
            statements: statements
              .map((statement) => statement.id)
              .filter((statementId) => declared.includes(statementId)),
          })
        }
        description={
          <div className="flex flex-col gap-1">
            <p>
              La emisión reserva el número de la liquidación y la firma; no se puede deshacer. No
              emite ni espera el comprobante de retención.
            </p>
            {/* En pantallas angostas, cada dato bajo su nombre: los números no se parten. */}
            <dl className="grid grid-cols-1 gap-x-2 text-foreground sm:grid-cols-[auto_1fr] sm:gap-y-0.5">
              <dt className="text-foreground-muted">Ambiente</dt>
              <dd className="max-sm:mb-0.5">{environment ?? "Desconocido"}</dd>
              <dt className="text-foreground-muted">Proveedor</dt>
              <dd className="break-words max-sm:mb-0.5">
                {preview.supplier
                  ? `${preview.supplier.legalName} · ${preview.supplier.identification}`
                  : "—"}
              </dd>
              <dt className="text-foreground-muted">Importe total</dt>
              <dd className="tabular-nums max-sm:mb-0.5">
                {totals ? formatUsd(totals.total) : "—"}
              </dd>
              <dt className="text-foreground-muted">Líneas y pagos</dt>
              <dd className="max-sm:mb-0.5">
                {draft.lines.length === 1 ? "1 línea" : `${draft.lines.length} líneas`} ·{" "}
                {draft.payments.length === 1 ? "1 pago" : `${draft.payments.length} pagos`}
              </dd>
            </dl>
          </div>
        }
      >
        <fieldset className="mt-1 flex flex-col gap-1 text-sm">
          <legend className="mb-0.5 font-semibold">
            Declaraciones de procedencia ({policy.source})
          </legend>
          <p
            role="note"
            className="rounded-md border border-warning/40 bg-warning/10 px-1 py-0.5 text-foreground"
          >
            {DECLARATIONS_NOTICE}
          </p>
          {statements.map((statement) => (
            <label
              key={statement.id}
              className="flex min-h-5.5 items-start gap-1 rounded-md border border-border px-1 py-0.5"
            >
              <input
                type="checkbox"
                className="mt-0.5 size-2.5 shrink-0 accent-primary"
                checked={declared.includes(statement.id)}
                onChange={(event) =>
                  setDeclared((current) =>
                    event.target.checked
                      ? [...current, statement.id]
                      : current.filter((candidate) => candidate !== statement.id),
                  )
                }
              />
              <span>{statement.text}</span>
            </label>
          ))}
          {!allDeclared && (
            <p className="text-xs text-foreground-muted">
              Marca las cuatro declaraciones para emitir.
            </p>
          )}
        </fieldset>
      </ConfirmDialog>
    </section>
  );
}

function Header({ title }: { title: string }) {
  return (
    <div className="flex flex-col gap-1">
      <Link
        href="/liquidaciones-compra"
        className="inline-flex items-center gap-0.5 self-start text-sm text-foreground-muted hover:text-foreground"
      >
        <ArrowLeft aria-hidden="true" className="size-2" />
        Liquidaciones de compra
      </Link>
      <h1 id="editor-titulo" className="text-3xl font-bold">
        {title}
      </h1>
    </div>
  );
}

function Fallback({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-labelledby="editor-titulo" className="flex flex-col gap-3">
      <Header title={title} />
      {children}
    </section>
  );
}

/**
 * Nueva liquidación de compra: preparar el borrador lo crea con el punto predeterminado del usuario,
 * y el editor sigue en su ruta.
 */
export function NewPurchaseSettlementDraftScreen() {
  const { me } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const allowed = canSee(me.role, "purchaseSettlements.draft");
  const defaultPoint = useDefaultPoint(allowed);
  const [error, setError] = useState<string>();
  const alertRef = useRef<HTMLDivElement>(null);
  const create = useSavePurchaseSettlementDraft({
    success: "Preparaste el borrador de la liquidación de compra.",
    onSuccess: (draft) => {
      queryClient.setQueryData([...PURCHASE_SETTLEMENT_DRAFTS_KEY, "detail", draft.id], draft);
      router.replace(`/liquidaciones-compra/borradores/${draft.id}`);
    },
    onError: (failure) => {
      setError(errorMessage(failure, PURCHASE_SETTLEMENT_CONFLICT_MESSAGES));
      return true;
    },
  });
  useEffect(() => {
    if (error) alertRef.current?.focus();
  }, [error]);

  if (!allowed) {
    return (
      <Fallback title="Nueva liquidación de compra">
        <EmptyState
          kind="no-permission"
          title="No tienes acceso a los borradores de liquidaciones de compra"
          description="Pide a un administrador que revise tu rol."
        />
      </Fallback>
    );
  }
  const point = defaultPoint.data?.available ? defaultPoint.data.emissionPoint.id : null;
  return (
    <Fallback title="Nueva liquidación de compra">
      {error && <OperationAlert message={error} alertRef={alertRef} />}
      <Section title="Compra sin comprobante de venta">
        <p className="text-sm text-foreground-muted">
          Documenta la adquisición de bienes muebles o servicios a una persona natural no obligada a
          llevar contabilidad que, sin RUC o con su RUC suspendido, no puede emitir comprobantes de
          venta por su nivel cultural o rusticidad. Al emitir confirmarás esas condiciones como
          declaraciones tuyas.
        </p>
        <AsyncButton
          className="self-start"
          pending={create.isPending || defaultPoint.isPending}
          onClick={() => {
            setError(undefined);
            create.mutate({ id: null, input: point ? { emissionPointId: point } : {} });
          }}
        >
          Preparar borrador
        </AsyncButton>
      </Section>
    </Fallback>
  );
}

/** Editor de un borrador guardado, con las opciones de la empresa. */
export function PurchaseSettlementDraftScreen({ draftId }: { draftId: string }) {
  const { me } = useSession();
  const allowed = canSee(me.role, "purchaseSettlements.draft");
  const canEmit = canSee(me.role, "purchaseSettlements.emit");
  const draft = usePurchaseSettlementDraft(draftId, allowed);
  const options = usePurchaseSettlementOptions(allowed);

  if (!allowed) {
    return (
      <Fallback title="Borrador de liquidación de compra">
        <EmptyState
          kind="no-permission"
          title="No tienes acceso a los borradores de liquidaciones de compra"
          description="Pide a un administrador que revise tu rol."
        />
      </Fallback>
    );
  }
  if (draft.isPending || options.isPending) return <PurchaseSettlementDraftSkeleton />;
  if (draft.isError) {
    const error = draft.error;
    const emitted =
      error instanceof ApiError && error.code === "PURCHASE_SETTLEMENT_DRAFT_ALREADY_EMITTED";
    const missing = error instanceof ApiError && error.status === 404;
    return (
      <Fallback title="Borrador de liquidación de compra">
        {emitted || missing ? (
          <EmptyState
            kind="empty"
            title={emitted ? "Este borrador ya se emitió" : "El borrador no existe"}
            description={
              emitted
                ? "Encuéntralo en Liquidaciones de compra: un borrador emitido ya no se corrige."
                : "Puede que se haya eliminado."
            }
            action={
              <Button asChild variant="outline">
                <Link href="/liquidaciones-compra">Ver liquidaciones de compra</Link>
              </Button>
            }
          />
        ) : (
          <ErrorState
            message="No pudimos cargar el borrador."
            onRetry={() => void draft.refetch()}
          />
        )}
      </Fallback>
    );
  }
  if (options.isError) {
    return (
      <Fallback title="Borrador de liquidación de compra">
        <ErrorState
          message="No pudimos cargar las tarifas de IVA, las formas de pago y la política de procedencia."
          onRetry={() => void options.refetch()}
        />
      </Fallback>
    );
  }
  const data = draft.data;
  return (
    <DraftEditor
      key={`${data.id}-${data.version}`}
      draft={data}
      options={options.data}
      canEmit={canEmit}
    />
  );
}

export function PurchaseSettlementDraftSkeleton() {
  return (
    <section aria-busy="true" className="flex flex-col gap-3">
      <h1 className="text-3xl font-bold">Borrador de liquidación de compra</h1>
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-24 w-full" />
    </section>
  );
}
