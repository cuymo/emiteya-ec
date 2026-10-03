// Alta y corrección de un tercero (add-parties-and-products, design D17). Formulario corto en
// FormDialog con React Hook Form y el esquema del contrato. La regla de formato del tipo elegido se
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
import { useEffect, useId, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import { ChipMultiSelect } from "@/components/chip-multi-select";
import { errorMessage } from "@/components/feedback";
import { fieldAria, FormDialog, FormField } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ApiError } from "@/lib/api";
import { useIdentificationTypes, useSaveParty } from "./parties-api";

type FormInput = z.input<typeof createPartySchema>;
const ROLE_OPTIONS = PARTY_ROLES.map((role) => ({ value: role, label: PARTY_ROLE_LABELS[role] }));
const IDENTIFICATION_ERRORS = new Set([
  "PARTY_IDENTIFICATION_INVALID",
  "PARTY_IDENTIFICATION_RESERVED",
  "PARTY_IDENTIFICATION_TYPE_UNAVAILABLE",
  "PARTY_IDENTIFICATION_TAKEN",
]);

const toForm = (party: PartyView | null): FormInput => ({
  identificationType: party?.identificationType ?? "04",
  identification: party?.identification ?? "",
  legalName: party?.legalName ?? "",
  address: party?.address ?? "",
  email: party?.email ?? "",
  phone: party?.phone ?? "",
  roles: party?.roles ?? [],
});

export function PartyDialog({
  open,
  party,
  onClose,
  onShowExisting,
}: {
  open: boolean;
  /** Tercero que se corrige; null para un alta. */
  party: PartyView | null;
  onClose: () => void;
  /** Lleva la lista al tercero que ya tiene esa identificación. */
  onShowExisting: (identification: string) => void;
}) {
  const rolesLabel = useId();
  const [error, setError] = useState<string>();
  const [taken, setTaken] = useState<string>();
  const types = useIdentificationTypes(open);
  const form = useForm<FormInput, unknown, PartyData>({
    resolver: zodResolver(createPartySchema),
    defaultValues: toForm(party),
  });
  const { errors } = form.formState;
  useEffect(() => {
    if (open) form.reset(toForm(party));
  }, [open, party, form]);

  const close = () => {
    setError(undefined);
    setTaken(undefined);
    onClose();
  };
  const save = useSaveParty({
    onSuccess: close,
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

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => (next ? undefined : close())}
      title={party ? "Corregir tercero" : "Nuevo tercero"}
      submitLabel={party ? "Guardar cambios" : "Registrar tercero"}
      pending={save.isPending}
      error={error}
      onSubmit={form.handleSubmit((input) => {
        setError(undefined);
        setTaken(undefined);
        save.mutate(
          party ? { id: party.id, input: { ...input, expectedVersion: party.version } } : { input },
        );
      })}
    >
      <div className="grid gap-2 sm:grid-cols-[minmax(0,12rem)_1fr]">
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
          <Button
            variant="outline"
            type="button"
            onClick={() => {
              onShowExisting(taken);
              close();
            }}
          >
            Ver el tercero existente
          </Button>
        </div>
      )}
      <FormField id="party-name" label="Razón social o nombres" error={errors.legalName?.message}>
        <Input
          {...fieldAria("party-name", errors.legalName?.message)}
          {...form.register("legalName")}
          autoComplete="off"
        />
      </FormField>
      <div className="flex flex-col gap-0.5">
        <span id={rolesLabel} className="text-sm font-medium">
          Roles <span className="font-normal text-foreground-muted">(opcional)</span>
        </span>
        <Controller
          control={form.control}
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
      <FormField id="party-address" label="Dirección (opcional)" error={errors.address?.message}>
        <Input
          {...fieldAria("party-address", errors.address?.message)}
          {...form.register("address")}
        />
      </FormField>
      <div className="grid gap-2 sm:grid-cols-2">
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
    </FormDialog>
  );
}
