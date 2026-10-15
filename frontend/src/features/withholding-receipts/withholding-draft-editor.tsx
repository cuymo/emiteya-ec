// Borrador de retención a página completa (add-withholding-receipts, design D24): flujo de riesgo
// (frontend-checklist.md). Usuario: administrador u operador con `withholdings.draft`. Objetivo:
// acreditar las retenciones de un pago sin equivocar el concepto ni el porcentaje. Decisiones: el
// proveedor, la parte relacionada, el período, los documentos y el concepto y la base de cada
// retención. Información mínima: el proveedor, el período, los documentos con sus retenciones, los
// porcentajes y valores del servidor, el total retenido y los problemas. Acción principal: "Emitir
// retención"; secundaria: "Guardar borrador". P0: retenciones con concepto, base, porcentaje y valor,
// y los problemas que bloquean; P1: proveedor, período y total retenido; P2: datos de cada documento
// y el punto; P3 (identificadores, versiones y entryKey): no se muestran. El frontend no calcula
// dinero: los porcentajes, los valores retenidos, el total y los problemas son la vista previa del
// servidor del borrador guardado.
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  defaultEmissionPointViewSchema,
  type PartyRole,
  type PartyView,
  type WithholdingDraftView,
  type WithholdingIssue,
  type WithholdingOptionsView,
  type WithholdingSupplierView,
} from "@facturador/contracts";
import { Plus, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useFieldArray, useForm, useWatch, type Resolver } from "react-hook-form";
import { AsyncButton } from "@/components/async-button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EntityPickerDialog } from "@/components/entity-picker-dialog";
import { errorMessage } from "@/components/feedback";
import { fieldAria, FormField } from "@/components/form-dialog";
import { SegmentedControl } from "@/components/segmented-control";
import { useSession } from "@/components/session";
import { EmptyState, ErrorState, Skeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { ApiError, apiFetch } from "@/lib/api";
import { formatUsd } from "@/lib/decimal";
import { canSee } from "@/lib/permissions";
import { ENVIRONMENT_LABELS, useCompanyStatus } from "@/features/company/company-api";
import { EmissionEnvironmentNotice } from "@/features/company/emission-environment-notice";
import {
  DEFAULT_POINT_KEY,
  pointLabel,
  useEstablishments,
} from "@/features/establishments/establishments-api";
import { formatIssueDate } from "@/features/invoices/invoice-format";
import { PartyDialog } from "@/features/parties/party-dialog";
import {
  blankSupport,
  formSchema,
  toForm,
  toInput,
  type FormValues,
} from "./withholding-draft-form";
import {
  MONTH_NAMES,
  RELATED_PARTY_LABELS,
  formatPeriod,
  formatSupportNumber,
  periodParts,
} from "./withholding-format";
import {
  WITHHOLDINGS_KEY,
  WITHHOLDING_CONFLICT_MESSAGES,
  WITHHOLDING_DRAFTS_KEY,
  fetchWithholdingSuppliers,
  useEmitWithholding,
  useSaveWithholdingDraft,
  useWithholdingDraft,
  useWithholdingOptions,
} from "./withholding-receipts-api";
import { IssueList, SupportCard } from "./withholding-support-card";

/** Rol con que nace un tercero creado desde la retención: constante, para no reiniciar el diálogo. */
const SUPPLIER_ROLES: readonly PartyRole[] = ["SUPPLIER"];
/** Años que ofrece el período: el de emisión y los cuatro anteriores; nunca uno futuro. */
const PERIOD_YEARS = 5;

type Subject = Pick<WithholdingSupplierView, "id" | "legalName" | "identification">;

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
    <section aria-labelledby={id} className="flex flex-col gap-3">
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
      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm"
    >
      <p>{message}</p>
      {action}
    </div>
  );
}

function SubjectCard({ subject }: { subject: Subject }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-surface px-3 py-2">
      <UserRound aria-hidden="true" className="size-4 shrink-0 text-foreground-muted" />
      <span className="flex min-w-0 flex-col">
        <span className="font-medium break-words">{subject.legalName}</span>
        <span className="text-sm text-foreground-muted tabular-nums">{subject.identification}</span>
      </span>
    </div>
  );
}

/**
 * Elegir el proveedor (conjunto grande, con búsqueda) o registrar uno nuevo con el rol de proveedor.
 * El tercero nuevo vuelve elegido.
 */
function SupplierChooser({
  open,
  onOpenChange,
  onChoose,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChoose: (subject: Subject) => void;
}) {
  const [creating, setCreating] = useState(false);
  return (
    <>
      <EntityPickerDialog<WithholdingSupplierView>
        open={open}
        onOpenChange={onOpenChange}
        title="Elegir proveedor"
        description="Proveedores activos con RUC, cédula o pasaporte."
        searchLabel="Buscar por identificación o razón social"
        searchPlaceholder="Identificación o razón social"
        queryKey={[...WITHHOLDINGS_KEY, "suppliers"]}
        fetchPage={fetchWithholdingSuppliers}
        getKey={(supplier) => supplier.id}
        getLabel={(supplier) => `${supplier.legalName}, ${supplier.identification}`}
        renderItem={(supplier) => (
          <span className="flex min-w-0 flex-col">
            <span className="font-medium break-words">{supplier.legalName}</span>
            <span className="text-sm text-foreground-muted tabular-nums">
              {supplier.identification}
            </span>
          </span>
        )}
        onSelect={onChoose}
        quickOption={{
          label: "Nuevo proveedor",
          description: "Registrar un tercero con el rol de proveedor.",
          onSelect: () => setCreating(true),
        }}
        emptyTitle="No hay proveedores que coincidan"
        emptyDescription="Registra el proveedor o revisa que tenga el rol de proveedor en Terceros."
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
  draft: WithholdingDraftView;
  options: WithholdingOptionsView;
  canEmit: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [operationError, setOperationError] = useState<{ message: string; code?: string }>();
  const alertRef = useRef<HTMLDivElement>(null);
  /** La emisión acaba de fallar: al cerrar la confirmación, el foco va al aviso. */
  const emissionFailed = useRef(false);
  const summaryRef = useRef<HTMLHeadingElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [periodConfirmed, setPeriodConfirmed] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [subject, setSubject] = useState<Subject | null>(draft.party);
  // Una clave por versión del borrador (el editor se vuelve a montar con cada versión): un
  // reintento de la misma solicitud la repite y el servidor devuelve o retoma la misma retención.
  const idempotencyKey = useRef<string>("");
  const establishments = useEstablishments();
  const status = useCompanyStatus();
  const defaultPoint = useDefaultPoint(draft.emissionPoint === null);
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema) as unknown as Resolver<FormValues>,
    defaultValues: toForm(draft),
  });
  const { isDirty } = form.formState;
  const supports = useFieldArray({ control: form.control, name: "supports" });
  const relatedParty = useWatch({ control: form.control, name: "relatedParty" });
  const month = useWatch({ control: form.control, name: "month" });
  const year = useWatch({ control: form.control, name: "year" });
  const pointId = useWatch({ control: form.control, name: "emissionPointId" });

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
      message: errorMessage(error, WITHHOLDING_CONFLICT_MESSAGES),
      ...(error instanceof ApiError ? { code: error.code } : {}),
    });
    return true;
  };
  const refresh = () => {
    setOperationError(undefined);
    void queryClient.invalidateQueries({
      queryKey: [...WITHHOLDING_DRAFTS_KEY, "detail", draft.id],
    });
    void queryClient.invalidateQueries({ queryKey: WITHHOLDINGS_KEY });
  };
  const save = useSaveWithholdingDraft({
    onSuccess: (saved) => {
      setOperationError(undefined);
      focusAfterSave.summary = true;
      queryClient.setQueryData([...WITHHOLDING_DRAFTS_KEY, "detail", saved.id], saved);
    },
    onError: fail,
  });
  const emit = useEmitWithholding({
    onSuccess: (receipt) => router.push(`/retenciones/${receipt.id}`),
    onError: (error) => {
      emissionFailed.current = true;
      setConfirming(false);
      setPeriodConfirmed(false);
      // El proveedor, el catálogo o el borrador cambiaron: la vista previa se vuelve a pedir. Un
      // borrador cambiado se recarga a pedido, porque la versión nueva vuelve a montar el editor.
      if (
        error instanceof ApiError &&
        error.status === 409 &&
        error.code !== "WITHHOLDING_DRAFT_CHANGED"
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

  const preview = draft.preview;
  const fresh = !isDirty;
  const issues = preview.issues;
  const supportIssues = (position: number) =>
    issues.filter((issue: WithholdingIssue) => issue.support === position);
  const generalIssues = issues.filter((issue) => issue.support === null);
  const environment = status.data ? ENVIRONMENT_LABELS[status.data.environment] : null;
  const emitBlocked = isDirty || issues.length > 0 || save.isPending;
  const emitHintId = useId();
  const relatedLabelId = useId();
  const emitHint = isDirty
    ? "Guarda los cambios antes de emitir."
    : issues.length > 0
      ? "Resuelve los problemas antes de emitir."
      : undefined;
  const issueMonth = periodParts(preview.issueMonth);
  const chosenPeriod = month && year ? `${month}/${year}` : null;
  // Aviso inmediato al cambiar el período; al emitir manda la vista previa guardada.
  const periodDiffers = chosenPeriod !== null && chosenPeriod !== preview.issueMonth;
  const years = Array.from({ length: PERIOD_YEARS }, (_, offset) =>
    String(Number(issueMonth.year || new Date().getFullYear()) - offset),
  );
  const savedPeriod = draft.fiscalPeriod;
  const confirmPeriod = preview.periodDiffersFromIssueMonth;

  const onSave = form.handleSubmit((formValues) => {
    setOperationError(undefined);
    save.mutate({
      id: draft.id,
      input: { ...toInput(formValues), expectedVersion: draft.version },
    });
  });

  const addSupport = () => {
    supports.append(blankSupport(), {
      focusName: `supports.${supports.fields.length}.authorizationNumber`,
    });
  };
  const removeSupport = (index: number) => {
    supports.remove(index);
    addRef.current?.focus();
  };

  const recovery =
    operationError?.code === "WITHHOLDING_DRAFT_CHANGED" ? (
      <Button variant="outline" onClick={refresh}>
        Recargar borrador
      </Button>
    ) : operationError?.code === "WITHHOLDING_DRAFT_ALREADY_EMITTED" ? (
      <Button asChild variant="outline">
        <Link href="/retenciones">Ver retenciones</Link>
      </Button>
    ) : undefined;

  return (
    <section aria-labelledby="editor-titulo" className="flex flex-col gap-6">
      <Header title="Borrador de retención" />

      {operationError && (
        <OperationAlert message={operationError.message} action={recovery} alertRef={alertRef} />
      )}

      <form noValidate onSubmit={onSave} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <Section title="Proveedor">
            {subject ? (
              <SubjectCard subject={subject} />
            ) : (
              <p className="text-sm text-foreground-muted">Elige el proveedor retenido.</p>
            )}
            <Button variant="outline" className="self-start" onClick={() => setChoosing(true)}>
              {subject ? "Cambiar proveedor" : "Elegir proveedor"}
            </Button>
            <SupplierChooser
              open={choosing}
              onOpenChange={setChoosing}
              onChoose={(chosen) => {
                setSubject(chosen);
                form.setValue("partyId", chosen.id, { shouldDirty: true });
              }}
            />
          </Section>

          <Section title="Parte relacionada">
            <div className="flex flex-col gap-1">
              <span id={relatedLabelId} className="text-sm font-medium">
                ¿El proveedor es parte relacionada?
              </span>
              <SegmentedControl
                aria-labelledby={relatedLabelId}
                aria-describedby={`${relatedLabelId}-hint`}
                options={[
                  { value: "SI", label: RELATED_PARTY_LABELS.SI },
                  { value: "NO", label: RELATED_PARTY_LABELS.NO },
                ]}
                value={relatedParty || undefined}
                onChange={(next) => form.setValue("relatedParty", next, { shouldDirty: true })}
              />
              <p id={`${relatedLabelId}-hint`} className="text-xs text-foreground-muted">
                Es una declaración tuya: el sistema no puede comprobarla.
              </p>
            </div>
          </Section>

          <Section title="Período fiscal">
            <div className="grid gap-2 sm:grid-cols-2">
              <FormField id="periodo-mes" label="Mes">
                <Select
                  {...fieldAria("periodo-mes", undefined)}
                  value={month}
                  onChange={(event) =>
                    form.setValue("month", event.target.value, { shouldDirty: true })
                  }
                >
                  <option value="">Elige el mes</option>
                  {MONTH_NAMES.map((name, index) => {
                    const value = String(index + 1).padStart(2, "0");
                    return (
                      <option key={value} value={value}>
                        {name}
                      </option>
                    );
                  })}
                </Select>
              </FormField>
              <FormField id="periodo-anio" label="Año">
                <Select
                  {...fieldAria("periodo-anio", undefined)}
                  value={year}
                  onChange={(event) =>
                    form.setValue("year", event.target.value, { shouldDirty: true })
                  }
                >
                  <option value="">Elige el año</option>
                  {years.map((candidate) => (
                    <option key={candidate} value={candidate}>
                      {candidate}
                    </option>
                  ))}
                  {year && !years.includes(year) && <option value={year}>{year}</option>}
                </Select>
              </FormField>
            </div>
            {periodDiffers && (
              <p
                role="status"
                className="rounded-md border border-warning/40 bg-warning/10 px-2 py-1 text-sm"
              >
                El período ({formatPeriod(chosenPeriod)}) es distinto del mes de emisión (
                {formatPeriod(preview.issueMonth)}). Puedes emitirlo, pero tendrás que confirmarlo.
              </p>
            )}
          </Section>

          <Section title="Documentos sustento">
            <p className="text-sm text-foreground-muted">
              Cada documento es una factura o nota de venta del proveedor, o una liquidación de
              compra que la empresa emitió en los casos que la normativa permite, con las
              retenciones que le hiciste. Los documentos son declaraciones tuyas: el sistema no los
              busca ni los modifica.
            </p>
            <ol className="flex flex-col gap-3">
              {supports.fields.map((field, index) => (
                <SupportCard
                  key={field.id}
                  form={form}
                  index={index}
                  options={options}
                  preview={preview}
                  issues={fresh ? supportIssues(index + 1) : []}
                  fresh={fresh}
                  canRemove={supports.fields.length > 1}
                  onRemove={() => removeSupport(index)}
                />
              ))}
            </ol>
            <Button
              ref={addRef}
              variant="outline"
              className="self-start"
              disabled={supports.fields.length >= options.limits.supports}
              onClick={addSupport}
            >
              <Plus aria-hidden="true" />
              Agregar documento sustento
            </Button>
            {supports.fields.length >= options.limits.supports && (
              <p className="text-xs text-foreground-muted">
                Llegaste al máximo de {options.limits.supports} documentos por retención, un límite
                del sistema (no del SRI).
              </p>
            )}
          </Section>

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
        </div>

        <aside
          aria-labelledby="resumen-titulo"
          className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start"
        >
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
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
                Guarda el borrador para calcular las retenciones con los porcentajes oficiales.
              </p>
            ) : (
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm tabular-nums">
                {preview.supports.flatMap((support) =>
                  support.withholdings.map((item) => (
                    <div key={`${support.position}-${item.position}`} className="contents">
                      <dt className="break-words">
                        Documento {support.position} · {item.code}
                      </dt>
                      <dd className="text-right">{formatUsd(item.amount)}</dd>
                    </div>
                  )),
                )}
                <dt className="font-semibold">Total retenido</dt>
                <dd className="text-right font-semibold">
                  {preview.totals ? formatUsd(preview.totals.withheld) : "Sin calcular"}
                </dd>
              </dl>
            )}
            {fresh && (
              <p className="text-xs text-foreground-muted">
                Vista previa del {formatIssueDate(preview.evaluatedOn)}, sin validez fiscal. No
                reserva nada: la emisión vuelve a comprobar el proveedor y los catálogos.
              </p>
            )}
            {fresh && generalIssues.length > 0 && (
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-semibold">Antes de emitir</h3>
                <IssueList issues={generalIssues} />
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2">
            {/* Aviso del ambiente junto a la acción que decide (design D21). */}
            {canEmit && <EmissionEnvironmentNotice document="retención" />}
            {canEmit && (
              <Button
                disabled={emitBlocked}
                aria-describedby={emitHint ? emitHintId : undefined}
                onClick={() => {
                  idempotencyKey.current ||= crypto.randomUUID();
                  setConfirming(true);
                }}
              >
                Emitir retención
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
          if (!open) setPeriodConfirmed(false);
        }}
        title="Emitir retención"
        confirmLabel="Emitir retención"
        pending={emit.isPending}
        confirmBlocked={confirmPeriod && !periodConfirmed}
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
          })
        }
        description={
          <div className="flex flex-col gap-2">
            <p>La emisión reserva el número de la retención y la firma; no se puede deshacer.</p>
            {/* En pantallas angostas, cada dato bajo su nombre: los números no se parten. */}
            <dl className="grid grid-cols-1 gap-x-4 text-foreground sm:grid-cols-[auto_1fr] sm:gap-y-1">
              <dt className="text-foreground-muted">Ambiente</dt>
              <dd className="max-sm:mb-1">{environment ?? "Desconocido"}</dd>
              <dt className="text-foreground-muted">Proveedor</dt>
              <dd className="break-words max-sm:mb-1">{draft.party?.legalName ?? "—"}</dd>
              <dt className="text-foreground-muted">Período fiscal</dt>
              <dd className={confirmPeriod ? "font-semibold max-sm:mb-1" : "max-sm:mb-1"}>
                {formatPeriod(savedPeriod)}
              </dd>
              <dt className="text-foreground-muted">Parte relacionada</dt>
              <dd className="max-sm:mb-1">
                {draft.relatedParty ? RELATED_PARTY_LABELS[draft.relatedParty] : "—"}
              </dd>
              <dt className="text-foreground-muted">Documentos</dt>
              <dd className="max-sm:mb-1">
                <ul>
                  {draft.supports.map((support, index) => (
                    <li key={index} className="whitespace-nowrap tabular-nums">
                      {formatSupportNumber(support.number)}
                    </li>
                  ))}
                </ul>
              </dd>
              <dt className="text-foreground-muted">Total retenido</dt>
              <dd className="tabular-nums">
                {preview.totals ? formatUsd(preview.totals.withheld) : "—"}
              </dd>
            </dl>
            <EmissionEnvironmentNotice document="retención" />
          </div>
        }
      >
        {confirmPeriod && (
          <label className="mt-2 flex min-h-11 items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-2 py-1 text-sm">
            <input
              type="checkbox"
              className="mt-1 size-5 shrink-0 accent-primary"
              checked={periodConfirmed}
              onChange={(event) => setPeriodConfirmed(event.target.checked)}
            />
            <span>
              Confirmo el período {formatPeriod(savedPeriod)}, distinto del mes de emisión (
              {formatPeriod(preview.issueMonth)}).
            </span>
          </label>
        )}
      </ConfirmDialog>
    </section>
  );
}

function Header({ title }: { title: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 id="editor-titulo" className="text-3xl font-bold">
        {title}
      </h1>
    </div>
  );
}

function Fallback({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-labelledby="editor-titulo" className="flex flex-col gap-6">
      <Header title={title} />
      {children}
    </section>
  );
}

/**
 * Nueva retención: elegir el proveedor (o registrarlo) crea el borrador con el período del mes de
 * hoy, y el editor sigue en su ruta.
 */
export function NewWithholdingDraftScreen() {
  const { me } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const allowed = canSee(me.role, "withholdings.draft");
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState<string>();
  const alertRef = useRef<HTMLDivElement>(null);
  const create = useSaveWithholdingDraft({
    success: "Preparaste el borrador de la retención.",
    onSuccess: (draft) => {
      queryClient.setQueryData([...WITHHOLDING_DRAFTS_KEY, "detail", draft.id], draft);
      router.replace(`/retenciones/borradores/${draft.id}`);
    },
    onError: (failure) => {
      setError(errorMessage(failure, WITHHOLDING_CONFLICT_MESSAGES));
      return true;
    },
  });
  useEffect(() => {
    if (error) alertRef.current?.focus();
  }, [error]);

  if (!allowed) {
    return (
      <Fallback title="Nueva retención">
        <EmptyState
          kind="no-permission"
          title="No tienes acceso a los borradores de retenciones"
          description="Pide a un administrador que revise tu rol."
        />
      </Fallback>
    );
  }
  return (
    <Fallback title="Nueva retención">
      {error && <OperationAlert message={error} alertRef={alertRef} />}
      <Section title="Proveedor">
        <p className="text-sm text-foreground-muted">
          Elige el proveedor al que retuviste, o regístralo. Debe estar activo y tener RUC, cédula o
          pasaporte.
        </p>
        <AsyncButton
          className="self-start"
          pending={create.isPending}
          onClick={() => setChoosing(true)}
        >
          Elegir proveedor
        </AsyncButton>
      </Section>
      <SupplierChooser
        open={choosing}
        onOpenChange={setChoosing}
        onChoose={(subject) => {
          setError(undefined);
          create.mutate({ id: null, input: { partyId: subject.id } });
        }}
      />
    </Fallback>
  );
}

/** Editor de un borrador guardado, con las opciones utilizables. */
export function WithholdingDraftScreen({ draftId }: { draftId: string }) {
  const { me } = useSession();
  const allowed = canSee(me.role, "withholdings.draft");
  const canEmit = canSee(me.role, "withholdings.emit");
  const draft = useWithholdingDraft(draftId, allowed);
  const options = useWithholdingOptions(allowed);

  if (!allowed) {
    return (
      <Fallback title="Borrador de retención">
        <EmptyState
          kind="no-permission"
          title="No tienes acceso a los borradores de retenciones"
          description="Pide a un administrador que revise tu rol."
        />
      </Fallback>
    );
  }
  if (draft.isPending || options.isPending) return <WithholdingDraftSkeleton />;
  if (draft.isError) {
    const error = draft.error;
    const emitted = error instanceof ApiError && error.code === "WITHHOLDING_DRAFT_ALREADY_EMITTED";
    const missing = error instanceof ApiError && error.status === 404;
    return (
      <Fallback title="Borrador de retención">
        {emitted || missing ? (
          <EmptyState
            kind="empty"
            title={emitted ? "Este borrador ya se emitió" : "El borrador no existe"}
            description={
              emitted
                ? "Encuéntralo en Retenciones: un borrador emitido ya no se corrige."
                : "Puede que se haya eliminado."
            }
            action={
              <Button asChild variant="outline">
                <Link href="/retenciones">Ver retenciones</Link>
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
      <Fallback title="Borrador de retención">
        <ErrorState
          message="No pudimos cargar los conceptos y códigos de retención."
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

export function WithholdingDraftSkeleton() {
  return (
    <section aria-busy="true" className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold">Borrador de retención</h1>
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-48 w-full" />
    </section>
  );
}
