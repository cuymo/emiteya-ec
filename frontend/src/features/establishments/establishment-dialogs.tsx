// Diálogos de Establecimientos (design D14): crear un establecimiento, corregir su dirección y
// agregar un punto. El código se pide solo al crear; después aparece como etiqueta.
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  createEmissionPointSchema,
  createEstablishmentSchema,
  updateEstablishmentSchema,
  type CreateEmissionPointInput,
  type CreateEstablishmentInput,
  type EstablishmentView,
  type UpdateEstablishmentInput,
} from "@facturador/contracts";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { errorMessage } from "@/components/feedback";
import { fieldAria, FormDialog, FormField } from "@/components/form-dialog";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api";
import {
  useCreateEmissionPoint,
  useCreateEstablishment,
  useUpdateAddress,
} from "./establishments-api";

type DialogProps = { open: boolean; onOpenChange: (open: boolean) => void };

/** Un error que no es de un campo se muestra en el cuerpo del diálogo y conserva los valores. */
const bodyError = (cause: unknown, setError: (message: string) => void) => {
  if (cause instanceof ApiError && cause.status === 400) {
    setError(errorMessage(cause));
    return true;
  }
  return false;
};

export function CreateEstablishmentDialog({ open, onOpenChange }: DialogProps) {
  const [error, setError] = useState<string>();
  const form = useForm<CreateEstablishmentInput>({
    resolver: zodResolver(createEstablishmentSchema),
    defaultValues: { code: "", address: "" },
  });
  const { errors } = form.formState;
  const close = () => {
    onOpenChange(false);
    form.reset();
    setError(undefined);
  };
  const create = useCreateEstablishment({
    onSuccess: close,
    onError: (cause) => {
      if (cause instanceof ApiError && cause.code === "ESTABLISHMENT_CODE_TAKEN") {
        form.setError("code", { message: cause.message }, { shouldFocus: true });
        return true;
      }
      return bodyError(cause, setError);
    },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title="Crear establecimiento"
      description="Usa el código de tres dígitos con que el establecimiento está registrado en el SRI."
      submitLabel="Crear establecimiento"
      pending={create.isPending || form.formState.isSubmitting}
      error={error}
      onSubmit={form.handleSubmit((input) => {
        setError(undefined);
        create.mutate(input);
      })}
    >
      <FormField
        id="establishment-code"
        label="Código"
        hint="Tres dígitos, por ejemplo 001. No se puede cambiar después."
        error={errors.code?.message}
      >
        <Input
          {...fieldAria(
            "establishment-code",
            errors.code?.message,
            "Tres dígitos, por ejemplo 001. No se puede cambiar después.",
          )}
          {...form.register("code")}
          inputMode="numeric"
          maxLength={3}
          autoComplete="off"
          className="max-w-48"
        />
      </FormField>
      <FormField id="establishment-address" label="Dirección" error={errors.address?.message}>
        <Input
          {...fieldAria("establishment-address", errors.address?.message)}
          {...form.register("address")}
          autoComplete="street-address"
        />
      </FormField>
    </FormDialog>
  );
}

export function EditAddressDialog({
  establishment,
  onOpenChange,
}: {
  establishment: EstablishmentView | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [error, setError] = useState<string>();
  const form = useForm<UpdateEstablishmentInput>({
    resolver: zodResolver(updateEstablishmentSchema),
    values: { address: establishment?.address ?? "" },
  });
  const { errors } = form.formState;
  const close = () => {
    onOpenChange(false);
    setError(undefined);
  };
  const update = useUpdateAddress({
    onSuccess: close,
    onError: (cause) => bodyError(cause, setError),
  });
  return (
    <FormDialog
      open={establishment !== null}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title="Corregir la dirección"
      {...(establishment ? { description: `Establecimiento ${establishment.code}` } : {})}
      submitLabel="Guardar dirección"
      pending={update.isPending || form.formState.isSubmitting}
      error={error}
      onSubmit={form.handleSubmit(({ address }) => {
        setError(undefined);
        if (establishment) update.mutate({ id: establishment.id, address });
      })}
    >
      <FormField id="edit-address" label="Dirección" error={errors.address?.message}>
        <Input
          {...fieldAria("edit-address", errors.address?.message)}
          {...form.register("address")}
          autoComplete="street-address"
        />
      </FormField>
    </FormDialog>
  );
}

export function AddPointDialog({
  establishment,
  onOpenChange,
}: {
  establishment: EstablishmentView | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [error, setError] = useState<string>();
  const form = useForm<CreateEmissionPointInput>({
    resolver: zodResolver(createEmissionPointSchema),
    defaultValues: { code: "" },
  });
  const { errors } = form.formState;
  const close = () => {
    onOpenChange(false);
    form.reset();
    setError(undefined);
  };
  const create = useCreateEmissionPoint({
    onSuccess: close,
    onError: (cause) => {
      if (cause instanceof ApiError && cause.code === "EMISSION_POINT_CODE_TAKEN") {
        form.setError("code", { message: cause.message }, { shouldFocus: true });
        return true;
      }
      return bodyError(cause, setError);
    },
  });
  return (
    <FormDialog
      open={establishment !== null}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title="Agregar punto de emisión"
      {...(establishment
        ? { description: `Establecimiento ${establishment.code} · ${establishment.address}` }
        : {})}
      submitLabel="Agregar punto"
      pending={create.isPending || form.formState.isSubmitting}
      error={error}
      onSubmit={form.handleSubmit((input) => {
        setError(undefined);
        if (establishment) create.mutate({ establishment, input });
      })}
    >
      <FormField
        id="point-code"
        label="Código del punto"
        hint="Tres dígitos, por ejemplo 001. No se puede cambiar después."
        error={errors.code?.message}
      >
        <Input
          {...fieldAria(
            "point-code",
            errors.code?.message,
            "Tres dígitos, por ejemplo 001. No se puede cambiar después.",
          )}
          {...form.register("code")}
          inputMode="numeric"
          maxLength={3}
          autoComplete="off"
          className="max-w-48"
        />
      </FormField>
    </FormDialog>
  );
}
