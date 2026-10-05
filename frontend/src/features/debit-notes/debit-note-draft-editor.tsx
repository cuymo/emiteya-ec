// Borrador de nota de débito a página completa (add-debit-notes, design D23): flujo de riesgo
// (frontend-checklist.md). Usuario: administrador u operador con `debitNotes.draft`. Objetivo: cobrar
// después de la venta sin equivocar la causa ni el IVA. Decisiones: la factura, los conceptos, la
// forma de pago y la declaración. Información mínima: la factura y sus tratamientos, los conceptos,
// las bases e impuestos por tratamiento, el valor total y los problemas. Acción principal: "Emitir
// nota de débito", que pide la declaración; secundaria: "Guardar borrador". El frontend no calcula
// dinero: los importes y los problemas son la vista previa del servidor del borrador guardado, y los
// tratamientos ofrecidos son los de la factura que devuelve esa vista previa.
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DEBIT_NOTE_CAUSES,
  DEBIT_NOTE_CAUSE_LABELS,
  DEBIT_NOTE_CONCEPTS_MAX,
  DEBIT_NOTE_DESCRIPTION_MAX,
  DEBIT_NOTE_ELIGIBILITY_DECLARATION,
  debitNoteAmountSchema,
  debitNoteDescriptionSchema,
  defaultEmissionPointViewSchema,
  type DebitEligibleInvoiceView,
  type DebitNoteCause,
  type DebitNoteDeclarationStatement,
  type DebitNoteDraftView,
  type DebitNoteIssue,
  type DebitNoteTaxTreatmentView,
} from "@facturador/contracts";
import { ArrowLeft, FileText, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useFieldArray, useForm, useWatch, type Resolver } from "react-hook-form";
import { z } from "zod";
import { AsyncButton } from "@/components/async-button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { RowActionButton } from "@/components/data-table/table-controls";
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
import { formatUsd } from "@/lib/decimal";
import { canSee } from "@/lib/permissions";
import { ENVIRONMENT_LABELS, useCompanyStatus } from "@/features/company/company-api";
import {
  DEFAULT_POINT_KEY,
  pointLabel,
  useEstablishments,
} from "@/features/establishments/establishments-api";
import { useCatalogEntries } from "@/features/fiscal-catalogs/catalogs-api";
import { formatIssueDate } from "@/features/invoices/invoice-format";
import { useInvoice } from "@/features/invoices/invoices-api";
import {
  DEBIT_NOTE_CONFLICT_MESSAGES,
  DEBIT_NOTE_DRAFTS_KEY,
  DEBIT_NOTES_KEY,
  fetchDebitEligibleInvoices,
  useDebitNoteDraft,
  useEmitDebitNote,
  useSaveDebitNoteDraft,
} from "./debit-notes-api";

type ConceptValues = {
  /** Vacía hasta que el usuario la elige: la causa se declara, no se infiere. */
  cause: DebitNoteCause | "";
  description: string;
  amount: string;
  /** Vacío hasta que se elige uno de los tratamientos de la factura. */
  taxTreatment: string;
};
type FormValues = {
  emissionPointId: string;
  paymentMethod: string;
  concepts: ConceptValues[];
};

/** Hasta cinco tratamientos, un control segmentado; desde seis, una lista (design D23). */
const SEGMENTED_TREATMENTS_MAX = 5;

const blankConcept = (): ConceptValues => ({
  cause: "",
  description: "",
  amount: "",
  taxTreatment: "",
});

const firstMessage = (schema: z.ZodType, value: string) =>
  schema.safeParse(value).error?.issues[0]?.message ?? null;

// El borrador se guarda incompleto: solo se valida lo que el usuario escribió. Lo que falta lo
// informa la vista previa del servidor junto a su concepto.
const formSchema = z
  .object({
    emissionPointId: z.string(),
    paymentMethod: z.string(),
    concepts: z
      .array(
        z.object({
          cause: z.union([z.literal(""), z.enum(DEBIT_NOTE_CAUSES)]),
          description: z.string(),
          amount: z.string(),
          taxTreatment: z.string(),
        }),
      )
      .max(
        DEBIT_NOTE_CONCEPTS_MAX,
        `La nota admite como máximo ${DEBIT_NOTE_CONCEPTS_MAX} conceptos.`,
      ),
  })
  .superRefine((values, ctx) => {
    values.concepts.forEach((concept, index) => {
      const description = concept.description.trim();
      const descriptionProblem =
        description === "" ? null : firstMessage(debitNoteDescriptionSchema, description);
      if (descriptionProblem) {
        ctx.addIssue({
          code: "custom",
          path: ["concepts", index, "description"],
          message: descriptionProblem,
        });
      }
      const amount = concept.amount.trim();
      const amountProblem = amount === "" ? null : firstMessage(debitNoteAmountSchema, amount);
      if (amountProblem) {
        ctx.addIssue({
          code: "custom",
          path: ["concepts", index, "amount"],
          message: amountProblem,
        });
      }
    });
  });

const toForm = (draft: DebitNoteDraftView): FormValues => ({
  emissionPointId: draft.emissionPoint?.id ?? "",
  paymentMethod: draft.paymentMethod ?? "",
  concepts:
    draft.concepts.length > 0
      ? draft.concepts.map((concept) => ({
          cause: concept.cause ?? "",
          description: concept.description ?? "",
          amount: concept.amount ?? "",
          taxTreatment: concept.taxTreatment ?? "",
        }))
      : [blankConcept()],
});

const toInput = (values: FormValues) => ({
  emissionPointId: values.emissionPointId || null,
  paymentMethod: values.paymentMethod || null,
  concepts: values.concepts.map((concept) => ({
    cause: concept.cause || null,
    description: concept.description.trim() || null,
    amount: concept.amount.trim() || null,
    taxTreatment: concept.taxTreatment || null,
  })),
});

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

function IssueList({ issues }: { issues: readonly DebitNoteIssue[] }) {
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

/** La declaración como una casilla, con su texto completo, su contexto, su fuente y el aviso. */
function Declaration({
  checked,
  onChange,
}: {
  checked: readonly DebitNoteDeclarationStatement[];
  onChange: (next: DebitNoteDeclarationStatement[]) => void;
}) {
  const id = useId();
  const declaration = DEBIT_NOTE_ELIGIBILITY_DECLARATION;
  return (
    <fieldset className="mt-1 flex flex-col gap-1 text-sm">
      <legend className="mb-0.5 font-semibold">Declaración del usuario</legend>
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
        <p className="text-xs text-foreground-muted">Marca la declaración para emitir.</p>
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

/** El tratamiento de un concepto, solo entre los de la factura: nunca una tarifa ajena. */
function TreatmentField({
  position,
  treatments,
  value,
  onChange,
}: {
  position: number;
  treatments: readonly DebitNoteTaxTreatmentView[];
  value: string;
  onChange: (next: string) => void;
}) {
  const labelId = useId();
  const hint = "Solo los tratamientos de IVA de la factura.";
  if (treatments.length <= SEGMENTED_TREATMENTS_MAX) {
    return (
      <div className="flex flex-col gap-0.5">
        <span id={labelId} className="text-sm font-medium">
          Tratamiento de IVA
        </span>
        <SegmentedControl
          aria-labelledby={labelId}
          options={treatments.map((treatment) => ({
            value: treatment.key,
            label: treatment.label,
          }))}
          value={value || undefined}
          onChange={onChange}
        />
        <p className="text-xs text-foreground-muted">{hint}</p>
      </div>
    );
  }
  return (
    <FormField id={`tratamiento-${position}`} label="Tratamiento de IVA" hint={hint}>
      <Select
        {...fieldAria(`tratamiento-${position}`, undefined, hint)}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Elige un tratamiento</option>
        {treatments.map((treatment) => (
          <option key={treatment.key} value={treatment.key}>
            {treatment.label}
          </option>
        ))}
      </Select>
    </FormField>
  );
}

function DraftEditor({ draft, canEmit }: { draft: DebitNoteDraftView; canEmit: boolean }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [operationError, setOperationError] = useState<{ message: string; code?: string }>();
  const alertRef = useRef<HTMLDivElement>(null);
  /** La emisión acaba de fallar: al cerrar la confirmación, el foco va al aviso. */
  const emissionFailed = useRef(false);
  const summaryRef = useRef<HTMLHeadingElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [statements, setStatements] = useState<DebitNoteDeclarationStatement[]>([]);
  // Una clave por versión del borrador (el editor se vuelve a montar con cada versión): un
  // reintento de la misma solicitud la repite y el servidor devuelve o retoma la misma nota.
  const idempotencyKey = useRef<string>("");
  const establishments = useEstablishments();
  const paymentMethods = useCatalogEntries("payment-method", true);
  const status = useCompanyStatus();
  const defaultPoint = useDefaultPoint(draft.emissionPoint === null);
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema) as unknown as Resolver<FormValues>,
    defaultValues: toForm(draft),
  });
  const { errors, isDirty } = form.formState;
  const concepts = useFieldArray({ control: form.control, name: "concepts" });
  const values = useWatch({ control: form.control, name: "concepts" });
  const pointId = useWatch({ control: form.control, name: "emissionPointId" });
  const paymentMethod = useWatch({ control: form.control, name: "paymentMethod" });

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
      message: errorMessage(error, DEBIT_NOTE_CONFLICT_MESSAGES),
      ...(error instanceof ApiError ? { code: error.code } : {}),
    });
    return true;
  };
  const refresh = () => {
    setOperationError(undefined);
    void queryClient.invalidateQueries({
      queryKey: [...DEBIT_NOTE_DRAFTS_KEY, "detail", draft.id],
    });
    void queryClient.invalidateQueries({ queryKey: DEBIT_NOTES_KEY });
  };
  const save = useSaveDebitNoteDraft({
    onSuccess: (saved) => {
      setOperationError(undefined);
      focusAfterSave.summary = true;
      queryClient.setQueryData([...DEBIT_NOTE_DRAFTS_KEY, "detail", saved.id], saved);
    },
    onError: fail,
  });
  const emit = useEmitDebitNote({
    onSuccess: (note) => router.push(`/notas-debito/${note.id}`),
    onError: (error) => {
      emissionFailed.current = true;
      setConfirming(false);
      setStatements([]);
      // La factura, el catálogo o el borrador cambiaron: la vista previa se vuelve a pedir. Un
      // borrador cambiado se recarga a pedido, porque la versión nueva vuelve a montar el editor.
      if (
        error instanceof ApiError &&
        error.status === 409 &&
        error.code !== "DEBIT_NOTE_DRAFT_CHANGED"
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
  // Solo las formas de pago vigentes y habilitadas; la guardada que dejó de serlo se muestra para
  // que el usuario la cambie (la vista previa lo explica).
  const methodOptions = (paymentMethods.data?.entries ?? [])
    .filter((entry) => entry.usable)
    .map((entry) => ({
      value: entry.entryKey,
      label: `${(entry.applicable ?? entry.versions.at(-1)!).officialLabel} (${entry.code})`,
    }));
  if (draft.paymentMethod && !methodOptions.some((m) => m.value === draft.paymentMethod)) {
    methodOptions.push({
      value: draft.paymentMethod,
      label: `Forma de pago ${draft.paymentMethod} (no disponible)`,
    });
  }

  const preview = draft.preview;
  const treatments = preview.taxTreatments;
  const fresh = !isDirty;
  const issues = preview.issues;
  const conceptIssues = (position: number) => issues.filter((issue) => issue.concept === position);
  const generalIssues = issues.filter((issue) => issue.concept === null);
  const environment = status.data ? ENVIRONMENT_LABELS[status.data.environment] : null;
  const emitBlocked = isDirty || issues.length > 0 || save.isPending;
  const emitHintId = useId();
  const emitHint = isDirty
    ? "Guarda los cambios antes de emitir."
    : issues.length > 0
      ? "Resuelve los problemas antes de emitir."
      : undefined;
  const declared = DEBIT_NOTE_ELIGIBILITY_DECLARATION.statements.every((statement) =>
    statements.includes(statement.id),
  );

  const onSave = form.handleSubmit((formValues) => {
    setOperationError(undefined);
    save.mutate({
      id: draft.id,
      input: { ...toInput(formValues), expectedVersion: draft.version },
    });
  });

  const addConcept = () => {
    concepts.append(blankConcept(), {
      focusName: `concepts.${concepts.fields.length}.description`,
    });
  };
  const removeConcept = (index: number) => {
    concepts.remove(index);
    addRef.current?.focus();
  };

  const recovery =
    operationError?.code === "DEBIT_NOTE_DRAFT_CHANGED" ? (
      <Button variant="outline" onClick={refresh}>
        Recargar borrador
      </Button>
    ) : operationError?.code === "DEBIT_NOTE_DRAFT_ALREADY_EMITTED" ? (
      <Button asChild variant="outline">
        <Link href="/notas-debito">Ver notas de débito</Link>
      </Button>
    ) : undefined;

  return (
    <section aria-labelledby="editor-titulo" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Link
          href="/notas-debito"
          className="inline-flex items-center gap-0.5 self-start text-sm text-foreground-muted hover:text-foreground"
        >
          <ArrowLeft aria-hidden="true" className="size-2" />
          Notas de débito
        </Link>
        <h1 id="editor-titulo" className="text-3xl font-bold">
          Borrador de nota de débito
        </h1>
      </div>

      {operationError && (
        <OperationAlert message={operationError.message} action={recovery} alertRef={alertRef} />
      )}

      <form noValidate onSubmit={onSave} className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-3">
          <Section title="Factura que se modifica">
            <div className="flex min-w-0 items-center gap-1 rounded-md border border-border bg-surface px-1.5 py-1">
              <FileText aria-hidden="true" className="size-2 shrink-0 text-foreground-muted" />
              <span className="flex min-w-0 flex-col">
                <span className="font-medium tabular-nums">
                  Factura {draft.invoice.documentNumber}
                </span>
                <span className="text-sm text-foreground-muted break-words">
                  {draft.invoice.buyerName} · {draft.invoice.buyerIdentification} ·{" "}
                  {formatIssueDate(draft.invoice.issueDate)} · Total{" "}
                  {formatUsd(draft.invoice.total)}
                </span>
                <span className="text-sm text-foreground-muted">
                  Tratamientos de IVA de la factura:{" "}
                  {treatments.map((treatment) => treatment.label).join(", ")}
                </span>
              </span>
            </div>
          </Section>

          <Section title="Conceptos">
            <p className="text-sm text-foreground-muted">
              Cada concepto es un cobro posterior a la factura: intereses de mora o un costo o gasto
              posterior a ella, con el tratamiento de IVA de la factura que le corresponde.
            </p>
            <ol className="flex flex-col gap-1.5">
              {concepts.fields.map((field, index) => {
                const position = index + 1;
                const current = values[index];
                const conceptError = errors.concepts?.[index];
                const problems = fresh ? conceptIssues(position) : [];
                const causeLabelId = `causa-${field.id}`;
                return (
                  <li
                    key={field.id}
                    aria-label={`Concepto ${position}`}
                    aria-invalid={problems.length > 0 || undefined}
                    className="flex flex-col gap-1 rounded-md border border-border bg-surface px-1.5 py-1 aria-invalid:border-danger"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <h3 className="font-medium">Concepto {position}</h3>
                      {concepts.fields.length > 1 && (
                        <RowActionButton
                          icon={Trash2}
                          label={`Quitar el concepto ${position}`}
                          onClick={() => removeConcept(index)}
                        />
                      )}
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span id={causeLabelId} className="text-sm font-medium">
                        Causa
                      </span>
                      <SegmentedControl
                        aria-labelledby={causeLabelId}
                        options={DEBIT_NOTE_CAUSES.map((cause) => ({
                          value: cause,
                          label: DEBIT_NOTE_CAUSE_LABELS[cause],
                        }))}
                        value={current?.cause || undefined}
                        onChange={(next) =>
                          form.setValue(`concepts.${index}.cause`, next, { shouldDirty: true })
                        }
                      />
                    </div>
                    <FormField
                      id={`descripcion-${field.id}`}
                      label="Descripción"
                      hint="Aparece en la nota de débito. Una sola línea."
                      error={conceptError?.description?.message}
                    >
                      <Input
                        maxLength={DEBIT_NOTE_DESCRIPTION_MAX}
                        {...fieldAria(
                          `descripcion-${field.id}`,
                          conceptError?.description?.message,
                          "Aparece en la nota de débito. Una sola línea.",
                        )}
                        {...form.register(`concepts.${index}.description`)}
                      />
                    </FormField>
                    <div className="grid gap-1 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
                      <FormField
                        id={`importe-${field.id}`}
                        label="Importe"
                        hint="Sin IVA, en dólares."
                        error={conceptError?.amount?.message}
                      >
                        <Input
                          inputMode="decimal"
                          {...fieldAria(
                            `importe-${field.id}`,
                            conceptError?.amount?.message,
                            "Sin IVA, en dólares.",
                          )}
                          {...form.register(`concepts.${index}.amount`)}
                        />
                      </FormField>
                      <TreatmentField
                        position={position}
                        treatments={treatments}
                        value={current?.taxTreatment ?? ""}
                        onChange={(next) =>
                          form.setValue(`concepts.${index}.taxTreatment`, next, {
                            shouldDirty: true,
                          })
                        }
                      />
                    </div>
                    <IssueList issues={problems} />
                  </li>
                );
              })}
            </ol>
            <Button
              ref={addRef}
              variant="outline"
              className="self-start"
              disabled={concepts.fields.length >= DEBIT_NOTE_CONCEPTS_MAX}
              onClick={addConcept}
            >
              <Plus aria-hidden="true" />
              Agregar concepto
            </Button>
          </Section>

          <Section title="Forma de pago y punto de emisión">
            <FormField
              id="forma-pago"
              label="Forma de pago"
              hint="Una sola forma de pago, por el valor total de la nota."
            >
              <Select
                {...fieldAria(
                  "forma-pago",
                  undefined,
                  "Una sola forma de pago, por el valor total de la nota.",
                )}
                value={paymentMethod}
                onChange={(event) =>
                  form.setValue("paymentMethod", event.target.value, { shouldDirty: true })
                }
              >
                <option value="">Elige la forma de pago</option>
                {methodOptions.map((method) => (
                  <option key={method.value} value={method.value}>
                    {method.label}
                  </option>
                ))}
              </Select>
            </FormField>
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
                Guarda el borrador para calcular los importes con los tratamientos de la factura.
              </p>
            ) : preview.totals ? (
              <dl className="grid grid-cols-[1fr_auto] gap-x-2 gap-y-0.5 text-sm tabular-nums">
                <dt>Subtotal sin impuestos</dt>
                <dd className="text-right">{formatUsd(preview.totals.withoutTaxes)}</dd>
                {preview.totals.taxes.map((tax) => (
                  <div key={tax.key} className="contents">
                    <dt>Base {tax.label}</dt>
                    <dd className="text-right">{formatUsd(tax.base)}</dd>
                    <dt>{tax.label}</dt>
                    <dd className="text-right">{formatUsd(tax.amount)}</dd>
                  </div>
                ))}
                <dt className="font-semibold">Valor total</dt>
                <dd className="text-right font-semibold">{formatUsd(preview.totals.total)}</dd>
              </dl>
            ) : (
              <p className="text-sm text-foreground-muted">
                Los importes aparecen cuando la nota se puede calcular.
              </p>
            )}
            {fresh && preview.payment && (
              <p className="text-sm">
                Forma de pago: {preview.payment.label} ·{" "}
                <span className="tabular-nums">{formatUsd(preview.payment.amount)}</span>
              </p>
            )}
            {fresh && (
              <p className="text-xs text-foreground-muted">
                Vista previa del {formatIssueDate(preview.evaluatedOn)}, sin validez fiscal. No
                reserva nada: la emisión vuelve a comprobar la factura y la forma de pago.
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
                Emitir nota de débito
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
          if (!open) setStatements([]);
        }}
        title="Emitir nota de débito"
        confirmLabel="Emitir nota de débito"
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
              La emisión reserva el número de la nota y la firma; no se puede deshacer. La factura
              no cambia.
            </p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-foreground">
              <dt className="text-foreground-muted">Ambiente</dt>
              <dd>{environment ?? "Desconocido"}</dd>
              <dt className="text-foreground-muted">Factura</dt>
              <dd className="tabular-nums">{draft.invoice.documentNumber}</dd>
              <dt className="text-foreground-muted">Valor total</dt>
              <dd className="tabular-nums">
                {preview.totals ? formatUsd(preview.totals.total) : "—"}
              </dd>
              <dt className="text-foreground-muted">Forma de pago</dt>
              <dd>{preview.payment?.label ?? "—"}</dd>
            </dl>
          </div>
        }
      >
        <Declaration checked={statements} onChange={setStatements} />
      </ConfirmDialog>
    </section>
  );
}

function Header({ title }: { title: string }) {
  return (
    <div className="flex flex-col gap-1">
      <Link
        href="/notas-debito"
        className="inline-flex items-center gap-0.5 self-start text-sm text-foreground-muted hover:text-foreground"
      >
        <ArrowLeft aria-hidden="true" className="size-2" />
        Notas de débito
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

/** La factura que llega desde su detalle (`?factura={id}`), para confirmarla antes de preparar. */
function ChosenInvoice({
  invoiceId,
  pending,
  onPrepare,
  onChooseOther,
}: {
  invoiceId: string;
  pending: boolean;
  onPrepare: () => void;
  onChooseOther: () => void;
}) {
  const invoice = useInvoice(invoiceId, true);
  if (invoice.isPending) return <Skeleton className="h-8 w-full" />;
  if (invoice.isError) {
    const missing = invoice.error instanceof ApiError && invoice.error.status === 404;
    return missing ? (
      <EmptyState
        kind="empty"
        title="La factura no existe"
        description="Elige otra factura para la nota de débito."
        action={
          <Button variant="outline" onClick={onChooseOther}>
            Elegir otra factura
          </Button>
        }
      />
    ) : (
      <ErrorState message="No pudimos cargar la factura." onRetry={() => void invoice.refetch()} />
    );
  }
  const data = invoice.data;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex min-w-0 items-center gap-1 rounded-md border border-border bg-surface px-1.5 py-1">
        <FileText aria-hidden="true" className="size-2 shrink-0 text-foreground-muted" />
        <span className="flex min-w-0 flex-col">
          <span className="font-medium tabular-nums">Factura {data.documentNumber}</span>
          <span className="text-sm text-foreground-muted break-words">
            {data.buyer.legalName} · {formatIssueDate(data.issueDate)} · Total{" "}
            {formatUsd(data.totals.total)}
          </span>
        </span>
      </div>
      <div className="flex flex-wrap gap-1">
        <AsyncButton pending={pending} onClick={onPrepare}>
          Preparar nota de débito
        </AsyncButton>
        <Button variant="outline" onClick={onChooseOther}>
          Elegir otra factura
        </Button>
      </div>
    </div>
  );
}

/**
 * Nueva nota de débito: elegir la factura crea el borrador, porque los tratamientos que se ofrecen
 * son los de la factura y los devuelve la vista previa del servidor; el editor sigue en su ruta.
 */
export function NewDebitNoteDraftScreen({ invoiceId = null }: { invoiceId?: string | null }) {
  const { me } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const allowed = canSee(me.role, "debitNotes.draft");
  const [chosen, setChosen] = useState<string | null>(invoiceId);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string>();
  const alertRef = useRef<HTMLDivElement>(null);
  const create = useSaveDebitNoteDraft({
    success: "Preparaste el borrador de la nota de débito.",
    onSuccess: (draft) => {
      queryClient.setQueryData([...DEBIT_NOTE_DRAFTS_KEY, "detail", draft.id], draft);
      router.replace(`/notas-debito/borradores/${draft.id}`);
    },
    onError: (failure) => {
      setError(errorMessage(failure, DEBIT_NOTE_CONFLICT_MESSAGES));
      return true;
    },
  });
  useEffect(() => {
    if (error) alertRef.current?.focus();
  }, [error]);
  const prepare = (id: string) => {
    setError(undefined);
    create.mutate({ id: null, input: { invoiceId: id } });
  };

  if (!allowed) {
    return (
      <Fallback title="Nueva nota de débito">
        <EmptyState
          kind="no-permission"
          title="No tienes acceso a los borradores de notas de débito"
          description="Pide a un administrador que revise tu rol."
        />
      </Fallback>
    );
  }
  return (
    <Fallback title="Nueva nota de débito">
      {error && <OperationAlert message={error} alertRef={alertRef} />}
      <Section title="Factura que se modifica">
        {chosen ? (
          <ChosenInvoice
            invoiceId={chosen}
            pending={create.isPending}
            onPrepare={() => prepare(chosen)}
            onChooseOther={() => {
              setChosen(null);
              setPicking(true);
            }}
          />
        ) : (
          <>
            <p className="text-sm text-foreground-muted">
              Elige una factura autorizada, identificada y del ambiente vigente. Sus tratamientos de
              IVA son los únicos que la nota puede usar.
            </p>
            <AsyncButton
              className="self-start"
              pending={create.isPending}
              onClick={() => setPicking(true)}
            >
              Elegir factura
            </AsyncButton>
          </>
        )}
      </Section>
      <EntityPickerDialog<DebitEligibleInvoiceView>
        open={picking}
        onOpenChange={setPicking}
        title="Elegir factura"
        searchLabel="Buscar por número o comprador"
        searchPlaceholder="Número o comprador"
        queryKey={[...DEBIT_NOTES_KEY, "eligible-invoices"]}
        fetchPage={fetchDebitEligibleInvoices}
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
            <span className="text-sm tabular-nums">{formatUsd(invoice.total)}</span>
          </span>
        )}
        onSelect={(invoice) => prepare(invoice.id)}
        emptyTitle="No hay facturas elegibles"
        emptyDescription="Una nota de débito modifica una factura autorizada, identificada y del ambiente vigente."
      />
    </Fallback>
  );
}

/** Editor de un borrador guardado. */
export function DebitNoteDraftScreen({ draftId }: { draftId: string }) {
  const { me } = useSession();
  const allowed = canSee(me.role, "debitNotes.draft");
  const canEmit = canSee(me.role, "debitNotes.emit");
  const draft = useDebitNoteDraft(draftId, allowed);

  if (!allowed) {
    return (
      <Fallback title="Borrador de nota de débito">
        <EmptyState
          kind="no-permission"
          title="No tienes acceso a los borradores de notas de débito"
          description="Pide a un administrador que revise tu rol."
        />
      </Fallback>
    );
  }
  if (draft.isPending) return <DebitNoteDraftSkeleton />;
  if (draft.isError) {
    const error = draft.error;
    const emitted = error instanceof ApiError && error.code === "DEBIT_NOTE_DRAFT_ALREADY_EMITTED";
    const missing = error instanceof ApiError && error.status === 404;
    return (
      <Fallback title="Borrador de nota de débito">
        {emitted || missing ? (
          <EmptyState
            kind="empty"
            title={emitted ? "Este borrador ya se emitió" : "El borrador no existe"}
            description={
              emitted
                ? "Encuéntralo en Notas de débito: un borrador emitido ya no se corrige."
                : "Puede que se haya eliminado."
            }
            action={
              <Button asChild variant="outline">
                <Link href="/notas-debito">Ver notas de débito</Link>
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
  const data = draft.data;
  return <DraftEditor key={`${data.id}-${data.version}`} draft={data} canEmit={canEmit} />;
}

export function DebitNoteDraftSkeleton() {
  return (
    <section aria-busy="true" className="flex flex-col gap-3">
      <h1 className="text-3xl font-bold">Borrador de nota de débito</h1>
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-24 w-full" />
    </section>
  );
}
