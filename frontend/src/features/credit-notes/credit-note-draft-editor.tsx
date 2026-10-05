// Borrador de nota de crédito a página completa (add-credit-notes, design D19): flujo de riesgo
// (frontend-checklist.md). Usuario: administrador u operador. Objetivo: corregir una venta autorizada
// sin equivocar importes ni existencias. Decisión: causa, líneas, cantidades y retorno físico.
// Información mínima: la factura, lo acreditable por línea, los importes de la nota y los problemas.
// Acción principal: "Emitir nota de crédito", que pide las dos declaraciones por separado; secundaria:
// "Guardar borrador". El frontend no calcula dinero: los importes y los problemas son la vista previa
// del servidor del borrador guardado.
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CREDIT_NOTE_CAUSE_LABELS,
  CREDIT_NOTE_ELIGIBILITY_DECLARATION,
  CREDIT_NOTE_REASON_MAX,
  compareDecimalStrings,
  defaultEmissionPointViewSchema,
  invoiceQuantitySchema,
  type CreditInvoiceLineView,
  type CreditNoteCause,
  type CreditNoteDeclarationStatement,
  type CreditNoteDraftView,
  type CreditNoteIssue,
  type EligibleInvoiceView,
  type InvoiceCreditView,
} from "@facturador/contracts";
import { ArrowLeft, FileText } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useForm, useWatch, type Resolver } from "react-hook-form";
import { z } from "zod";
import { AsyncButton } from "@/components/async-button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EntityPickerDialog } from "@/components/entity-picker-dialog";
import { errorMessage } from "@/components/feedback";
import { fieldAria, FormField } from "@/components/form-dialog";
import { SegmentedControl } from "@/components/segmented-control";
import { useSession } from "@/components/session";
import { EmptyState, ErrorState, Skeleton } from "@/components/states";
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
import { formatIssueDate } from "@/features/invoices/invoice-format";
import {
  CREDIT_NOTE_CONFLICT_MESSAGES,
  CREDIT_NOTE_DRAFTS_KEY,
  CREDIT_NOTES_KEY,
  fetchEligibleInvoices,
  useCreditNoteDraft,
  useEmitCreditNote,
  useInvoiceCredit,
  useSaveCreditNoteDraft,
} from "./credit-notes-api";

type LineValues = {
  position: number;
  /** Solo en una devolución: la línea se devuelve. */
  selected: boolean;
  quantity: string;
  /** Vacío es cero. */
  physicalReturn: string;
};
type FormValues = {
  emissionPointId: string;
  /** Vacía hasta que el usuario la elige: la causa se declara, no se infiere. */
  cause: CreditNoteCause | "";
  reason: string;
  lines: LineValues[];
};

const quantityMessage = (value: string) =>
  invoiceQuantitySchema.safeParse(value).error?.issues[0]?.message ?? null;

const formSchema = z
  .object({
    emissionPointId: z.string(),
    cause: z.union([z.literal(""), z.enum(["TOTAL_ANNULMENT", "RETURN"])]),
    reason: z
      .string()
      .max(
        CREDIT_NOTE_REASON_MAX,
        `El motivo admite como máximo ${CREDIT_NOTE_REASON_MAX} caracteres.`,
      ),
    lines: z.array(
      z.object({
        position: z.number(),
        selected: z.boolean(),
        quantity: z.string(),
        physicalReturn: z.string(),
      }),
    ),
  })
  .superRefine((values, ctx) => {
    if (values.cause === "") {
      ctx.addIssue({ code: "custom", path: ["cause"], message: "Elige la causa de la nota." });
      return;
    }
    values.lines.forEach((line, index) => {
      const included = values.cause === "TOTAL_ANNULMENT" || line.selected;
      if (!included) return;
      if (values.cause === "RETURN") {
        const problem =
          (line.quantity.trim() === "" ? "Indica la cantidad acreditada de la línea." : null) ??
          quantityMessage(line.quantity) ??
          (compareDecimalStrings(line.quantity, "0") > 0
            ? null
            : "La cantidad acreditada debe ser mayor que cero.");
        if (problem)
          ctx.addIssue({ code: "custom", path: ["lines", index, "quantity"], message: problem });
      }
      if (line.physicalReturn !== "") {
        const problem = quantityMessage(line.physicalReturn);
        if (problem) {
          ctx.addIssue({
            code: "custom",
            path: ["lines", index, "physicalReturn"],
            message: problem,
          });
        }
      }
    });
  });

const positive = (value: string) => value !== "" && compareDecimalStrings(value, "0") > 0;

const toForm = (draft: CreditNoteDraftView | null, credit: InvoiceCreditView): FormValues => {
  const saved = new Map(draft?.lines.map((line) => [line.position, line]) ?? []);
  const returning = draft?.cause === "RETURN";
  return {
    emissionPointId: draft?.emissionPoint?.id ?? "",
    cause: draft?.cause ?? "",
    reason: draft?.reason ?? "",
    lines: credit.lines.map((line) => {
      const stored = saved.get(line.position);
      return {
        position: line.position,
        selected: returning && stored !== undefined,
        quantity: returning && stored ? stored.quantity : "",
        physicalReturn: stored && positive(stored.physicalReturn) ? stored.physicalReturn : "",
      };
    }),
  };
};

const toInput = (values: FormValues) => {
  const cause = values.cause as CreditNoteCause;
  const lines =
    cause === "TOTAL_ANNULMENT"
      ? values.lines
          .filter((line) => positive(line.physicalReturn))
          .map((line) => ({ position: line.position, physicalReturn: line.physicalReturn }))
      : values.lines
          .filter((line) => line.selected)
          .map((line) => ({
            position: line.position,
            quantity: line.quantity,
            physicalReturn: line.physicalReturn || "0",
          }));
  return {
    emissionPointId: values.emissionPointId || null,
    cause,
    reason: values.reason.trim() || null,
    lines,
  };
};

/** Por qué una línea no admite retorno físico, o null si lo admite. */
function physicalReturnBlock(line: CreditInvoiceLineView): string | null {
  if (!line.inventoryAffectsStock)
    return "No admite retorno físico: en la factura, la línea no afectaba al inventario (un servicio o un bien sin control de existencias).";
  if (!line.returnable || compareDecimalStrings(line.returnable.available, "0") <= 0)
    return "No admite retorno físico: lo que la factura sacó del inventario ya se devolvió o está reservado por otra nota.";
  return null;
}

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

function IssueList({ issues }: { issues: readonly CreditNoteIssue[] }) {
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

/** Las dos declaraciones como casillas separadas, con su texto completo, su contexto y su fuente. */
function Declarations({
  checked,
  onChange,
}: {
  checked: readonly CreditNoteDeclarationStatement[];
  onChange: (next: CreditNoteDeclarationStatement[]) => void;
}) {
  const id = useId();
  const declaration = CREDIT_NOTE_ELIGIBILITY_DECLARATION;
  return (
    <fieldset className="mt-1 flex flex-col gap-1 text-sm">
      <legend className="mb-0.5 font-semibold">Declaraciones del usuario</legend>
      <p
        role="note"
        className="rounded-md border border-warning/40 bg-warning/10 px-1 py-0.5 text-foreground"
      >
        {declaration.notice}
      </p>
      {declaration.statements.map((statement) => {
        const contextId = `${id}-${statement.id}`;
        return (
          <div
            key={statement.id}
            className="flex flex-col gap-0.5 rounded-md border border-border px-1 py-0.5"
          >
            <label className="flex min-h-5.5 items-start gap-1">
              <input
                type="checkbox"
                className="mt-0.5 size-2.5 shrink-0 accent-primary"
                checked={checked.includes(statement.id)}
                aria-describedby={contextId}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...checked, statement.id]
                      : checked.filter((candidate) => candidate !== statement.id),
                  )
                }
              />
              <span>{statement.text}</span>
            </label>
            <p id={contextId} className="text-xs text-foreground-muted">
              {statement.context} Fuente: {statement.source}.
            </p>
          </div>
        );
      })}
      {checked.length < declaration.statements.length && (
        <p className="text-xs text-foreground-muted">Marca las dos declaraciones para emitir.</p>
      )}
    </fieldset>
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

function DraftEditor({
  draft,
  credit,
  canEmit,
  onChangeInvoice,
}: {
  draft: CreditNoteDraftView | null;
  credit: InvoiceCreditView;
  canEmit: boolean;
  /** Solo antes de guardar: la factura de un borrador guardado no cambia. */
  onChangeInvoice?: () => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [operationError, setOperationError] = useState<{ message: string; code?: string }>();
  const alertRef = useRef<HTMLDivElement>(null);
  /** La emisión acaba de fallar: al cerrar la confirmación, el foco va al aviso. */
  const emissionFailed = useRef(false);
  const summaryRef = useRef<HTMLHeadingElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [statements, setStatements] = useState<CreditNoteDeclarationStatement[]>([]);
  // Una clave por versión del borrador (el editor se vuelve a montar con cada versión): un
  // reintento de la misma solicitud la repite y el servidor devuelve o retoma la misma nota.
  const idempotencyKey = useRef<string>("");
  const establishments = useEstablishments();
  const status = useCompanyStatus();
  const defaultPoint = useDefaultPoint(draft === null);
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema) as unknown as Resolver<FormValues>,
    defaultValues: toForm(draft, credit),
  });
  const { errors, isDirty } = form.formState;
  const cause = useWatch({ control: form.control, name: "cause" });
  const lines = useWatch({ control: form.control, name: "lines" });
  const pointId = useWatch({ control: form.control, name: "emissionPointId" });
  const causeLabelId = useId();
  const causeHintId = useId();

  // Un borrador nuevo empieza en el punto predeterminado del usuario, si sigue disponible.
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
      message: errorMessage(error, CREDIT_NOTE_CONFLICT_MESSAGES),
      ...(error instanceof ApiError ? { code: error.code } : {}),
    });
    return true;
  };
  const refresh = () => {
    setOperationError(undefined);
    void queryClient.invalidateQueries({
      queryKey: [...CREDIT_NOTE_DRAFTS_KEY, "detail", draft?.id],
    });
    void queryClient.invalidateQueries({ queryKey: CREDIT_NOTES_KEY });
  };
  const save = useSaveCreditNoteDraft({
    onSuccess: (saved) => {
      setOperationError(undefined);
      focusAfterSave.summary = true;
      queryClient.setQueryData([...CREDIT_NOTE_DRAFTS_KEY, "detail", saved.id], saved);
      if (!draft) router.replace(`/notas-credito/borradores/${saved.id}`);
    },
    onError: fail,
  });
  const emit = useEmitCreditNote({
    onSuccess: (note) => router.push(`/notas-credito/${note.id}`),
    onError: (error) => {
      emissionFailed.current = true;
      setConfirming(false);
      setStatements([]);
      // Otra nota cambió el crédito de la factura: la vista previa se vuelve a pedir. Un borrador
      // cambiado se recarga a pedido, porque la versión nueva vuelve a montar el editor.
      if (
        error instanceof ApiError &&
        error.status === 409 &&
        error.code !== "CREDIT_NOTE_DRAFT_CHANGED"
      )
        refresh();
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

  const preview = draft?.preview;
  const fresh = draft !== null && !isDirty;
  const issues = preview?.issues ?? [];
  const lineIssues = (position: number) => issues.filter((issue) => issue.line === position);
  const generalIssues = issues.filter((issue) => issue.line === null);
  const previewLine = (position: number) =>
    preview?.lines.find((line) => line.position === position);
  const environment = status.data ? ENVIRONMENT_LABELS[status.data.environment] : null;
  const emitBlocked = !draft || isDirty || issues.length > 0 || save.isPending;
  const emitHintId = useId();
  const emitHint = !draft
    ? "Guarda el borrador para emitirlo."
    : isDirty
      ? "Guarda los cambios antes de emitir."
      : issues.length > 0
        ? "Resuelve los problemas antes de emitir."
        : undefined;
  const declared = CREDIT_NOTE_ELIGIBILITY_DECLARATION.statements.every((statement) =>
    statements.includes(statement.id),
  );

  const onSave = form.handleSubmit((values) => {
    setOperationError(undefined);
    const input = toInput(values);
    save.mutate({
      id: draft?.id ?? null,
      input: draft
        ? { ...input, expectedVersion: draft.version }
        : { ...input, invoiceId: credit.invoiceId },
    });
  });

  const recovery =
    operationError?.code === "CREDIT_NOTE_DRAFT_CHANGED" ? (
      <Button variant="outline" onClick={refresh}>
        Recargar borrador
      </Button>
    ) : operationError?.code === "CREDIT_NOTE_DRAFT_ALREADY_EMITTED" ? (
      <Button asChild variant="outline">
        <Link href="/notas-credito">Ver notas de crédito</Link>
      </Button>
    ) : undefined;

  return (
    <section aria-labelledby="editor-titulo" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Link
          href="/notas-credito"
          className="inline-flex items-center gap-0.5 self-start text-sm text-foreground-muted hover:text-foreground"
        >
          <ArrowLeft aria-hidden="true" className="size-2" />
          Notas de crédito
        </Link>
        <h1 id="editor-titulo" className="text-3xl font-bold">
          {draft ? "Borrador de nota de crédito" : "Nueva nota de crédito"}
        </h1>
      </div>

      {operationError && (
        <OperationAlert message={operationError.message} action={recovery} alertRef={alertRef} />
      )}

      <form noValidate onSubmit={onSave} className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-3">
          <Section title="Factura que se modifica">
            <div className="flex flex-wrap items-center justify-between gap-1 rounded-md border border-border bg-surface px-1.5 py-1">
              <span className="flex min-w-0 items-center gap-1">
                <FileText aria-hidden="true" className="size-2 shrink-0 text-foreground-muted" />
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium tabular-nums">Factura {credit.documentNumber}</span>
                  <span className="text-sm text-foreground-muted break-words">
                    {credit.buyerName} · {credit.buyerIdentification} ·{" "}
                    {formatIssueDate(credit.issueDate)} · Total {formatUsd(credit.total)}
                  </span>
                </span>
              </span>
              {onChangeInvoice && (
                <Button variant="outline" onClick={onChangeInvoice}>
                  Cambiar factura
                </Button>
              )}
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

          <Section title="Causa y motivo">
            <div className="flex flex-col gap-0.5">
              <span id={causeLabelId} className="text-sm font-medium">
                Causa
              </span>
              <SegmentedControl
                aria-labelledby={causeLabelId}
                aria-describedby={causeHintId}
                aria-invalid={errors.cause ? true : undefined}
                options={[
                  { value: "RETURN", label: CREDIT_NOTE_CAUSE_LABELS.RETURN },
                  { value: "TOTAL_ANNULMENT", label: CREDIT_NOTE_CAUSE_LABELS.TOTAL_ANNULMENT },
                ]}
                value={cause || undefined}
                onChange={(next) =>
                  form.setValue("cause", next, { shouldDirty: true, shouldValidate: true })
                }
              />
              <p
                id={causeHintId}
                className={errors.cause ? "text-sm text-danger" : "text-xs text-foreground-muted"}
              >
                {errors.cause?.message ??
                  (cause === "TOTAL_ANNULMENT"
                    ? credit.totalAnnulmentAvailable
                      ? "Acredita la factura completa: todas sus líneas y cantidades."
                      : "La factura ya tiene créditos reservados o aplicados: la anulación total no procede."
                    : "Una devolución acredita las líneas y cantidades que elijas.")}
              </p>
            </div>
            <FormField
              id="motivo"
              label="Motivo"
              hint="Aparece en la nota de crédito. Una sola línea."
              error={errors.reason?.message}
            >
              <Input
                maxLength={CREDIT_NOTE_REASON_MAX}
                {...fieldAria(
                  "motivo",
                  errors.reason?.message,
                  "Aparece en la nota de crédito. Una sola línea.",
                )}
                {...form.register("reason")}
              />
            </FormField>
          </Section>

          <Section title="Líneas de la factura">
            {cause === "" ? (
              <p className="text-sm text-foreground-muted">
                Elige la causa para ver lo que se acredita de cada línea.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {credit.lines.map((line, index) => {
                  const values = lines[index];
                  const lineError = errors.lines?.[index];
                  const problems = fresh ? lineIssues(line.position) : [];
                  const included = cause === "TOTAL_ANNULMENT" || values?.selected === true;
                  const exhausted = compareDecimalStrings(line.credited.available, "0") <= 0;
                  const block = physicalReturnBlock(line);
                  const computed = fresh ? previewLine(line.position) : undefined;
                  const returnHint = block
                    ? block
                    : `Lo que vuelve al inventario. Del producto quedan ${formatDecimal(line.returnable!.available)} por devolver.`;
                  return (
                    <li
                      key={line.position}
                      aria-label={`Línea ${line.position}: ${line.description}`}
                      aria-invalid={problems.length > 0 || undefined}
                      className="flex flex-col gap-1 rounded-md border border-border bg-surface px-1.5 py-1 aria-invalid:border-danger"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-1">
                        <span className="flex min-w-0 flex-col">
                          <span className="font-medium break-words">{line.description}</span>
                          <span className="text-xs text-foreground-muted tabular-nums">
                            {line.mainCode && `${line.mainCode} · `}
                            {formatDecimal(line.quantity)} × {formatUsd(line.unitPrice)}
                            {line.discount !== "0.00" && ` · Descuento ${formatUsd(line.discount)}`}
                            {line.taxes.map((tax) => ` · IVA ${formatPercentage(tax.percentage)}`)}
                          </span>
                        </span>
                        <span className="text-sm text-foreground-muted tabular-nums">
                          Acreditable: {formatDecimal(line.credited.available)} de{" "}
                          {formatDecimal(line.quantity)}
                        </span>
                      </div>
                      {cause === "RETURN" ? (
                        <label className="flex min-h-5.5 items-center gap-1 text-sm">
                          <input
                            type="checkbox"
                            className="size-2.5 accent-primary"
                            disabled={exhausted && !values?.selected}
                            {...form.register(`lines.${index}.selected`)}
                          />
                          {exhausted && !values?.selected
                            ? "Ya se acreditó por completo"
                            : "Devolver esta línea"}
                        </label>
                      ) : (
                        <p className="text-sm">
                          Se acredita completa: {formatDecimal(line.quantity)}.
                        </p>
                      )}
                      {included && (
                        <div className="grid gap-1 sm:grid-cols-2">
                          {cause === "RETURN" && (
                            <FormField
                              id={`cantidad-${line.position}`}
                              label="Cantidad acreditada"
                              hint={`Hasta ${formatDecimal(line.credited.available)}.`}
                              error={lineError?.quantity?.message}
                            >
                              <Input
                                inputMode="decimal"
                                {...fieldAria(
                                  `cantidad-${line.position}`,
                                  lineError?.quantity?.message,
                                  `Hasta ${formatDecimal(line.credited.available)}.`,
                                )}
                                {...form.register(`lines.${index}.quantity`)}
                              />
                            </FormField>
                          )}
                          <FormField
                            id={`retorno-${line.position}`}
                            label="Retorno físico"
                            hint={returnHint}
                            error={lineError?.physicalReturn?.message}
                          >
                            <Input
                              inputMode="decimal"
                              placeholder="0"
                              disabled={block !== null && !positive(values?.physicalReturn ?? "")}
                              {...fieldAria(
                                `retorno-${line.position}`,
                                lineError?.physicalReturn?.message,
                                returnHint,
                              )}
                              {...form.register(`lines.${index}.physicalReturn`)}
                            />
                          </FormField>
                        </div>
                      )}
                      {computed && (
                        <p className="text-sm text-foreground-muted tabular-nums">
                          En la nota: {formatDecimal(computed.quantity)} por una base imponible de{" "}
                          {formatUsd(computed.taxableBase)}. Después de esta nota quedan{" "}
                          {formatDecimal(computed.remainingQuantity)} acreditables.
                        </p>
                      )}
                      <IssueList issues={problems} />
                    </li>
                  );
                })}
              </ul>
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
                Guarda el borrador para calcular los importes con el crédito vigente de la factura.
              </p>
            ) : preview?.totals ? (
              <dl className="grid grid-cols-[1fr_auto] gap-x-2 gap-y-0.5 text-sm tabular-nums">
                <dt>Subtotal sin impuestos</dt>
                <dd className="text-right">{formatUsd(preview.totals.withoutTaxes)}</dd>
                {preview.totals.taxes.map((tax) => (
                  <div key={`${tax.taxCode}-${tax.rateCode}`} className="contents">
                    <dt>IVA {formatPercentage(tax.percentage)}</dt>
                    <dd className="text-right">{formatUsd(tax.amount)}</dd>
                  </div>
                ))}
                <dt className="font-semibold">Valor de la nota</dt>
                <dd className="text-right font-semibold">{formatUsd(preview.totals.total)}</dd>
              </dl>
            ) : (
              <p className="text-sm text-foreground-muted">
                Los importes aparecen cuando la nota se puede calcular.
              </p>
            )}
            <p className="text-sm text-foreground-muted tabular-nums">
              Disponible en la factura: {formatUsd(credit.available)}
            </p>
            {preview && fresh && (
              <p className="text-xs text-foreground-muted">
                Vista previa del {formatIssueDate(preview.evaluatedOn)}, sin validez fiscal. No
                reserva nada: la emisión vuelve a comprobar el crédito.
              </p>
            )}
            {fresh && generalIssues.length > 0 && (
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
                Emitir nota de crédito
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

      {draft && (
        <ConfirmDialog
          open={confirming}
          onOpenChange={(open) => {
            setConfirming(open);
            if (!open) setStatements([]);
          }}
          title="Emitir nota de crédito"
          confirmLabel="Emitir nota de crédito"
          pending={emit.isPending}
          confirmBlocked={!declared}
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
              statements,
              idempotencyKey: idempotencyKey.current,
            })
          }
          description={
            <div className="flex flex-col gap-1">
              <p>
                La emisión reserva el número de la nota y su crédito en la factura, y la firma; no
                se puede deshacer.
              </p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-foreground">
                <dt className="text-foreground-muted">Ambiente</dt>
                <dd>{environment ?? "Desconocido"}</dd>
                <dt className="text-foreground-muted">Factura</dt>
                <dd className="tabular-nums">{draft.invoice.documentNumber}</dd>
                <dt className="text-foreground-muted">Causa</dt>
                <dd>{CREDIT_NOTE_CAUSE_LABELS[draft.cause]}</dd>
                <dt className="text-foreground-muted">Valor</dt>
                <dd className="tabular-nums">
                  {draft.preview.totals ? formatUsd(draft.preview.totals.total) : "—"}
                </dd>
              </dl>
            </div>
          }
        >
          <Declarations checked={statements} onChange={setStatements} />
        </ConfirmDialog>
      )}
    </section>
  );
}

/** Antes de elegir la factura: el selector de las facturas elegibles. */
function InvoiceChooser({ onChoose }: { onChoose: (invoiceId: string) => void }) {
  const [picking, setPicking] = useState(false);
  return (
    <section aria-labelledby="editor-titulo" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Link
          href="/notas-credito"
          className="inline-flex items-center gap-0.5 self-start text-sm text-foreground-muted hover:text-foreground"
        >
          <ArrowLeft aria-hidden="true" className="size-2" />
          Notas de crédito
        </Link>
        <h1 id="editor-titulo" className="text-3xl font-bold">
          Nueva nota de crédito
        </h1>
      </div>
      <Section title="Factura que se modifica">
        <p className="text-sm text-foreground-muted">
          Elige una factura autorizada, identificada y con valor acreditable.
        </p>
        <Button className="self-start" onClick={() => setPicking(true)}>
          Elegir factura
        </Button>
      </Section>
      <EntityPickerDialog<EligibleInvoiceView>
        open={picking}
        onOpenChange={setPicking}
        title="Elegir factura"
        searchLabel="Buscar por número o comprador"
        searchPlaceholder="Número o comprador"
        queryKey={[...CREDIT_NOTES_KEY, "eligible-invoices"]}
        fetchPage={fetchEligibleInvoices}
        getKey={(invoice) => invoice.id}
        getLabel={(invoice) => `Factura ${invoice.documentNumber}, ${invoice.buyerName}`}
        renderItem={(invoice) => (
          <span className="flex w-full items-center justify-between gap-1">
            <span className="flex min-w-0 flex-col">
              <span className="font-medium tabular-nums">{invoice.documentNumber}</span>
              <span className="text-sm break-words text-foreground-muted">
                {invoice.buyerName} · {formatIssueDate(invoice.issueDate)}
              </span>
            </span>
            <span className="text-sm tabular-nums">Disponible {formatUsd(invoice.available)}</span>
          </span>
        )}
        onSelect={(invoice) => onChoose(invoice.id)}
        emptyTitle="No hay facturas elegibles"
        emptyDescription="Una nota de crédito corrige una factura autorizada, identificada y con valor acreditable."
      />
    </section>
  );
}

function Fallback({ children }: { children: ReactNode }) {
  return (
    <section aria-labelledby="editor-titulo" className="flex flex-col gap-3">
      <h1 id="editor-titulo" className="text-3xl font-bold">
        Borrador de nota de crédito
      </h1>
      {children}
    </section>
  );
}

/** Editor de un borrador existente (`draftId`) o de uno nuevo (`null`), con la factura opcional. */
export function CreditNoteDraftScreen({
  draftId,
  invoiceId = null,
}: {
  draftId: string | null;
  invoiceId?: string | null;
}) {
  const { me } = useSession();
  const allowed = canSee(me.role, "creditNotes.draft");
  const canEmit = canSee(me.role, "creditNotes.emit");
  const draft = useCreditNoteDraft(draftId, allowed);
  const [chosen, setChosen] = useState<string | null>(invoiceId);
  const target = draftId ? (draft.data?.invoice.id ?? null) : chosen;
  const credit = useInvoiceCredit(target, allowed);

  if (!allowed) {
    return (
      <Fallback>
        <EmptyState
          kind="no-permission"
          title="No tienes acceso a los borradores de notas de crédito"
          description="Pide a un administrador que revise tu rol."
        />
      </Fallback>
    );
  }
  if (draftId && draft.isPending) return <CreditNoteDraftSkeleton />;
  if (draftId && draft.isError) {
    const error = draft.error;
    const emitted = error instanceof ApiError && error.code === "CREDIT_NOTE_DRAFT_ALREADY_EMITTED";
    const missing = error instanceof ApiError && error.status === 404;
    return (
      <Fallback>
        {emitted || missing ? (
          <EmptyState
            kind="empty"
            title={emitted ? "Este borrador ya se emitió" : "El borrador no existe"}
            description={
              emitted
                ? "Encuéntralo en Notas de crédito: un borrador emitido ya no se corrige."
                : "Puede que se haya eliminado."
            }
            action={
              <Button asChild variant="outline">
                <Link href="/notas-credito">Ver notas de crédito</Link>
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
  if (!target) return <InvoiceChooser onChoose={setChosen} />;
  if (credit.isPending) return <CreditNoteDraftSkeleton />;
  if (credit.isError) {
    const missing = credit.error instanceof ApiError && credit.error.status === 404;
    return (
      <Fallback>
        {missing ? (
          <EmptyState
            kind="empty"
            title="La factura no existe"
            description="Elige otra factura para la nota de crédito."
            action={
              <Button asChild variant="outline">
                <Link href="/notas-credito/borradores/nueva">Elegir otra factura</Link>
              </Button>
            }
          />
        ) : (
          <ErrorState
            message="No pudimos cargar el crédito de la factura."
            onRetry={() => void credit.refetch()}
          />
        )}
      </Fallback>
    );
  }
  const data = draftId ? (draft.data ?? null) : null;
  return (
    <DraftEditor
      key={data ? `${data.id}-${data.version}` : `nueva-${target}`}
      draft={data}
      credit={credit.data}
      canEmit={canEmit}
      {...(data ? {} : { onChangeInvoice: () => setChosen(null) })}
    />
  );
}

export function CreditNoteDraftSkeleton() {
  return (
    <section aria-busy="true" className="flex flex-col gap-3">
      <h1 className="text-3xl font-bold">Borrador de nota de crédito</h1>
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-24 w-full" />
    </section>
  );
}
