// Alta y corrección de un tercero (add-parties-and-products, design D17). Desde Terceros, en su
// propia página con secciones como Empresa (decisión del propietario, 2026-10-17); desde un
// comprobante, el alta rápida sigue en `PartyDialog` para no abandonar el borrador. Los dos usan este
// formulario: React Hook Form con el esquema del contrato. La regla de formato del tipo elegido se
// muestra como ayuda; la valida el servidor con el catálogo vigente y su error vuelve al campo.
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  createPartySchema,
  PARTY_ROLE_LABELS,
  PARTY_ROLES,
  type PartyData,
  type PartyRole,
  type PartyView,
} from "@facturador/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import { AsyncButton } from "@/components/async-button";
import { ChipMultiSelect } from "@/components/chip-multi-select";
import { errorMessage } from "@/components/feedback";
import { fieldAria, FormField } from "@/components/form-dialog";
import { PageHeader } from "@/components/layout/page-header";
import { SettingsSection, SettingsSections } from "@/components/layout/settings-section";
import { useSession } from "@/components/session";
import { useBreadcrumbLabel } from "@/components/shell/breadcrumb-label";
import { EmptyState, ErrorState, Skeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ApiError } from "@/lib/api";
import { canSee } from "@/lib/permissions";
import { useIdentificationTypes, useParty, useSaveParty } from "./parties-api";

const LIST = "/terceros";
const TITLE_ID = "tercero-titulo";

type FormInput = z.input<typeof createPartySchema>;
const ROLE_OPTIONS = PARTY_ROLES.map((role) => ({ value: role, label: PARTY_ROLE_LABELS[role] }));
const IDENTIFICATION_ERRORS = new Set([
  "PARTY_IDENTIFICATION_INVALID",
  "PARTY_IDENTIFICATION_RESERVED",
  "PARTY_IDENTIFICATION_TYPE_UNAVAILABLE",
  "PARTY_IDENTIFICATION_TAKEN",
]);

const toForm = (party: PartyView | null, initialRoles: readonly PartyRole[] = []): FormInput => ({
  identificationType: party?.identificationType ?? "04",
  identification: party?.identification ?? "",
  legalName: party?.legalName ?? "",
  address: party?.address ?? "",
  email: party?.email ?? "",
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
    resolver: zodResolver(createPartySchema),
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

export function PartyRolesField({
  state,
  hideLabel = false,
}: {
  state: PartyFormState;
  /** Solo para la asistencia, donde el título de la sección ya lo dice. */
  hideLabel?: boolean;
}) {
  const rolesLabel = useId();
  return (
    <div className="flex flex-col gap-1">
      <span id={rolesLabel} className={hideLabel ? "sr-only" : "text-sm font-medium"}>
        Roles <span className="font-normal text-foreground-muted">(opcional)</span>
      </span>
      <Controller
        control={state.form.control}
        name="roles"
        render={({ field }) => (
          <ChipMultiSelect<PartyRole>
            aria-labelledby={rolesLabel}
            options={ROLE_OPTIONS}
            value={field.value ?? []}
            onChange={field.onChange}
          />
        )}
      />
    </div>
  );
}

/** Dirección, correo y teléfono, todos opcionales. */
export function PartyContactFields({ state }: { state: PartyFormState }) {
  const { form } = state;
  const { errors } = form.formState;
  return (
    <>
      <FormField id="party-address" label="Dirección (opcional)" error={errors.address?.message}>
        <Input
          {...fieldAria("party-address", errors.address?.message)}
          {...form.register("address")}
        />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="party-email" label="Correo (opcional)" error={errors.email?.message}>
          <Input
            {...fieldAria("party-email", errors.email?.message)}
            {...form.register("email")}
            type="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
          />
        </FormField>
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
      className="flex flex-col gap-6"
    >
      <SettingsSections>
        <SettingsSection
          title="Datos del tercero"
          description="Con su identificación y su razón social aparece en los comprobantes."
        >
          <PartyIdentificationFields
            state={state}
            onShowExisting={(identification) =>
              router.push(`${LIST}?${new URLSearchParams({ q: identification, estado: "todos" })}`)
            }
          />
          <PartyNameField state={state} />
        </SettingsSection>
        <SettingsSection
          title="Roles"
          description="Opcionales. Para encontrarlo como cliente, proveedor o transportista al hacer un comprobante."
        >
          <PartyRolesField state={state} hideLabel />
        </SettingsSection>
        <SettingsSection
          title="Contacto"
          description="Datos opcionales para ubicarlo y escribirle."
        >
          <PartyContactFields state={state} />
        </SettingsSection>
      </SettingsSections>

      {state.error && (
        <p
          role="alert"
          className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm"
        >
          {state.error}
        </p>
      )}

      <div className="flex justify-end gap-2 border-t border-border pt-6">
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
      title={editing ? "Corregir tercero" : "Nuevo tercero"}
      titleId={TITLE_ID}
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
      <section aria-labelledby={TITLE_ID} className="flex flex-col gap-6">
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
      <section aria-labelledby={TITLE_ID} className="flex flex-col gap-6">
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
      <section aria-labelledby={TITLE_ID} className="flex flex-col gap-6">
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
                <Link href={LIST}>Ir a Terceros</Link>
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
    <section aria-labelledby={TITLE_ID} className="flex flex-col gap-6">
      <Header editing description={query.data.legalName} />
      <PartyForm key={query.data.id} initial={query.data} />
    </section>
  );
}

export function PartyFormSkeleton() {
  return (
    <section aria-busy="true" className="@container flex flex-col gap-6">
      <Skeleton className="h-10 w-64" />
      <div className="grid gap-4 @settings-split:grid-cols-3 @settings-split:gap-8">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-full" />
        </div>
        <div className="flex flex-col gap-4 @settings-split:col-span-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    </section>
  );
}
