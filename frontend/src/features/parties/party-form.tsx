// Alta y corrección de un tercero (add-parties-and-products, design D17). Desde Terceros, en su
// propia página (decisión del propietario, 2026-10-17): una sola columna centrada, sin secciones, con
// los roles primero como pestañas de selección múltiple (decisión del propietario, 2026-10-22); desde
// un comprobante, el alta rápida sigue en `PartyDialog` para no abandonar el borrador. Los dos usan
// este formulario: React Hook Form con el esquema del contrato. La regla de formato del tipo elegido se
// muestra como ayuda; la valida el servidor con el catálogo vigente y su error vuelve al campo.
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  createPartySchema,
  partyEmailsSchema,
  PARTY_EMAILS_MAX,
  PARTY_ROLE_LABELS,
  PARTY_ROLES,
  type PartyData,
  type PartyRole,
  type PartyView,
} from "@facturador/contracts";
import { Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { AddRowButton } from "@/components/add-row-button";
import { FormStateBadge } from "@/components/form-state-badge";
import { AsyncButton } from "@/components/async-button";
import { ChipMultiSelect } from "@/components/chip-multi-select";
import { RowActionButton } from "@/components/data-table/table-controls";
import { errorMessage } from "@/components/feedback";
import { LabelWithHint } from "@/components/field-hint";
import { fieldAria, FormField } from "@/components/form-dialog";
import { PageHeader } from "@/components/layout/page-header";
import { useSession } from "@/components/session";
import { useBreadcrumbLabel } from "@/components/shell/breadcrumb-label";
import { EmptyState, ErrorState, Skeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ApiError } from "@/lib/api";
import { canSee } from "@/lib/permissions";
import { emailRowsSchema, toEmailRows } from "@/features/email/email-rows";
import { useIdentificationTypes, useParty, useSaveParty } from "./parties-api";

const LIST = "/terceros";
const TITLE_ID = "tercero-titulo";
/** Una sola columna centrada en la página (decisión del propietario, 2026-10-22). */
const PAGE = "mx-auto flex w-full max-w-2xl flex-col gap-6";

/** Hasta tres correos, en una lista editable (add-email-delivery, design D14). */
const partyFormSchema = createPartySchema.extend({
  emails: emailRowsSchema({
    max: PARTY_EMAILS_MAX,
    address: partyEmailsSchema.element,
    tooMany: `Un tercero admite como máximo ${PARTY_EMAILS_MAX} correos.`,
  }),
});
type FormInput = z.input<typeof partyFormSchema>;
const ROLE_OPTIONS = PARTY_ROLES.map((role) => ({ value: role, label: PARTY_ROLE_LABELS[role] }));
const IDENTIFICATION_ERRORS = new Set([
  "PARTY_IDENTIFICATION_INVALID",
  "PARTY_IDENTIFICATION_RESERVED",
  "PARTY_IDENTIFICATION_TYPE_UNAVAILABLE",
  "PARTY_IDENTIFICATION_TAKEN",
]);

// Un alta sin roles indicados empieza como cliente, el uso más común (decisión del propietario,
// 2026-10-22); los diálogos de un comprobante indican los suyos (proveedor, transportista o
// ninguno) y los conservan.
const DEFAULT_ROLES: readonly PartyRole[] = ["CUSTOMER"];

const toForm = (
  party: PartyView | null,
  initialRoles: readonly PartyRole[] = DEFAULT_ROLES,
): FormInput => ({
  identificationType: party?.identificationType ?? "04",
  identification: party?.identification ?? "",
  legalName: party?.legalName ?? "",
  address: party?.address ?? "",
  emails: toEmailRows(party?.emails ?? []),
  phone: party?.phone ?? "",
  roles: party?.roles ?? [...initialRoles],
});

/** Estado del formulario de un tercero: valores, envío y errores de la operación. */
export function usePartyForm({
  party,
  initialRoles,
  enabled,
  onSaved,
}: {
  /** Tercero que se corrige; null para un alta. */
  party: PartyView | null;
  /** Roles marcados en un alta, como el de proveedor desde una retención. */
  initialRoles?: readonly PartyRole[] | undefined;
  /** Si el formulario está a la vista, para consultar los tipos de identificación. */
  enabled: boolean;
  onSaved: (party: PartyView) => void;
}) {
  const [error, setError] = useState<string>();
  const [taken, setTaken] = useState<string>();
  const types = useIdentificationTypes(enabled);
  const form = useForm<FormInput, unknown, PartyData>({
    resolver: zodResolver(partyFormSchema),
    defaultValues: toForm(party, initialRoles),
  });
  const save = useSaveParty({
    onSuccess: onSaved,
    onError: (cause) => {
      if (cause instanceof ApiError && IDENTIFICATION_ERRORS.has(cause.code)) {
        form.setError("identification", { message: cause.message }, { shouldFocus: true });
        if (cause.code === "PARTY_IDENTIFICATION_TAKEN")
          setTaken(form.getValues("identification").trim());
        return true;
      }
      if (cause instanceof ApiError && (cause.status === 400 || cause.status === 409)) {
        setError(errorMessage(cause));
        return true;
      }
      return false;
    },
  });
  const selectedType = useWatch({ control: form.control, name: "identificationType" });
  const rule = types.data?.find((type) => type.code === selectedType)?.rule;

  return {
    form,
    types,
    selectedType,
    rule,
    save,
    error,
    taken,
    /** Vuelve al estado inicial, al abrir de nuevo el diálogo. */
    reset: () => {
      setError(undefined);
      setTaken(undefined);
      form.reset(toForm(party, initialRoles));
    },
    onSubmit: form.handleSubmit((input) => {
      setError(undefined);
      setTaken(undefined);
      save.mutate(
        party ? { id: party.id, input: { ...input, expectedVersion: party.version } } : { input },
      );
    }),
  };
}

export type PartyFormState = ReturnType<typeof usePartyForm>;

/** Tipo e identificación, con la regla del tipo y el acceso al tercero que ya la tiene. */
export function PartyIdentificationFields({
  state,
  onShowExisting,
}: {
  state: PartyFormState;
  onShowExisting: (identification: string) => void;
}) {
  const { form, types, selectedType, rule, taken } = state;
  const { errors } = form.formState;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,12rem)_1fr]">
        <FormField id="party-type" label="Tipo de identificación">
          <Select id="party-type" {...form.register("identificationType")}>
            {(types.data ?? []).map((type) => (
              <option key={type.code} value={type.code}>
                {type.label}
              </option>
            ))}
            {!types.data && <option value={selectedType}>Cargando…</option>}
          </Select>
        </FormField>
        <FormField
          id="party-identification"
          label="Identificación"
          hint={rule ? `Regla: ${rule}.` : undefined}
          error={errors.identification?.message}
        >
          <Input
            {...fieldAria(
              "party-identification",
              errors.identification?.message,
              rule ? "hint" : undefined,
            )}
            {...form.register("identification")}
            autoComplete="off"
            spellCheck={false}
          />
        </FormField>
      </div>
      {taken && (
        <div>
          <Button variant="outline" type="button" onClick={() => onShowExisting(taken)}>
            Ver el tercero existente
          </Button>
        </div>
      )}
    </>
  );
}

export function PartyNameField({ state }: { state: PartyFormState }) {
  const { form } = state;
  const { errors } = form.formState;
  return (
    <FormField id="party-name" label="Razón social o nombres" error={errors.legalName?.message}>
      <Input
        {...fieldAria("party-name", errors.legalName?.message)}
        {...form.register("legalName")}
        autoComplete="off"
      />
    </FormField>
  );
}

/**
 * Los roles, opcionales y combinables (spec de terceros): pestañas a todo el ancho donde se elige uno,
 * varios o ninguno.
 */
export function PartyRolesField({ state }: { state: PartyFormState }) {
  const rolesLabel = useId();
  const rolesHint = `${rolesLabel}-ayuda`;
  return (
    <div className="flex flex-col gap-1">
      <LabelWithHint
        label="Roles"
        hintId={rolesHint}
        hint="Puedes elegir varios, o ninguno: solo sirven para encontrarlo al hacer un comprobante."
      >
        <span id={rolesLabel} className="text-sm font-medium">
          Roles <span className="font-normal text-foreground-muted">(opcional)</span>
        </span>
      </LabelWithHint>
      <Controller
        control={state.form.control}
        name="roles"
        render={({ field }) => (
          <ChipMultiSelect<PartyRole>
            appearance="tabs"
            aria-labelledby={rolesLabel}
            aria-describedby={rolesHint}
            options={ROLE_OPTIONS}
            value={field.value ?? []}
            onChange={field.onChange}
          />
        )}
      />
    </div>
  );
}

const EMAILS_HINT = "Hasta tres. Cada comprobante autorizado se le envía a todos.";

/** Dirección, hasta tres correos y teléfono, todos opcionales. */
export function PartyContactFields({ state }: { state: PartyFormState }) {
  const { form } = state;
  const { errors } = form.formState;
  const emails = useFieldArray({ control: form.control, name: "emails" });
  const legendId = useId();
  const hintId = `${legendId}-ayuda`;
  const addRef = useRef<HTMLButtonElement>(null);
  // Quitar el tercer correo vuelve a mostrar «Agregar correo»: el foco va a él cuando aparece.
  const focusAdd = useRef(false);
  useEffect(() => {
    if (!focusAdd.current) return;
    focusAdd.current = false;
    addRef.current?.focus();
  });
  const full = emails.fields.length >= PARTY_EMAILS_MAX;

  return (
    <>
      <FormField id="party-address" label="Dirección (opcional)" error={errors.address?.message}>
        <Input
          {...fieldAria("party-address", errors.address?.message)}
          {...form.register("address")}
        />
      </FormField>
      <fieldset aria-labelledby={legendId} className="flex min-w-0 flex-col gap-2">
        <LabelWithHint label="Correos" hintId={hintId} hint={EMAILS_HINT}>
          <span id={legendId} className="text-sm font-medium">
            Correos <span className="font-normal text-foreground-muted">(opcional)</span>
          </span>
        </LabelWithHint>
        {emails.fields.map((field, index) => {
          const id = `party-email-${index}`;
          const error = errors.emails?.[index]?.address?.message;
          return (
            <FormField
              key={field.id}
              id={id}
              label={`Correo ${index + 1}`}
              labelClassName="sr-only"
              error={error}
              action={
                emails.fields.length > 1 ? (
                  <RowActionButton
                    icon={Trash2}
                    tone="danger"
                    label={`Quitar el correo ${index + 1}`}
                    onClick={() => {
                      emails.remove(index);
                      focusAdd.current = true;
                    }}
                  />
                ) : undefined
              }
            >
              <Input
                {...fieldAria(id, error)}
                {...(index === 0 && !error ? { "aria-describedby": hintId } : {})}
                {...form.register(`emails.${index}.address`)}
                type="email"
                inputMode="email"
                autoCapitalize="none"
                spellCheck={false}
              />
            </FormField>
          );
        })}
        {full ? (
          <p className="text-sm text-foreground-muted">
            Un tercero admite hasta {PARTY_EMAILS_MAX} correos.
          </p>
        ) : (
          <AddRowButton
            ref={addRef}
            onClick={() =>
              emails.append(
                { address: "" },
                { focusName: `emails.${emails.fields.length}.address` },
              )
            }
          >
            <Plus aria-hidden="true" data-icon="inline-start" />
            Agregar correo
          </AddRowButton>
        )}
        {errors.emails?.root?.message && (
          <p role="alert" className="text-xs text-danger">
            {errors.emails.root.message}
          </p>
        )}
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="party-phone" label="Teléfono (opcional)" error={errors.phone?.message}>
          <Input
            {...fieldAria("party-phone", errors.phone?.message)}
            {...form.register("phone")}
            type="tel"
            inputMode="tel"
          />
        </FormField>
      </div>
    </>
  );
}

function PartyForm({ initial }: { initial: PartyView | null }) {
  // La versión que se corrige es la que se abrió: una recarga posterior no la reemplaza, así un
  // cambio de otro usuario sigue llegando como conflicto.
  const [party] = useState(initial);
  const router = useRouter();
  const state = usePartyForm({ party, enabled: true, onSaved: () => router.push(LIST) });
  return (
    <form
      noValidate
      aria-labelledby={TITLE_ID}
      onSubmit={state.onSubmit}
      className="flex flex-col gap-5"
    >
      <PartyRolesField state={state} />
      <PartyIdentificationFields
        state={state}
        onShowExisting={(identification) =>
          router.push(`${LIST}?${new URLSearchParams({ q: identification, estado: "todos" })}`)
        }
      />
      <PartyNameField state={state} />
      <PartyContactFields state={state} />

      {state.error && (
        <p
          role="alert"
          className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm"
        >
          {state.error}
        </p>
      )}

      {/* Sin línea separadora encima de las acciones (decisión del propietario, 2026-10-22). */}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" asChild>
          <Link href={LIST}>Cancelar</Link>
        </Button>
        <AsyncButton type="submit" pending={state.save.isPending}>
          {party ? "Guardar cambios" : "Registrar tercero"}
        </AsyncButton>
      </div>
    </form>
  );
}

/** Encabezado de la página, también en sus estados de carga, error y sin permiso. */
function Header({ editing, description }: { editing: boolean; description?: string }) {
  return (
    <PageHeader
      title="Tercero"
      titleId={TITLE_ID}
      badge={<FormStateBadge state={editing ? "edit" : "new"} />}
      description={
        description ?? "Un cliente, proveedor o transportista, para usarlo en los comprobantes."
      }
    />
  );
}

/** La página del formulario: sin `partyId`, un alta; con él, la corrección de ese tercero. */
export function PartyFormScreen({ partyId }: { partyId?: string }) {
  const { me } = useSession();
  const allowed = canSee(me.role, "parties.manage");
  const editing = partyId !== undefined;
  const query = useParty(partyId ?? "", allowed && editing);
  useBreadcrumbLabel(query.data?.legalName);

  if (!allowed) {
    return (
      <section aria-labelledby={TITLE_ID} className={PAGE}>
        <Header editing={editing} />
        <EmptyState
          kind="no-permission"
          title="No tienes permiso para registrar terceros"
          description="Pide a un administrador que revise tu rol."
        />
      </section>
    );
  }
  if (!editing) {
    return (
      <section aria-labelledby={TITLE_ID} className={PAGE}>
        <Header editing={false} />
        <PartyForm initial={null} />
      </section>
    );
  }
  if (query.isPending) return <PartyFormSkeleton />;
  // El consumidor final es un registro del sistema: no se corrige.
  const missing =
    (query.error instanceof ApiError && query.error.status === 404) ||
    (query.data !== undefined && query.data.systemRecord !== null);
  if (query.isError || missing) {
    return (
      <section aria-labelledby={TITLE_ID} className={PAGE}>
        <Header editing />
        {missing ? (
          <EmptyState
            kind="empty"
            title={
              query.data?.systemRecord ? "Este tercero es del sistema" : "El tercero no existe"
            }
            description={
              query.data?.systemRecord
                ? "El consumidor final no se corrige."
                : "Búscalo en la lista de terceros."
            }
            action={
              <Button variant="outline" asChild>
                <Link href={LIST}>Ir a Clientes y proveedores</Link>
              </Button>
            }
          />
        ) : (
          <ErrorState
            message="No pudimos cargar el tercero."
            onRetry={() => void query.refetch()}
          />
        )}
      </section>
    );
  }
  return (
    <section aria-labelledby={TITLE_ID} className={PAGE}>
      <Header editing description={query.data.legalName} />
      <PartyForm key={query.data.id} initial={query.data} />
    </section>
  );
}

export function PartyFormSkeleton() {
  return (
    <section aria-busy="true" className={PAGE}>
      <Skeleton className="h-10 w-64" />
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    </section>
  );
}
