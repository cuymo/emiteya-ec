// Editor de factura a página completa (add-invoice-emission, design D15): flujo complejo y de riesgo
// (frontend-checklist.md). Usuario: administrador u operador, a diario. Objetivo: preparar una
// factura correcta. Decisión: si está lista para emitirse. Información mínima: comprador, líneas con
// el precio del producto y el descuento, totales del servidor, formas de pago, problemas y ambiente.
// Acción principal: Emitir factura; secundaria: Guardar borrador. El frontend no calcula dinero: los
// totales y los problemas son la vista previa del servidor del borrador guardado.
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
import { ArrowLeft, Info, Plus, Trash2, UserRound } from "lucide-react";
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
import { useSession } from "@/components/session";
import { EmptyState, ErrorState, Skeleton, StatusBadge } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ApiError, apiFetch } from "@/lib/api";
import { formatDecimal, formatPercentage, formatUsd } from "@/lib/decimal";
import { canSee } from "@/lib/permissions";
import { ENVIRONMENT_LABELS, useCompanyStatus } from "@/features/company/company-api";
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

function IssueList({ issues }: { issues: readonly InvoiceIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className="flex flex-col gap-0.5 text-sm">
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
      className="flex items-start gap-0.5 rounded-md border border-warning/40 bg-warning/10 px-1 py-0.5 text-sm"
    >
      <Info aria-hidden="true" className="mt-0.5 size-2 shrink-0 text-warning" />
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
      className="flex flex-wrap items-center justify-between gap-1 rounded-md border border-danger/40 bg-danger/10 px-1.5 py-1 text-sm"
    >
      <p>{message}</p>
      {action}
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
  // Una clave por versión del borrador (el editor se vuelve a montar con cada versión): un
  // reintento de la misma solicitud la repite y el servidor devuelve o retoma la misma factura.
  const idempotencyKey = useRef<string>("");
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
  // disponible: uno desactivado no se preselecciona (taxpayer-setup).
  useEffect(() => {
    const point = defaultPoint.data?.available ? defaultPoint.data.emissionPoint.id : undefined;
    if (point && !form.getValues("emissionPointId")) {
      form.setValue("emissionPointId", point, { shouldDirty: true });
    }
  }, [defaultPoint.data, form]);

  useEffect(() => {
    if (operationError) alertRef.current?.focus();
  }, [operationError]);

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
  const lineIssues = (position: number) => issues.filter((issue) => issue.line === position);
  const paymentIssues = (position: number) => issues.filter((issue) => issue.payment === position);
  const generalIssues = issues.filter((issue) => issue.line === null && issue.payment === null);
  const stockWarnings = preview?.stockWarnings ?? [];
  const environment = status.data ? ENVIRONMENT_LABELS[status.data.environment] : null;
  // Mientras se guarda, la emisión espera: el guardado vuelve a montar el editor con la versión nueva.
  const emitBlocked = !draft || isDirty || issues.length > 0 || save.isPending;
  const emitHintId = useId();
  const emitHint = !draft
    ? "Guarda el borrador para emitirlo."
    : isDirty
      ? "Guarda los cambios antes de emitir."
      : issues.length > 0
        ? "Resuelve los problemas del resumen antes de emitir."
        : undefined;

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

  return (
    <section aria-labelledby="editor-titulo" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Link
          href="/borradores"
          className="inline-flex items-center gap-0.5 self-start text-sm text-foreground-muted hover:text-foreground"
        >
          <ArrowLeft aria-hidden="true" className="size-2" />
          Borradores
        </Link>
        <h1 id="editor-titulo" className="text-3xl font-bold">
          {draft ? "Borrador de factura" : "Nueva factura"}
        </h1>
      </div>

      {operationError && (
        <OperationAlert message={operationError.message} action={recovery} alertRef={alertRef} />
      )}

      <form noValidate onSubmit={onSave} className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-3">
          <Section title="Comprador y punto de emisión">
            <div className="flex flex-wrap items-center justify-between gap-1 rounded-md border border-border bg-surface px-1.5 py-1">
              {buyer ? (
                <span className="flex min-w-0 items-center gap-1">
                  <UserRound aria-hidden="true" className="size-2 shrink-0 text-foreground-muted" />
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium break-words">{buyer.legalName}</span>
                    <span className="text-sm text-foreground-muted tabular-nums">
                      {buyer.identification}
                    </span>
                  </span>
                  {buyer.consumerFinal && <StatusBadge tone="neutral" label="Consumidor final" />}
                </span>
              ) : (
                <span className="text-sm text-foreground-muted">Sin comprador</span>
              )}
              <Button variant="outline" onClick={() => setPickingBuyer(true)}>
                {buyer ? "Cambiar comprador" : "Elegir comprador"}
              </Button>
            </div>
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

          <Section title="Productos">
            {lines.fields.length === 0 ? (
              <p className="text-sm text-foreground-muted">
                Agrega los productos o servicios que vendes en esta factura.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {lines.fields.map((field, index) => {
                  const position = index + 1;
                  const lineError = errors.lines?.[index];
                  const problems = draft && !isDirty ? lineIssues(position) : [];
                  // El aviso suma todas las líneas del producto: se muestra junto a la última.
                  const lastOfProduct = !lines.fields
                    .slice(index + 1)
                    .some((other) => other.productId === field.productId);
                  const warning =
                    draft && !isDirty && lastOfProduct
                      ? stockWarnings.find((candidate) => candidate.productId === field.productId)
                      : undefined;
                  return (
                    <li
                      key={field.id}
                      aria-label={`Línea ${position}: ${field.name}`}
                      aria-invalid={problems.length > 0 || undefined}
                      className="flex flex-col gap-1 rounded-md border border-border bg-surface px-1.5 py-1 aria-invalid:border-danger"
                    >
                      <div className="flex items-start justify-between gap-1">
                        <span className="flex min-w-0 flex-col">
                          <span className="font-medium break-words">{field.name}</span>
                          {field.mainCode && (
                            <span className="text-xs text-foreground-muted">{field.mainCode}</span>
                          )}
                        </span>
                        <RowActionButton
                          icon={Trash2}
                          label={`Quitar la línea ${position}`}
                          onClick={() => lines.remove(index)}
                        />
                      </div>
                      <div className="grid gap-1 sm:grid-cols-3">
                        <FormField
                          id={`cantidad-${index}`}
                          label="Cantidad"
                          error={lineError?.quantity?.message}
                        >
                          <Input
                            inputMode="decimal"
                            {...fieldAria(`cantidad-${index}`, lineError?.quantity?.message)}
                            {...form.register(`lines.${index}.quantity`)}
                          />
                        </FormField>
                        <div className="flex flex-col gap-0.5">
                          <span className="text-sm font-medium">Precio unitario</span>
                          <span className="flex h-5 items-center text-sm tabular-nums max-md:h-5.5">
                            {formatUsd(field.unitPrice)}
                          </span>
                        </div>
                        <FormField
                          id={`descuento-${index}`}
                          label="Descuento"
                          error={lineError?.discount?.message}
                        >
                          <Input
                            inputMode="decimal"
                            placeholder="0,00"
                            {...fieldAria(`descuento-${index}`, lineError?.discount?.message)}
                            {...form.register(`lines.${index}.discount`)}
                          />
                        </FormField>
                      </div>
                      <IssueList issues={problems} />
                      {warning && <StockWarningNote warning={warning} />}
                    </li>
                  );
                })}
              </ul>
            )}
            <Button
              variant="outline"
              className="self-start"
              onClick={() => setPickingProduct(true)}
            >
              <Plus aria-hidden="true" />
              Agregar producto
            </Button>
          </Section>

          <Section title="Formas de pago">
            <ul className="flex flex-col gap-1.5">
              {payments.fields.map((field, index) => {
                const position = index + 1;
                const paymentError = errors.payments?.[index];
                const problems = draft && !isDirty ? paymentIssues(position) : [];
                return (
                  <li
                    key={field.id}
                    className="grid items-end gap-1 sm:grid-cols-[minmax(0,1fr)_10rem_auto]"
                  >
                    <FormField
                      id={`forma-${index}`}
                      label={`Forma de pago ${position}`}
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
                      hint={payments.fields.length === 1 ? "Vacío: el total" : undefined}
                      error={paymentError?.amount?.message}
                    >
                      <Input
                        inputMode="decimal"
                        {...fieldAria(
                          `importe-${index}`,
                          paymentError?.amount?.message,
                          payments.fields.length === 1 ? "Vacío: el total" : undefined,
                        )}
                        {...form.register(`payments.${index}.amount`)}
                      />
                    </FormField>
                    <RowActionButton
                      icon={Trash2}
                      label={`Quitar la forma de pago ${position}`}
                      onClick={() => payments.remove(index)}
                    />
                    <div className="sm:col-span-3">
                      <IssueList issues={problems} />
                    </div>
                  </li>
                );
              })}
            </ul>
            <Button
              variant="outline"
              className="self-start"
              onClick={() => payments.append({ paymentMethod: "", amount: "" })}
            >
              <Plus aria-hidden="true" />
              Agregar forma de pago
            </Button>
          </Section>
        </div>

        <aside
          aria-labelledby="resumen-titulo"
          className="flex flex-col gap-2 lg:sticky lg:top-2 lg:self-start"
        >
          <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface p-2">
            <h2 id="resumen-titulo" className="text-lg font-semibold">
              Resumen
            </h2>
            {!draft || isDirty ? (
              <p className="text-sm text-foreground-muted">
                Guarda el borrador para calcular los totales con los precios y tarifas vigentes.
              </p>
            ) : preview?.totals ? (
              <dl className="grid grid-cols-[1fr_auto] gap-x-2 gap-y-0.5 text-sm tabular-nums">
                <dt>Subtotal sin impuestos</dt>
                <dd className="text-right">{formatUsd(preview.totals.withoutTaxes)}</dd>
                <dt>Descuento</dt>
                <dd className="text-right">{formatUsd(preview.totals.discount)}</dd>
                {preview.totals.taxes.map((tax) => (
                  <div key={`${tax.taxCode}-${tax.rateCode}`} className="contents">
                    <dt>IVA {formatPercentage(tax.percentage)}</dt>
                    <dd className="text-right">{formatUsd(tax.amount)}</dd>
                  </div>
                ))}
                <dt className="font-semibold">Total</dt>
                <dd className="text-right font-semibold">{formatUsd(preview.totals.total)}</dd>
              </dl>
            ) : (
              <p className="text-sm text-foreground-muted">
                Los totales aparecen cuando todas las líneas se pueden calcular.
              </p>
            )}
            {preview && !isDirty && (
              <p className="text-xs text-foreground-muted">
                Vista previa del {formatIssueDate(preview.evaluatedOn)}, sin validez fiscal.
              </p>
            )}
            {draft && !isDirty && generalIssues.length > 0 && (
              <div className="flex flex-col gap-0.5">
                <h3 className="text-sm font-semibold">Antes de emitir</h3>
                <IssueList issues={generalIssues} />
              </div>
            )}
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
                Emitir factura
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
            <span className="text-sm text-foreground-muted tabular-nums">
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
          <span className="flex w-full items-center justify-between gap-1">
            <span className="flex min-w-0 flex-col">
              <span className="font-medium break-words">{product.name}</span>
              {product.mainCode && (
                <span className="text-xs text-foreground-muted">{product.mainCode}</span>
              )}
            </span>
            <span className="text-sm tabular-nums">{formatUsd(product.unitPrice)}</span>
          </span>
        )}
        onSelect={(product) =>
          lines.append({
            productId: product.id,
            name: product.name,
            mainCode: product.mainCode,
            unitPrice: product.unitPrice,
            quantity: "1",
            discount: "",
          })
        }
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
          onConfirm={() =>
            emit.mutate({
              draft: { id: draft.id, version: draft.version },
              idempotencyKey: idempotencyKey.current,
            })
          }
          description={
            <div className="flex flex-col gap-1">
              <p>La emisión reserva el número de la factura y la firma; no se puede deshacer.</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-foreground">
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
              {draft.buyer?.systemRecord === "CONSUMER_FINAL" && (
                <p className="rounded-md border border-warning/40 bg-warning/10 px-1 py-0.5 text-foreground">
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

/** Editor de un borrador existente (`draftId`) o de uno nuevo (`null`). */
export function DraftEditorScreen({ draftId }: { draftId: string | null }) {
  const { me } = useSession();
  const allowed = canSee(me.role, "invoices.draft");
  const canEmit = canSee(me.role, "invoices.emit");
  const draft = useDraft(draftId, allowed);

  if (!allowed) {
    return (
      <section aria-labelledby="editor-titulo" className="flex flex-col gap-3">
        <h1 id="editor-titulo" className="text-3xl font-bold">
          Borrador de factura
        </h1>
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
    const missing = error instanceof ApiError && error.status === 404;
    return (
      <section aria-labelledby="editor-titulo" className="flex flex-col gap-3">
        <h1 id="editor-titulo" className="text-3xl font-bold">
          Borrador de factura
        </h1>
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

export function DraftEditorSkeleton() {
  return (
    <section aria-busy="true" className="flex flex-col gap-3">
      <h1 className="text-3xl font-bold">Borrador de factura</h1>
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-24 w-full" />
    </section>
  );
}
