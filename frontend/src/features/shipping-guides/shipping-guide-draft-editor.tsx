// Borrador de guía de remisión a página completa (add-shipping-guides, design D25): flujo de riesgo
// (frontend-checklist.md). Usuario: administrador u operador con `shippingGuides.draft`. Objetivo:
// documentar un traslado antes de que salga la mercadería, sin equivocar el destinatario, el sustento
// ni las fechas. Decisiones: el transportista, la placa, las fechas, los destinatarios, el sustento de
// cada uno y lo que se traslada. Información mínima: transportista, placa, fechas, partida, cada
// destinatario con su sustento y su detalle, y los problemas. Acción principal: "Emitir guía de
// remisión"; secundaria: "Guardar borrador". P0: destinatarios con su sustento y su detalle, y los
// problemas que bloquean; P1: transportista, placa y fechas; P2: partida, punto, ruta y código de
// destino; P3 (identificadores y versiones): no se muestran. Los problemas, la partida derivada y la
// identidad de cada destinatario son la vista previa del servidor del borrador guardado.
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  defaultEmissionPointViewSchema,
  type PartyRole,
  type PartyView,
  type ShippingCarrierView,
  type ShippingGuideDraftView,
  type ShippingGuideOptionsView,
} from "@facturador/contracts";
import { Plus, Truck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useFieldArray, useForm, useWatch, type Resolver } from "react-hook-form";
import { AsyncButton } from "@/components/async-button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DatePickerField } from "@/components/date-picker-field";
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
  blankRecipient,
  formSchema,
  toForm,
  toInput,
  type FormValues,
} from "./shipping-guide-draft-form";
import { detailCountLabel, recipientCountLabel } from "./shipping-guide-format";
import { IssueList, RecipientCard } from "./shipping-guide-recipient-card";
import {
  SHIPPING_GUIDES_KEY,
  SHIPPING_GUIDE_CONFLICT_MESSAGES,
  SHIPPING_GUIDE_DRAFTS_KEY,
  fetchShippingCarriers,
  useEmitShippingGuide,
  useSaveShippingGuideDraft,
  useShippingGuideDraft,
  useShippingGuideOptions,
} from "./shipping-guides-api";

/** Rol con que nace un transportista creado desde la guía: marcado y visible, nunca en silencio. */
const CARRIER_ROLES: readonly PartyRole[] = ["CARRIER"];
const DECLARATION =
  "Declaro que los traslados sin factura corresponden a los casos indicados del art. 30 del Reglamento de Comprobantes.";

type Carrier = Pick<ShippingCarrierView, "id" | "legalName" | "identification">;

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

/**
 * Elegir el transportista: terceros activos con el rol, los que no se pueden elegir deshabilitados
 * con su motivo; o registrar uno nuevo con el rol marcado. El tercero nuevo vuelve elegido.
 */
function CarrierChooser({
  open,
  onOpenChange,
  onChoose,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChoose: (carrier: Carrier) => void;
}) {
  const [creating, setCreating] = useState(false);
  return (
    <>
      <EntityPickerDialog<ShippingCarrierView>
        open={open}
        onOpenChange={onOpenChange}
        title="Elegir transportista"
        description="Terceros activos con el rol de transportista y RUC, cédula o pasaporte."
        searchLabel="Buscar por identificación o razón social"
        searchPlaceholder="Identificación o razón social"
        queryKey={[...SHIPPING_GUIDES_KEY, "carriers"]}
        fetchPage={fetchShippingCarriers}
        getKey={(carrier) => carrier.id}
        getLabel={(carrier) =>
          carrier.selectable
            ? `${carrier.legalName}, ${carrier.identification}`
            : `${carrier.legalName}, ${carrier.identification}, no se puede elegir`
        }
        isDisabled={(carrier) => !carrier.selectable}
        renderItem={(carrier) => (
          <span className="flex min-w-0 flex-col">
            <span className="font-medium break-words">{carrier.legalName}</span>
            <span className="text-sm text-foreground-muted tabular-nums">
              {carrier.identification}
            </span>
            {carrier.reason && <span className="text-xs text-danger">{carrier.reason}</span>}
          </span>
        )}
        onSelect={onChoose}
        quickOption={{
          label: "Nuevo transportista",
          description: "Registrar un tercero con el rol de transportista.",
          onSelect: () => setCreating(true),
        }}
        emptyTitle="No hay transportistas que coincidan"
        emptyDescription="Registra el transportista o agrégale el rol de transportista en Terceros."
      />
      <PartyDialog
        open={creating}
        party={null}
        initialRoles={CARRIER_ROLES}
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
  draft: ShippingGuideDraftView;
  options: ShippingGuideOptionsView;
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
  const [declared, setDeclared] = useState(false);
  const [choosing, setChoosing] = useState(false);
  // Una clave por versión del borrador (el editor se vuelve a montar con cada versión): un
  // reintento de la misma solicitud la repite y el servidor devuelve o retoma la misma guía.
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
  const recipients = useFieldArray({ control: form.control, name: "recipients" });
  const values = useWatch({ control: form.control });
  const transporterSource = values.transporterSource ?? "";
  const departureMode = values.departureMode ?? "FREE_TEXT";
  const originId = values.originEstablishmentId ?? "";
  const pointId = values.emissionPointId ?? "";

  /**
   * Con otra dirección vacía, la partida se propone con la del establecimiento del punto (design
   * D6); el usuario la corrige si sale de otro lugar. Nunca reemplaza una dirección escrita.
   */
  const proposeDeparture = useCallback(
    (point: string) => {
      const establishment = establishments.data?.find((candidate) =>
        candidate.emissionPoints.some((emissionPoint) => emissionPoint.id === point),
      );
      if (
        establishment &&
        form.getValues("departureMode") === "FREE_TEXT" &&
        !form.getValues("departureAddress").trim()
      ) {
        form.setValue("departureAddress", establishment.address, { shouldDirty: true });
      }
    },
    [establishments.data, form],
  );

  // Un borrador sin punto empieza en el punto predeterminado del usuario, si sigue disponible.
  useEffect(() => {
    const point = defaultPoint.data?.available ? defaultPoint.data.emissionPoint.id : undefined;
    if (point && !form.getValues("emissionPointId")) {
      form.setValue("emissionPointId", point, { shouldDirty: true });
      proposeDeparture(point);
    }
  }, [defaultPoint.data, form, proposeDeparture]);

  useEffect(() => {
    if (operationError) alertRef.current?.focus();
  }, [operationError]);

  useEffect(() => {
    if (focusAfterSave.summary) {
      focusAfterSave.summary = false;
      summaryRef.current?.focus();
    }
  }, []);

  const set = (name: Parameters<typeof form.setValue>[0], value: string) =>
    form.setValue(name, value, { shouldDirty: true });
  const fail = (error: unknown) => {
    setOperationError({
      message: errorMessage(error, SHIPPING_GUIDE_CONFLICT_MESSAGES),
      ...(error instanceof ApiError ? { code: error.code } : {}),
    });
    return true;
  };
  const refresh = () => {
    setOperationError(undefined);
    void queryClient.invalidateQueries({
      queryKey: [...SHIPPING_GUIDE_DRAFTS_KEY, "detail", draft.id],
    });
    void queryClient.invalidateQueries({ queryKey: SHIPPING_GUIDES_KEY });
  };
  const save = useSaveShippingGuideDraft({
    onSuccess: (saved) => {
      setOperationError(undefined);
      focusAfterSave.summary = true;
      queryClient.setQueryData([...SHIPPING_GUIDE_DRAFTS_KEY, "detail", saved.id], saved);
    },
    onError: fail,
  });
  const emit = useEmitShippingGuide({
    onSuccess: (guide) => router.push(`/guias-remision/${guide.id}`),
    onError: (error) => {
      emissionFailed.current = true;
      setConfirming(false);
      setDeclared(false);
      // Un tercero, una factura o el borrador cambiaron: la vista previa se vuelve a pedir. Un
      // borrador cambiado se recarga a pedido, porque la versión nueva vuelve a montar el editor.
      if (
        error instanceof ApiError &&
        error.status === 409 &&
        error.code !== "SHIPPING_GUIDE_DRAFT_CHANGED"
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
  const origin = options.establishments.find((establishment) => establishment.id === originId);

  const preview = draft.preview;
  const fresh = !isDirty;
  const issues = preview.issues;
  const recipientIssues = (position: number) =>
    issues.filter((issue) => issue.recipient === position);
  const generalIssues = issues.filter((issue) => issue.recipient === null);
  const environment = status.data ? ENVIRONMENT_LABELS[status.data.environment] : null;
  const emitBlocked = isDirty || issues.length > 0 || save.isPending;
  const emitHintId = useId();
  const sourceLabelId = useId();
  const departureLabelId = useId();
  const emitHint = isDirty
    ? "Guarda los cambios antes de emitir."
    : issues.length > 0
      ? "Resuelve los problemas antes de emitir."
      : undefined;
  const declarationRequired = preview.exceptionDeclarationRequired;
  const exceptions = draft.recipients.flatMap((recipient, index) => {
    const support = recipient.support;
    if (support?.kind !== "DECLARED_EXCEPTION") return [];
    return [
      {
        position: index + 1,
        policy: options.exceptionPolicy.cases.find((item) => item.case === support.case),
      },
    ];
  });
  const { limits } = options;
  const totalDetails = (values.recipients ?? []).reduce(
    (sum, recipient) => sum + (recipient.details?.length ?? 0),
    0,
  );

  const onSave = form.handleSubmit((formValues) => {
    setOperationError(undefined);
    save.mutate({
      id: draft.id,
      input: { ...toInput(formValues), expectedVersion: draft.version },
    });
  });

  const chooseCarrier = (carrier: Carrier) => {
    set("carrierId", carrier.id);
    set("carrierName", carrier.legalName);
    set("carrierIdentification", carrier.identification);
  };
  const chooseOrigin = (next: string) => {
    set("originEstablishmentId", next);
    // Un destino igual al origen nuevo se vuelve a elegir: nunca coinciden.
    form.getValues("recipients").forEach((recipient, index) => {
      if (recipient.kind === "OWN_COMPANY" && recipient.destinationEstablishmentId === next) {
        set(`recipients.${index}.destinationEstablishmentId`, "");
      }
    });
  };
  const addRecipient = () => {
    recipients.append(blankRecipient());
  };
  const removeRecipient = (index: number) => {
    recipients.remove(index);
    addRef.current?.focus();
  };

  const recovery =
    operationError?.code === "SHIPPING_GUIDE_DRAFT_CHANGED" ? (
      <Button variant="outline" onClick={refresh}>
        Recargar borrador
      </Button>
    ) : operationError?.code === "SHIPPING_GUIDE_DRAFT_ALREADY_EMITTED" ? (
      <Button asChild variant="outline">
        <Link href="/guias-remision">Ver guías de remisión</Link>
      </Button>
    ) : undefined;

  return (
    <section aria-labelledby="editor-titulo" className="flex flex-col gap-6">
      <Header title="Borrador de guía de remisión" />

      {operationError && (
        <OperationAlert message={operationError.message} action={recovery} alertRef={alertRef} />
      )}

      <form noValidate onSubmit={onSave} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <Section title="Transporte">
            <div className="flex flex-col gap-1">
              <span id={sourceLabelId} className="text-sm font-medium">
                ¿Quién transporta?
              </span>
              <SegmentedControl
                aria-labelledby={sourceLabelId}
                options={[
                  { value: "SELF", label: "Propio" },
                  { value: "PARTY", label: "Tercero" },
                ]}
                value={transporterSource || undefined}
                onChange={(next) => set("transporterSource", next)}
              />
            </div>
            {transporterSource === "SELF" && (
              <p className="flex items-center gap-2 rounded-md border border-border bg-surface-subtle px-3 py-2 text-sm">
                <Truck aria-hidden="true" className="size-4 shrink-0 text-foreground-muted" />
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium break-words">
                    {options.issuerIdentity?.legalName ?? "La empresa"}
                  </span>
                  <span className="text-foreground-muted tabular-nums">
                    RUC {options.issuerIdentity?.ruc ?? "sin registrar"} · transporte propio
                  </span>
                </span>
              </p>
            )}
            {transporterSource === "PARTY" && (
              <>
                {values.carrierId ? (
                  <p className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm">
                    <Truck aria-hidden="true" className="size-4 shrink-0 text-foreground-muted" />
                    <span className="flex min-w-0 flex-col">
                      <span className="font-medium break-words">{values.carrierName}</span>
                      <span className="text-foreground-muted tabular-nums">
                        {values.carrierIdentification}
                      </span>
                    </span>
                  </p>
                ) : (
                  <p className="text-sm text-foreground-muted">
                    Elige un tercero con el rol de transportista.
                  </p>
                )}
                <Button variant="outline" className="self-start" onClick={() => setChoosing(true)}>
                  {values.carrierId ? "Cambiar transportista" : "Elegir transportista"}
                </Button>
                <CarrierChooser
                  open={choosing}
                  onOpenChange={setChoosing}
                  onChoose={chooseCarrier}
                />
              </>
            )}
            <FormField
              id="placa"
              label="Placa"
              hint="La del vehículo que transporta, tal como figura en la matrícula."
              error={errors.plate?.message}
            >
              <Input
                className="max-w-120"
                autoComplete="off"
                {...fieldAria(
                  "placa",
                  errors.plate?.message,
                  "La del vehículo que transporta, tal como figura en la matrícula.",
                )}
                {...form.register("plate")}
              />
            </FormField>
          </Section>

          <Section title="Fechas y partida">
            <div className="grid gap-2 sm:grid-cols-2">
              <DatePickerField
                label="Fecha de inicio del transporte"
                value={values.transportStart ?? ""}
                min={options.evaluatedOn}
                onChange={(next) => set("transportStart", next)}
              />
              <DatePickerField
                label="Fecha de fin del transporte"
                value={values.transportEnd ?? ""}
                min={values.transportStart || options.evaluatedOn}
                onChange={(next) => set("transportEnd", next)}
              />
            </div>
            <p className="text-xs text-foreground-muted">
              El inicio no puede ser anterior a la fecha de emisión, que es la del día en que
              emitas.
            </p>
            <div className="flex flex-col gap-1">
              <span id={departureLabelId} className="text-sm font-medium">
                Punto de partida
              </span>
              <SegmentedControl
                aria-labelledby={departureLabelId}
                options={[
                  { value: "ESTABLISHMENT", label: "Establecimiento propio" },
                  { value: "FREE_TEXT", label: "Otra dirección" },
                ]}
                value={departureMode}
                onChange={(next) => set("departureMode", next)}
              />
            </div>
            {departureMode === "ESTABLISHMENT" ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <FormField id="origen" label="Establecimiento de origen">
                  <Select
                    {...fieldAria("origen", undefined)}
                    value={originId}
                    onChange={(event) => chooseOrigin(event.target.value)}
                  >
                    <option value="">Elige el establecimiento</option>
                    {options.establishments.map((establishment) => (
                      <option key={establishment.id} value={establishment.id}>
                        {establishment.code} · {establishment.address}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <div className="flex min-w-0 flex-col gap-1">
                  <span id="partida-derivada" className="text-sm font-medium">
                    Dirección de partida
                  </span>
                  <p
                    aria-labelledby="partida-derivada"
                    className="min-h-8 rounded-md border border-border bg-surface-subtle px-2 py-1 text-sm break-words"
                  >
                    {origin?.address ?? "—"}
                  </p>
                  <p className="text-xs text-foreground-muted">La del establecimiento de origen.</p>
                </div>
              </div>
            ) : (
              <FormField
                id="partida"
                label="Dirección de partida"
                hint="Propuesta desde el establecimiento del punto de emisión; corrígela si sale de otro lugar."
                error={errors.departureAddress?.message}
              >
                <Input
                  {...fieldAria(
                    "partida",
                    errors.departureAddress?.message,
                    "Propuesta desde el establecimiento del punto de emisión; corrígela si sale de otro lugar.",
                  )}
                  {...form.register("departureAddress")}
                />
              </FormField>
            )}
          </Section>

          <Section title="Destinatarios">
            <p className="text-sm text-foreground-muted">
              Cada destinatario recibe parte de la mercadería, con su sustento: una factura
              autorizada de la empresa o, sin factura, uno de los casos del art. 30 que declares.
            </p>
            <ol className="flex flex-col gap-3">
              {recipients.fields.map((field, index) => (
                <RecipientCard
                  key={field.id}
                  form={form}
                  index={index}
                  options={options}
                  preview={preview}
                  issues={fresh ? recipientIssues(index + 1) : []}
                  fresh={fresh}
                  canRemove={recipients.fields.length > 1}
                  onRemove={() => removeRecipient(index)}
                />
              ))}
            </ol>
            <Button
              ref={addRef}
              variant="outline"
              className="self-start"
              disabled={recipients.fields.length >= limits.recipients}
              onClick={addRecipient}
            >
              <Plus aria-hidden="true" />
              Agregar destinatario
            </Button>
            {recipients.fields.length >= limits.recipients && (
              <p className="text-xs text-foreground-muted">
                Llegaste al máximo de {limits.recipients} destinatarios por guía, un límite del
                sistema (no del SRI).
              </p>
            )}
            {totalDetails > limits.details && (
              <p role="status" className="text-xs text-danger">
                La guía tiene {totalDetails} detalles y el sistema admite {limits.details} por guía,
                un límite del sistema (no del SRI).
              </p>
            )}
          </Section>

          <Section title="Punto de emisión">
            <FormField id="punto" label="Punto de emisión">
              <Select
                {...fieldAria("punto", undefined)}
                value={pointId}
                onChange={(event) => {
                  set("emissionPointId", event.target.value);
                  proposeDeparture(event.target.value);
                }}
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
                Guarda el borrador para revisarlo con los datos con que se emitirá.
              </p>
            ) : (
              <dl className="grid grid-cols-1 gap-y-1 text-sm">
                <dt className="text-foreground-muted">Transportista</dt>
                <dd className="break-words">
                  {preview.carrier
                    ? `${preview.carrier.legalName} · ${preview.carrier.identification}`
                    : "—"}
                </dd>
                <dt className="text-foreground-muted">Partida</dt>
                <dd className="break-words">{preview.departureAddress ?? "—"}</dd>
                <dt className="text-foreground-muted">Destinatarios</dt>
                <dd>
                  {recipientCountLabel(preview.counts.recipients)} ·{" "}
                  {detailCountLabel(preview.counts.details)}
                </dd>
              </dl>
            )}
            {fresh && (
              <p className="text-xs text-foreground-muted">
                Vista previa del {formatIssueDate(preview.evaluatedOn)}, sin validez fiscal. No
                reserva nada: la emisión vuelve a comprobar los terceros, las facturas y las fechas.
              </p>
            )}
            {fresh && generalIssues.length > 0 && (
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-semibold">Antes de emitir</h3>
                <IssueList issues={generalIssues} />
              </div>
            )}
            <p className="text-xs text-foreground-muted">
              Límites del sistema (no del SRI): {limits.recipients} destinatarios,{" "}
              {limits.detailsPerRecipient} detalles por destinatario y {limits.details} por guía.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            {/* Aviso del ambiente junto a la acción que decide (design D21). */}
            {canEmit && <EmissionEnvironmentNotice document="guía de remisión" />}
            {canEmit && (
              <Button
                disabled={emitBlocked}
                aria-describedby={emitHint ? emitHintId : undefined}
                onClick={() => {
                  idempotencyKey.current ||= crypto.randomUUID();
                  setConfirming(true);
                }}
              >
                Emitir guía de remisión
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
          if (!open) setDeclared(false);
        }}
        title="Emitir guía de remisión"
        confirmLabel="Emitir guía de remisión"
        pending={emit.isPending}
        confirmBlocked={declarationRequired && !declared}
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
            declarationPolicyVersion: declarationRequired ? options.exceptionPolicy.version : null,
          })
        }
        description={
          <div className="flex flex-col gap-2">
            <p>La emisión reserva el número de la guía y la firma; no se puede deshacer.</p>
            {/* En pantallas angostas, cada dato bajo su nombre: los números no se parten. */}
            <dl className="grid grid-cols-1 gap-x-4 text-foreground sm:grid-cols-[auto_1fr] sm:gap-y-1">
              <dt className="text-foreground-muted">Ambiente</dt>
              <dd className="max-sm:mb-1">{environment ?? "Desconocido"}</dd>
              <dt className="text-foreground-muted">Transportista</dt>
              <dd className="break-words max-sm:mb-1">{preview.carrier?.legalName ?? "—"}</dd>
              <dt className="text-foreground-muted">Placa</dt>
              <dd className="tabular-nums max-sm:mb-1">{draft.plate ?? "—"}</dd>
              <dt className="text-foreground-muted">Fechas</dt>
              <dd className="tabular-nums max-sm:mb-1">
                {draft.transportStart ? formatIssueDate(draft.transportStart) : "—"} al{" "}
                {draft.transportEnd ? formatIssueDate(draft.transportEnd) : "—"}
              </dd>
              <dt className="text-foreground-muted">Destinatarios</dt>
              <dd className="max-sm:mb-1">
                <ul>
                  {preview.recipients.map((recipient) => (
                    <li key={recipient.position} className="break-words">
                      {recipient.legalName ?? "—"} ·{" "}
                      {recipient.support?.kind === "INTERNAL_INVOICE"
                        ? `Factura ${recipient.support.invoice?.documentNumber ?? ""}`
                        : recipient.support?.kind === "DECLARED_EXCEPTION"
                          ? `Sin factura: ${recipient.support.label}`
                          : "—"}{" "}
                      · {detailCountLabel(recipient.details.length)}
                    </li>
                  ))}
                </ul>
              </dd>
            </dl>
            <EmissionEnvironmentNotice document="guía de remisión" />
          </div>
        }
      >
        {declarationRequired && (
          <div className="mt-2 flex flex-col gap-2 rounded-md border border-warning/40 bg-warning/10 px-2 py-1 text-sm">
            <ul className="flex flex-col gap-1">
              {exceptions.map(({ position, policy }) => (
                <li key={position} className="break-words">
                  Destinatario {position}: {policy?.label} (literal {policy?.literal}).{" "}
                  {policy?.statement}
                </li>
              ))}
            </ul>
            <label className="flex min-h-11 items-start gap-2">
              <input
                type="checkbox"
                className="mt-1 size-5 shrink-0 accent-primary"
                checked={declared}
                onChange={(event) => setDeclared(event.target.checked)}
              />
              <span>{DECLARATION}</span>
            </label>
          </div>
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
 * Nueva guía de remisión: preparar el borrador lo crea con el punto predeterminado del usuario (el
 * servidor propone la partida desde su establecimiento), y el editor sigue en su ruta.
 */
export function NewShippingGuideDraftScreen() {
  const { me } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const allowed = canSee(me.role, "shippingGuides.draft");
  const defaultPoint = useDefaultPoint(allowed);
  const [error, setError] = useState<string>();
  const alertRef = useRef<HTMLDivElement>(null);
  const create = useSaveShippingGuideDraft({
    success: "Preparaste el borrador de la guía de remisión.",
    onSuccess: (draft) => {
      queryClient.setQueryData([...SHIPPING_GUIDE_DRAFTS_KEY, "detail", draft.id], draft);
      router.replace(`/guias-remision/borradores/${draft.id}`);
    },
    onError: (failure) => {
      setError(errorMessage(failure, SHIPPING_GUIDE_CONFLICT_MESSAGES));
      return true;
    },
  });
  useEffect(() => {
    if (error) alertRef.current?.focus();
  }, [error]);

  if (!allowed) {
    return (
      <Fallback title="Nueva guía de remisión">
        <EmptyState
          kind="no-permission"
          title="No tienes acceso a los borradores de guías de remisión"
          description="Pide a un administrador que revise tu rol."
        />
      </Fallback>
    );
  }
  const point = defaultPoint.data?.available ? defaultPoint.data.emissionPoint.id : null;
  return (
    <Fallback title="Nueva guía de remisión">
      {error && <OperationAlert message={error} alertRef={alertRef} />}
      <Section title="Traslado">
        <p className="text-sm text-foreground-muted">
          Prepara la guía antes de que salga la mercadería: el transportista, la placa, las fechas y
          cada destinatario con su sustento. Para una venta, también puedes empezar desde el detalle
          de una factura autorizada.
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
export function ShippingGuideDraftScreen({ draftId }: { draftId: string }) {
  const { me } = useSession();
  const allowed = canSee(me.role, "shippingGuides.draft");
  const canEmit = canSee(me.role, "shippingGuides.emit");
  const draft = useShippingGuideDraft(draftId, allowed);
  const options = useShippingGuideOptions(allowed);

  if (!allowed) {
    return (
      <Fallback title="Borrador de guía de remisión">
        <EmptyState
          kind="no-permission"
          title="No tienes acceso a los borradores de guías de remisión"
          description="Pide a un administrador que revise tu rol."
        />
      </Fallback>
    );
  }
  if (draft.isPending || options.isPending) return <ShippingGuideDraftSkeleton />;
  if (draft.isError) {
    const error = draft.error;
    const emitted =
      error instanceof ApiError && error.code === "SHIPPING_GUIDE_DRAFT_ALREADY_EMITTED";
    const missing = error instanceof ApiError && error.status === 404;
    return (
      <Fallback title="Borrador de guía de remisión">
        {emitted || missing ? (
          <EmptyState
            kind="empty"
            title={emitted ? "Este borrador ya se emitió" : "El borrador no existe"}
            description={
              emitted
                ? "Encuéntralo en Guías de remisión: un borrador emitido ya no se corrige."
                : "Puede que se haya eliminado."
            }
            action={
              <Button asChild variant="outline">
                <Link href="/guias-remision">Ver guías de remisión</Link>
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
      <Fallback title="Borrador de guía de remisión">
        <ErrorState
          message="No pudimos cargar los establecimientos y los casos de excepción."
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

export function ShippingGuideDraftSkeleton() {
  return (
    <section aria-busy="true" className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold">Borrador de guía de remisión</h1>
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-48 w-full" />
    </section>
  );
}
