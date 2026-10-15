// Editor de factura a página completa (add-invoice-emission, design D15): flujo complejo y de riesgo
// (frontend-checklist.md). Usuario: administrador u operador, a diario. Objetivo: preparar una
// factura correcta. Decisión: si está lista para emitirse. Información mínima: comprador, líneas con
// el precio del producto y el descuento, totales del servidor, formas de pago, problemas y ambiente.
// El frontend no calcula dinero: los totales y los problemas son la vista previa del servidor del
// borrador guardado.
// Composición (productize-invoice-editor-and-composition-foundation, design D13 a D16):
// - `PageHeader` de editor, dueño de sus migas, con el estado del borrador como contexto;
// - `FormLayout` con las secciones a la izquierda y el resumen y las acciones en un carril fijo, que
//   se apila debajo cuando no hay sitio;
// - guardar está disponible siempre salvo durante un guardado, que deja el formulario sin edición;
//   emitir solo con la versión guardada, sin cambios, sin problemas y con permiso;
// - la acción principal es la siguiente acción válida, y la que no está disponible dice por qué.
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  defaultEmissionPointViewSchema,
  invoiceAmountSchema,
  invoiceQuantitySchema,
  type DraftView,
  type InvoiceIssue,
  type PartyView,
  type ProductView,
  type StockWarning,
} from "@facturador/contracts";
import { CircleDashed, CircleDot, CircleCheck, Info, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Controller, useFieldArray, useForm, useWatch, type Resolver } from "react-hook-form";
import { z } from "zod";
import { AsyncButton } from "@/components/async-button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { RowActionButton } from "@/components/data-table/table-controls";
import { EntityPickerDialog } from "@/components/entity-picker-dialog";
import { errorMessage } from "@/components/feedback";
import { fieldAria, FormField } from "@/components/form-dialog";
import { FormFieldRow, FormGrid, useFormRowFieldClass } from "@/components/layout/form-grid";
import { FormLayout, StickyFormActions, StickySummaryPanel } from "@/components/layout/form-layout";
import { FormSection } from "@/components/layout/form-section";
import { PageHeader } from "@/components/layout/page-header";
import { useSession } from "@/components/session";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, apiFetch } from "@/lib/api";
import { formatDecimal, formatPercentage, formatUsd } from "@/lib/decimal";
import { canSee } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { ENVIRONMENT_LABELS, useCompanyStatus } from "@/features/company/company-api";
import { EmissionEnvironmentNotice } from "@/features/company/emission-environment-notice";
import {
  DEFAULT_POINT_KEY,
  pointLabel,
  useEstablishments,
} from "@/features/establishments/establishments-api";
import { useCatalogEntries } from "@/features/fiscal-catalogs/catalogs-api";
import { buyerLabel, formatIssueDate } from "./invoice-format";
import {
  DRAFTS_KEY,
  fetchConsumerFinal,
  fetchCustomers,
  fetchProducts,
  useDraft,
  useEmitInvoice,
  useSaveDraft,
} from "./invoices-api";

type Buyer = { id: string; legalName: string; identification: string; consumerFinal: boolean };

type FormValues = {
  emissionPointId: string;
  buyer: Buyer | null;
  lines: {
    productId: string;
    name: string;
    mainCode: string | null;
    unitPrice: string;
    quantity: string;
    discount: string;
  }[];
  payments: { paymentMethod: string; amount: string }[];
};

// Un descuento o un importe vacío es 0 o "sin importe": se envía así, sin redondear nada.
const formSchema = z.object({
  emissionPointId: z.string(),
  buyer: z
    .object({
      id: z.string(),
      legalName: z.string(),
      identification: z.string(),
      consumerFinal: z.boolean(),
    })
    .nullable(),
  lines: z.array(
    z.object({
      productId: z.string(),
      name: z.string(),
      mainCode: z.string().nullable(),
      unitPrice: z.string(),
      quantity: invoiceQuantitySchema,
      discount: z.union([z.literal(""), invoiceAmountSchema]),
    }),
  ),
  payments: z.array(
    z.object({
      paymentMethod: z.string().min(1, "Elige la forma de pago."),
      amount: z.union([z.literal(""), invoiceAmountSchema]),
    }),
  ),
});

const toForm = (draft: DraftView | null): FormValues => ({
  emissionPointId: draft?.emissionPoint?.id ?? "",
  buyer: draft?.buyer
    ? {
        id: draft.buyer.id,
        legalName: draft.buyer.legalName,
        identification: draft.buyer.identification,
        consumerFinal: draft.buyer.systemRecord === "CONSUMER_FINAL",
      }
    : null,
  lines:
    draft?.lines.map((line) => ({
      productId: line.product.id,
      name: line.product.name,
      mainCode: line.product.mainCode,
      unitPrice: line.product.unitPrice,
      quantity: line.quantity,
      discount: line.discount,
    })) ?? [],
  payments: draft
    ? draft.payments.map((payment) => ({
        paymentMethod: payment.paymentMethod,
        amount: payment.amount ?? "",
      }))
    : [{ paymentMethod: "01", amount: "" }],
});

const toInput = (values: FormValues) => ({
  emissionPointId: values.emissionPointId || null,
  buyerPartyId: values.buyer?.id ?? null,
  lines: values.lines.map((line) => ({
    productId: line.productId,
    quantity: line.quantity,
    discount: line.discount || "0",
  })),
  payments: values.payments.map((payment) => ({
    paymentMethod: payment.paymentMethod,
    amount: payment.amount || null,
  })),
});

const asBuyer = (party: PartyView): Buyer => ({
  id: party.id,
  legalName: party.legalName,
  identification: party.identification,
  consumerFinal: party.systemRecord === "CONSUMER_FINAL",
});

/** Los problemas del servidor que señalan un dato de la cabecera, para mostrarlos junto a él. */
const isBuyerIssue = (issue: InvoiceIssue) => issue.code.startsWith("BUYER_");
const isPointIssue = (issue: InvoiceIssue) => issue.code.startsWith("EMISSION_POINT_");

const ONE_PAYMENT_HINT = "Déjalo vacío para usar el total de la factura";

function useDefaultPoint(enabled: boolean) {
  return useQuery({
    queryKey: DEFAULT_POINT_KEY,
    enabled,
    queryFn: ({ signal }) =>
      apiFetch("/me/default-emission-point", { schema: defaultEmissionPointViewSchema, signal }),
  });
}

function IssueList({ issues }: { issues: readonly InvoiceIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {issues.map((issue, index) => (
        <li key={`${issue.code}-${index}`} className="text-danger">
          {issue.message}
        </li>
      ))}
    </ul>
  );
}

/**
 * Aviso de existencias de un producto (add-minimal-inventory, design D9 y D13): orientativo, junto a
 * su última línea, sin bloquear la emisión ni garantizar disponibilidad.
 */
function StockWarningNote({ warning }: { warning: StockWarning }) {
  return (
    <p
      role="note"
      className="flex items-start gap-1 rounded-md border border-warning/40 bg-warning/10 px-2 py-1 text-sm"
    >
      <Info aria-hidden="true" className="mt-1 size-4 shrink-0 text-warning" />
      <span>
        {warning.code === "STOCK_BELOW_REQUESTED"
          ? `Aviso de existencias: pides ${formatDecimal(warning.requested)} y el saldo contabilizado es ${formatDecimal(warning.balance ?? "0")}.`
          : "Aviso de existencias: este producto todavía no tiene inventario inicializado."}{" "}
        Es orientativo y no impide emitir.
      </span>
    </p>
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
      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm"
    >
      <p>{message}</p>
      {action}
    </div>
  );
}

/** Estado del borrador (design D16), en texto: en el encabezado y en el resumen. */
type DraftState = "new" | "saved" | "dirty";

const STATE_PRESENTATION = {
  new: { label: "Sin guardar", icon: CircleDashed, variant: "neutral" },
  saved: { label: "Guardado", icon: CircleCheck, variant: "neutral" },
  dirty: { label: "Cambios sin guardar", icon: CircleDot, variant: "warning" },
} as const;

function DraftStateBadge({ state }: { state: DraftState }) {
  const { label, icon: Icon, variant } = STATE_PRESENTATION[state];
  return (
    <Badge variant={variant} data-slot="draft-state">
      <Icon aria-hidden="true" />
      {label}
    </Badge>
  );
}

/**
 * El comprador como un campo (design D13): una caja de la altura de un control con su nombre, y el
 * botón para elegirlo en la misma fila. La identificación y los problemas del servidor van debajo.
 */
function BuyerField({
  buyer,
  problem,
  onPick,
}: {
  buyer: Buyer | null;
  problem: string | undefined;
  onPick: () => void;
}) {
  const rowClass = useFormRowFieldClass();
  const labelId = useId();
  const detailId = useId();
  return (
    <div data-slot="form-field" className={cn("flex flex-col gap-1", rowClass)}>
      <span id={labelId} className="text-sm font-medium">
        Comprador
      </span>
      <div className="flex items-center gap-2">
        <div
          role="group"
          aria-labelledby={labelId}
          aria-describedby={detailId}
          aria-invalid={problem ? true : undefined}
          className="flex h-10 min-w-0 flex-1 items-center rounded-md border border-input bg-muted px-3 text-sm aria-invalid:border-danger max-md:h-11"
        >
          {buyer ? (
            <span className="truncate font-medium" title={buyer.legalName}>
              {buyer.legalName}
            </span>
          ) : (
            <span className="text-muted-foreground">Sin comprador</span>
          )}
        </div>
        <Button variant="outline" size="default" onClick={onPick}>
          {buyer ? "Cambiar comprador" : "Elegir comprador"}
        </Button>
      </div>
      <div id={detailId} className="flex flex-col gap-1 text-xs">
        {buyer && (
          <p className="text-muted-foreground tabular-nums">
            {buyer.consumerFinal
              ? `Consumidor final · ${buyer.identification}`
              : buyer.identification}
          </p>
        )}
        {problem && <p className="text-danger">{problem}</p>}
      </div>
    </div>
  );
}

function DraftEditor({ draft, canEmit }: { draft: DraftView | null; canEmit: boolean }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [operationError, setOperationError] = useState<{ message: string; code?: string }>();
  const alertRef = useRef<HTMLDivElement>(null);
  const [pickingBuyer, setPickingBuyer] = useState(false);
  const [pickingProduct, setPickingProduct] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // La línea recién agregada recibe el foco en su cantidad al cerrarse el selector (design D13).
  const addedLine = useRef<number | null>(null);
  // Una clave por versión del borrador (el editor se vuelve a montar con cada versión): un
  // reintento de la misma solicitud la repite y el servidor devuelve o retoma la misma factura.
  const idempotencyKey = useRef<string>("");
  // Una confirmación repetida (doble clic) no envía una segunda emisión; la misma clave ya haría que
  // el servidor devolviera la misma factura.
  const emitting = useRef(false);
  const establishments = useEstablishments();
  const paymentMethods = useCatalogEntries("payment-method", true);
  const status = useCompanyStatus();
  const defaultPoint = useDefaultPoint(draft === null);
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema) as unknown as Resolver<FormValues>,
    defaultValues: toForm(draft),
  });
  const { errors, isDirty } = form.formState;
  const lines = useFieldArray({ control: form.control, name: "lines" });
  const payments = useFieldArray({ control: form.control, name: "payments" });
  const buyer = useWatch({ control: form.control, name: "buyer" });
  const pointId = useWatch({ control: form.control, name: "emissionPointId" });

  // Un borrador nuevo empieza en el punto predeterminado del usuario, si tiene uno y sigue
  // disponible: uno desactivado no se preselecciona (taxpayer-setup). Es el punto de partida, no un
  // cambio del usuario: no marca el borrador con cambios sin guardar.
  useEffect(() => {
    const point = defaultPoint.data?.available ? defaultPoint.data.emissionPoint.id : undefined;
    if (point && !form.getValues("emissionPointId")) {
      // Nuevo valor de partida: lo que el operador ya cambió se conserva como cambio.
      form.reset(
        { ...(form.formState.defaultValues as FormValues), emissionPointId: point },
        { keepDirtyValues: true },
      );
    }
  }, [defaultPoint.data, form]);

  useEffect(() => {
    if (operationError) alertRef.current?.focus();
  }, [operationError]);

  // Con cambios sin guardar, cerrar o recargar la pestaña pide confirmación (design D16). Sin
  // cambios no se registra nada, y el aviso se retira en cuanto el borrador queda limpio.
  useEffect(() => {
    if (!isDirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isDirty]);

  const fail = (error: unknown) => {
    setOperationError({
      message: errorMessage(error),
      ...(error instanceof ApiError ? { code: error.code } : {}),
    });
    return true;
  };
  const save = useSaveDraft({
    onSuccess: (saved) => {
      setOperationError(undefined);
      queryClient.setQueryData([...DRAFTS_KEY, "detail", saved.id], saved);
      if (!draft) router.replace(`/borradores/${saved.id}`);
    },
    onError: fail,
  });
  const emit = useEmitInvoice({
    onSuccess: (invoice) => router.push(`/facturas/${invoice.id}`),
    onError: (error) => {
      emitting.current = false;
      setConfirming(false);
      void queryClient.invalidateQueries({ queryKey: [...DRAFTS_KEY, "detail", draft?.id] });
      return fail(error);
    },
  });

  const points = (establishments.data ?? []).flatMap((establishment) =>
    establishment.emissionPoints
      .filter((point) => point.available || point.id === form.getValues("emissionPointId"))
      .map((point) => ({
        id: point.id,
        label: `${pointLabel(establishment, point)} · ${establishment.address}`,
      })),
  );
  const methodOptions = (paymentMethods.data?.entries ?? [])
    .filter((entry) => entry.usable)
    .map((entry) => ({
      value: entry.entryKey,
      label: `${(entry.applicable ?? entry.versions.at(-1)!).officialLabel} (${entry.code})`,
    }));

  const preview = draft?.preview;
  const issues = preview?.issues ?? [];
  // Los problemas de la última versión guardada solo se muestran mientras sigue siendo la que se ve.
  const current = draft !== null && !isDirty;
  const shown = current ? issues : [];
  const lineIssues = (position: number) => shown.filter((issue) => issue.line === position);
  const paymentIssues = (position: number) => shown.filter((issue) => issue.payment === position);
  const headerIssues = shown.filter((issue) => issue.line === null && issue.payment === null);
  const buyerProblem = headerIssues.find(isBuyerIssue)?.message;
  const pointProblem = headerIssues.find(isPointIssue)?.message;
  const generalIssues = headerIssues.filter(
    (issue) => !isBuyerIssue(issue) && !isPointIssue(issue),
  );
  const stockWarnings = preview?.stockWarnings ?? [];
  const environment = status.data ? ENVIRONMENT_LABELS[status.data.environment] : null;
  const saving = save.isPending;
  const state: DraftState = isDirty ? "dirty" : draft ? "saved" : "new";

  // Guardar y emitir según las cinco preguntas de D14.
  const ready = current && issues.length === 0;
  const emitBlocked = !ready || saving;
  const emitHintId = useId();
  const emitHint = saving
    ? "Espera a que termine el guardado."
    : !draft
      ? "Guarda el borrador para emitirlo."
      : isDirty
        ? "Guarda los cambios antes de emitir."
        : issues.length > 0
          ? "Resuelve los problemas del resumen antes de emitir."
          : undefined;
  // Con el borrador guardado y con problemas, ninguna acción se destaca: se corrige un dato.
  const emitPrimary = canEmit && ready;
  const savePrimary = !emitPrimary && !(current && issues.length > 0 && canEmit);

  const onSave = form.handleSubmit((values) => {
    setOperationError(undefined);
    save.mutate({
      id: draft?.id ?? null,
      input: draft ? { ...toInput(values), expectedVersion: draft.version } : toInput(values),
    });
  });

  const recovery =
    operationError?.code === "INVOICE_DRAFT_CHANGED" ? (
      <Button
        variant="outline"
        onClick={() => {
          setOperationError(undefined);
          void queryClient.invalidateQueries({ queryKey: [...DRAFTS_KEY, "detail", draft?.id] });
        }}
      >
        Recargar borrador
      </Button>
    ) : operationError?.code === "INVOICE_DRAFT_ALREADY_EMITTED" ? (
      <Button asChild variant="outline">
        <Link href="/facturas">Ver facturas</Link>
      </Button>
    ) : undefined;

  const saveButton = (
    <AsyncButton
      key="guardar"
      type="submit"
      size="default"
      variant={savePrimary ? "primary" : "outline"}
      pending={saving}
      pendingLabel="Guardando el borrador"
    >
      Guardar borrador
    </AsyncButton>
  );
  const emitButton = canEmit ? (
    <Button
      key="emitir"
      size="default"
      variant={emitPrimary ? "primary" : "outline"}
      disabled={emitBlocked}
      aria-describedby={emitHint ? emitHintId : undefined}
      onClick={() => {
        idempotencyKey.current ||= crypto.randomUUID();
        setConfirming(true);
      }}
    >
      Emitir factura
    </Button>
  ) : null;

  const totals = preview?.totals ?? null;
  const totalsRows = totals && (
    <dl className="flex flex-col gap-1 text-sm tabular-nums">
      <div className="flex justify-between gap-4">
        <dt>Subtotal sin impuestos</dt>
        <dd>{formatUsd(totals.withoutTaxes)}</dd>
      </div>
      <div className="flex justify-between gap-4">
        <dt>Descuento</dt>
        <dd>{formatUsd(totals.discount)}</dd>
      </div>
      {totals.taxes.map((tax) => (
        <div key={`${tax.taxCode}-${tax.rateCode}`} className="flex justify-between gap-4">
          <dt>IVA {formatPercentage(tax.percentage)}</dt>
          <dd>{formatUsd(tax.amount)}</dd>
        </div>
      ))}
      <div className="flex justify-between gap-4 font-semibold">
        <dt>Total</dt>
        <dd>{formatUsd(totals.total)}</dd>
      </div>
    </dl>
  );
  const noTotals =
    draft && draft.lines.length === 0
      ? "Los totales aparecen cuando el borrador tiene productos."
      : "Los totales aparecen cuando todas las líneas se pueden calcular.";

  return (
    <section aria-labelledby="editor-titulo" className="flex flex-col gap-6">
      <PageHeader
        variant="editor"
        title={draft ? "Borrador de factura" : "Nueva factura"}
        titleId="editor-titulo"
        context={<DraftStateBadge state={state} />}
      />

      {operationError && (
        <OperationAlert message={operationError.message} action={recovery} alertRef={alertRef} />
      )}

      <form noValidate onSubmit={onSave}>
        <FormLayout
          panel={
            <StickySummaryPanel title="Resumen">
              <p className="text-sm text-muted-foreground">
                Estado: {STATE_PRESENTATION[state].label}
              </p>
              {/* Totales veraces (PO-2): solo los del servidor, nunca ceros ni cálculos aquí. */}
              {!draft ? (
                <p className="text-sm text-muted-foreground">
                  Guarda el borrador para obtener los totales calculados por el servidor.
                </p>
              ) : isDirty ? (
                <div data-slot="stale-totals" className="flex flex-col gap-2">
                  <p className="text-sm font-medium">Totales del último guardado</p>
                  {totals ? (
                    <div className="text-muted-foreground">{totalsRows}</div>
                  ) : (
                    <p className="text-sm text-muted-foreground">{noTotals}</p>
                  )}
                  <p className="text-xs text-muted-foreground">Guarda para recalcularlos.</p>
                </div>
              ) : totals ? (
                totalsRows
              ) : (
                <p className="text-sm text-muted-foreground">{noTotals}</p>
              )}
              {preview && (
                <p className="text-xs text-muted-foreground">
                  Vista previa del {formatIssueDate(preview.evaluatedOn)}, sin validez fiscal.
                </p>
              )}
              {generalIssues.length > 0 && (
                <div className="flex flex-col gap-1">
                  <h3 className="text-sm font-semibold">Antes de emitir</h3>
                  <IssueList issues={generalIssues} />
                </div>
              )}
            </StickySummaryPanel>
          }
          actions={
            <StickyFormActions
              notice={
                canEmit ? (
                  <EmissionEnvironmentNotice
                    document="factura"
                    className="@max-form-rail:py-1 @max-form-rail:text-xs"
                  />
                ) : undefined
              }
              reason={canEmit ? emitHint : undefined}
              reasonId={emitHintId}
            >
              {emitPrimary ? [emitButton, saveButton] : [saveButton, emitButton]}
            </StickyFormActions>
          }
        >
          {/* Mientras se guarda, el formulario no se edita: lo persistido es lo que se ve (D14). */}
          <fieldset
            disabled={saving}
            aria-busy={saving || undefined}
            className="contents"
            data-slot="draft-fields"
          >
            <FormSection title="Comprador y punto de emisión">
              <FormGrid>
                <BuyerField
                  buyer={buyer}
                  problem={buyerProblem}
                  onPick={() => setPickingBuyer(true)}
                />
                <FormField id="punto" label="Punto de emisión" problem={pointProblem}>
                  <Select
                    {...fieldAria("punto", undefined, undefined, pointProblem)}
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
              </FormGrid>
            </FormSection>

            <FormSection
              title="Productos"
              action={
                <Button variant="outline" size="default" onClick={() => setPickingProduct(true)}>
                  <Plus aria-hidden="true" data-icon="inline-start" />
                  Agregar producto
                </Button>
              }
            >
              {lines.fields.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Agrega los productos o servicios que vendes en esta factura.
                </p>
              ) : (
                <div className="@container">
                  {/* Encabezados visibles desde 40rem de contenedor; las etiquetas siguen en cada
                      campo para las tecnologías de asistencia. */}
                  <div
                    aria-hidden="true"
                    className="hidden gap-x-2 border-b pb-2 text-xs font-medium text-muted-foreground @form-wide:grid @form-wide:grid-cols-invoice-lines"
                  >
                    <span>Producto</span>
                    <span>Cantidad</span>
                    <span className="text-right">Precio unitario</span>
                    <span>Descuento</span>
                    <span className="text-right">Base imponible</span>
                    <span />
                  </div>
                  <ul className="flex flex-col">
                    {lines.fields.map((field, index) => {
                      const position = index + 1;
                      const lineError = errors.lines?.[index];
                      const problems = lineIssues(position);
                      // El aviso suma todas las líneas del producto: se muestra junto a la última.
                      const lastOfProduct = !lines.fields
                        .slice(index + 1)
                        .some((other) => other.productId === field.productId);
                      const warning =
                        current && lastOfProduct
                          ? stockWarnings.find(
                              (candidate) => candidate.productId === field.productId,
                            )
                          : undefined;
                      // La base imponible es la del servidor, y solo vale para la versión guardada.
                      const base = current
                        ? preview?.lines.find((line) => line.position === position)?.taxableBase
                        : undefined;
                      const baseText = base ? (
                        formatUsd(base)
                      ) : (
                        <>
                          <span aria-hidden="true">—</span>
                          <span className="sr-only">se calcula al guardar</span>
                        </>
                      );
                      return (
                        <li
                          key={field.id}
                          aria-label={`Línea ${position}: ${field.name}`}
                          aria-invalid={problems.length > 0 || undefined}
                          className="grid grid-cols-3 gap-x-2 gap-y-2 border-b py-3 aria-invalid:bg-danger/5 @form-wide:grid-cols-invoice-lines @form-wide:items-start"
                        >
                          <div className="col-span-2 flex min-w-0 flex-col @form-wide:col-span-1 @form-wide:min-h-10 @form-wide:justify-center">
                            <span className="font-medium break-words">{field.name}</span>
                            {field.mainCode && (
                              <span className="text-xs text-muted-foreground">
                                {field.mainCode}
                              </span>
                            )}
                            <span className="text-xs text-muted-foreground tabular-nums @form-wide:hidden">
                              Base imponible {baseText}
                            </span>
                          </div>
                          <FormField
                            id={`cantidad-${index}`}
                            label="Cantidad"
                            labelClassName="@form-wide:sr-only"
                            error={lineError?.quantity?.message}
                          >
                            <Input
                              inputMode="decimal"
                              {...fieldAria(`cantidad-${index}`, lineError?.quantity?.message)}
                              {...form.register(`lines.${index}.quantity`)}
                            />
                          </FormField>
                          <div className="flex flex-col gap-1">
                            <span className="text-sm font-medium @form-wide:sr-only">
                              Precio unitario
                            </span>
                            <span className="flex h-10 items-center text-sm tabular-nums max-md:h-11 @form-wide:justify-end">
                              {formatUsd(field.unitPrice)}
                            </span>
                          </div>
                          <FormField
                            id={`descuento-${index}`}
                            label="Descuento"
                            labelClassName="@form-wide:sr-only"
                            error={lineError?.discount?.message}
                          >
                            <Input
                              inputMode="decimal"
                              placeholder="0,00"
                              {...fieldAria(`descuento-${index}`, lineError?.discount?.message)}
                              {...form.register(`lines.${index}.discount`)}
                            />
                          </FormField>
                          <span className="hidden h-10 items-center justify-end text-sm tabular-nums @form-wide:flex">
                            {baseText}
                          </span>
                          {/* Quitar va al final del orden del teclado (cantidad, descuento y quitar);
                              la rejilla lo coloca arriba a la derecha. */}
                          <div className="col-start-3 row-start-1 flex justify-end @form-wide:col-start-6 @form-wide:min-h-10 @form-wide:items-center @form-wide:justify-center">
                            <RowActionButton
                              icon={Trash2}
                              label={`Quitar la línea ${position}`}
                              onClick={() => lines.remove(index)}
                            />
                          </div>
                          {(problems.length > 0 || warning) && (
                            <div className="col-span-full flex flex-col gap-2">
                              <IssueList issues={problems} />
                              {warning && <StockWarningNote warning={warning} />}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </FormSection>

            <FormSection
              title="Formas de pago"
              description={
                payments.fields.length > 1
                  ? "Cada forma de pago lleva su importe y deben sumar el total."
                  : undefined
              }
              action={
                <Button
                  variant="outline"
                  size="default"
                  onClick={() => payments.append({ paymentMethod: "", amount: "" })}
                >
                  <Plus aria-hidden="true" data-icon="inline-start" />
                  Agregar forma de pago
                </Button>
              }
            >
              <div className="flex flex-col gap-4">
                {payments.fields.map((field, index) => {
                  const position = index + 1;
                  const paymentError = errors.payments?.[index];
                  const problems = paymentIssues(position);
                  const hint = payments.fields.length === 1 ? ONE_PAYMENT_HINT : undefined;
                  return (
                    <FormFieldRow
                      key={field.id}
                      legend={`Forma de pago ${position}`}
                      layout="payment"
                    >
                      <FormField
                        id={`forma-${index}`}
                        label="Forma de pago"
                        error={paymentError?.paymentMethod?.message}
                      >
                        <Controller
                          control={form.control}
                          name={`payments.${index}.paymentMethod`}
                          render={({ field: method }) => (
                            <Select
                              {...fieldAria(`forma-${index}`, paymentError?.paymentMethod?.message)}
                              value={method.value}
                              onChange={method.onChange}
                              onBlur={method.onBlur}
                              ref={method.ref}
                            >
                              <option value="">Elige la forma de pago</option>
                              {methodOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </Select>
                          )}
                        />
                      </FormField>
                      <FormField
                        id={`importe-${index}`}
                        label="Importe"
                        {...(hint ? { hint } : {})}
                        error={paymentError?.amount?.message}
                        action={
                          <RowActionButton
                            icon={Trash2}
                            label={`Quitar la forma de pago ${position}`}
                            onClick={() => payments.remove(index)}
                          />
                        }
                      >
                        <Input
                          inputMode="decimal"
                          {...fieldAria(`importe-${index}`, paymentError?.amount?.message, hint)}
                          {...form.register(`payments.${index}.amount`)}
                        />
                      </FormField>
                      {problems.length > 0 && (
                        <div className="col-span-full">
                          <IssueList issues={problems} />
                        </div>
                      )}
                    </FormFieldRow>
                  );
                })}
              </div>
            </FormSection>
          </fieldset>
        </FormLayout>
      </form>

      <EntityPickerDialog<PartyView>
        open={pickingBuyer}
        onOpenChange={setPickingBuyer}
        title="Elegir comprador"
        searchLabel="Buscar por nombre o identificación"
        searchPlaceholder="Nombre o identificación"
        queryKey={["parties", "customers"]}
        fetchPage={fetchCustomers}
        getKey={(party) => party.id}
        getLabel={(party) => buyerLabel(party)}
        renderItem={(party) => (
          <span className="flex flex-col">
            <span className="font-medium">{party.legalName}</span>
            <span className="text-sm text-muted-foreground tabular-nums">
              {party.identification}
            </span>
          </span>
        )}
        onSelect={(party) =>
          form.setValue("buyer", asBuyer(party), { shouldDirty: true, shouldValidate: true })
        }
        quickOption={{
          label: "Consumidor final",
          description: "Sin identificar al comprador, hasta el monto máximo vigente.",
          onSelect: () => {
            void fetchConsumerFinal().then((party) => {
              if (party) form.setValue("buyer", asBuyer(party), { shouldDirty: true });
            });
          },
        }}
        emptyTitle="Todavía no hay clientes"
        emptyDescription="Registra al comprador en Terceros con el rol de cliente."
      />
      <EntityPickerDialog<ProductView>
        open={pickingProduct}
        onOpenChange={setPickingProduct}
        title="Agregar producto"
        searchLabel="Buscar por código o nombre"
        searchPlaceholder="Código o nombre"
        queryKey={["products", "picker"]}
        fetchPage={fetchProducts}
        getKey={(product) => product.id}
        getLabel={(product) => `${product.name}, ${formatUsd(product.unitPrice)}`}
        renderItem={(product) => (
          <span className="flex w-full items-center justify-between gap-2">
            <span className="flex min-w-0 flex-col">
              <span className="font-medium break-words">{product.name}</span>
              {product.mainCode && (
                <span className="text-xs text-muted-foreground">{product.mainCode}</span>
              )}
            </span>
            <span className="text-sm tabular-nums">{formatUsd(product.unitPrice)}</span>
          </span>
        )}
        onSelect={(product) => {
          addedLine.current = lines.fields.length;
          lines.append(
            {
              productId: product.id,
              name: product.name,
              mainCode: product.mainCode,
              unitPrice: product.unitPrice,
              quantity: "1",
              discount: "",
            },
            { shouldFocus: false },
          );
        }}
        onCloseAutoFocus={(event) => {
          // Para cargar rápido con el teclado, el foco va a la cantidad de la línea nueva.
          if (addedLine.current === null) return;
          event.preventDefault();
          form.setFocus(`lines.${addedLine.current}.quantity`, { shouldSelect: true });
          addedLine.current = null;
        }}
        emptyTitle="Todavía no hay productos"
        emptyDescription="Registra en Productos lo que vendes, con su precio y su IVA."
      />

      {draft && (
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title="Emitir factura"
          confirmLabel="Emitir factura"
          pending={emit.isPending}
          onConfirm={() => {
            if (emitting.current) return;
            emitting.current = true;
            emit.mutate({
              draft: { id: draft.id, version: draft.version },
              idempotencyKey: idempotencyKey.current,
            });
          }}
          description={
            <div className="flex flex-col gap-2">
              <p>La emisión reserva el número de la factura y la firma; no se puede deshacer.</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-foreground">
                <dt className="text-foreground-muted">Ambiente</dt>
                <dd>{environment ?? "Desconocido"}</dd>
                <dt className="text-foreground-muted">Comprador</dt>
                <dd className="break-words">{draft.buyer ? buyerLabel(draft.buyer) : "—"}</dd>
                <dt className="text-foreground-muted">Total</dt>
                <dd className="tabular-nums">
                  {draft.preview.totals ? formatUsd(draft.preview.totals.total) : "—"}
                </dd>
                <dt className="text-foreground-muted">Líneas</dt>
                <dd className="tabular-nums">{draft.lines.length}</dd>
              </dl>
              <EmissionEnvironmentNotice document="factura" />
              {draft.buyer?.systemRecord === "CONSUMER_FINAL" && (
                <p className="rounded-md border border-warning/40 bg-warning/10 px-2 py-1 text-foreground">
                  Una factura a consumidor final tiene restricciones para anularse o corregirse con
                  una nota de crédito. Si el cliente necesita la factura a su nombre, identifícalo
                  antes de emitir.
                </p>
              )}
            </div>
          }
        />
      )}
    </section>
  );
}

/** Encabezado de los estados del editor: el mismo `PageHeader` de editor, con sus migas. */
function EditorStateHeader() {
  return <PageHeader variant="editor" title="Borrador de factura" titleId="editor-titulo" />;
}

/** Editor de un borrador existente (`draftId`) o de uno nuevo (`null`). */
export function DraftEditorScreen({ draftId }: { draftId: string | null }) {
  const { me } = useSession();
  const allowed = canSee(me.role, "invoices.draft");
  const canEmit = canSee(me.role, "invoices.emit");
  const draft = useDraft(draftId, allowed);

  if (!allowed) {
    return (
      <section aria-labelledby="editor-titulo" className="flex flex-col gap-6">
        <EditorStateHeader />
        <EmptyState
          kind="no-permission"
          title="No tienes acceso a los borradores"
          description="Pide a un administrador que revise tu rol."
        />
      </section>
    );
  }
  if (draftId && draft.isPending) return <DraftEditorSkeleton />;
  if (draftId && draft.isError) {
    const error = draft.error;
    const emitted = error instanceof ApiError && error.code === "INVOICE_DRAFT_ALREADY_EMITTED";
    // Un borrador de otra empresa es, para esta, inexistente: el servidor responde 404.
    const missing = error instanceof ApiError && error.status === 404;
    return (
      <section aria-labelledby="editor-titulo" className="flex flex-col gap-6">
        <EditorStateHeader />
        {emitted || missing ? (
          <EmptyState
            kind="empty"
            title={emitted ? "Este borrador ya se emitió" : "El borrador no existe"}
            description={
              emitted
                ? "Encuéntralo en Facturas: un borrador emitido ya no se corrige."
                : "Puede que se haya eliminado."
            }
            action={
              <Button asChild variant="outline">
                <Link href={emitted ? "/facturas" : "/borradores"}>
                  {emitted ? "Ver facturas" : "Ver borradores"}
                </Link>
              </Button>
            }
          />
        ) : (
          <ErrorState
            message="No pudimos cargar el borrador."
            onRetry={() => void draft.refetch()}
          />
        )}
      </section>
    );
  }
  const data = draftId ? (draft.data ?? null) : null;
  return (
    <DraftEditor
      key={data ? `${data.id}-${data.version}` : "nuevo"}
      draft={data}
      canEmit={canEmit}
    />
  );
}

/** Carga sin saltos: el mismo encabezado y la misma distribución que el editor. */
export function DraftEditorSkeleton() {
  return (
    <section aria-busy="true" aria-labelledby="editor-titulo" className="flex flex-col gap-6">
      <EditorStateHeader />
      <span className="sr-only" role="status">
        Cargando el borrador
      </span>
      <FormLayout panel={<Skeleton className="h-48 w-full rounded-xl" />}>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-24 w-full" />
      </FormLayout>
    </section>
  );
}
