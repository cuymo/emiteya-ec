// Diálogo Ajustar (add-fiscal-numbering, design D14): fija el siguiente secuencial de un contador.
// Al avanzar avisa de los números que no se usarán; al retroceder revela el motivo obligatorio. El
// número reservado se señala en su campo y el conflicto ofrece recargar el valor vigente.
"use client";

import {
  DOCUMENT_TYPE_LABELS,
  REASON_MAX_LENGTH,
  SEQUENTIAL_MAX,
  formatSequential,
  type FiscalSequenceView,
} from "@facturador/contracts";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { errorMessage } from "@/components/feedback";
import { fieldAria, FormDialog, FormField } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api";
import { ENVIRONMENT_LABELS } from "@/features/company/company-api";
import { pointLabel, useAdjustSequence } from "./sequences-api";

type FormValues = { nextNumber: string; reason: string };

const RANGE_MESSAGE = `El siguiente secuencial debe ser un número entero entre 1 y ${SEQUENTIAL_MAX}.`;

function parseNext(raw: string): number | null {
  const value = raw.trim();
  if (!/^[0-9]{1,9}$/.test(value)) return null;
  const parsed = Number(value);
  return parsed >= 1 && parsed <= SEQUENTIAL_MAX ? parsed : null;
}

function consequence(current: number, next: number | null): string | null {
  if (next === null || next === current) return null;
  if (next > current) {
    return next === current + 1
      ? `El número ${current} no se usará.`
      : `Los números del ${current} al ${next - 1} no se usarán.`;
  }
  return "Retrocedes el secuencial. Los números reservados no se reutilizan.";
}

export function AdjustSequenceDialog({
  view,
  onOpenChange,
  onReload,
}: {
  view: FiscalSequenceView | null;
  onOpenChange: (open: boolean) => void;
  onReload: () => Promise<unknown>;
}) {
  const [error, setError] = useState<string>();
  const [conflict, setConflict] = useState(false);
  const current = view?.nextNumber ?? 1;
  const form = useForm<FormValues>({ values: { nextNumber: String(current), reason: "" } });
  const { errors } = form.formState;
  const rawNext = useWatch({ control: form.control, name: "nextNumber" });
  const next = parseNext(rawNext ?? "");
  const decreasing = next !== null && next < current;

  const close = () => {
    onOpenChange(false);
    setError(undefined);
    setConflict(false);
  };
  const adjust = useAdjustSequence({
    onSuccess: close,
    onError: (cause) => {
      if (cause instanceof ApiError && cause.code === "SEQUENCE_NUMBER_RESERVED") {
        form.setError("nextNumber", { message: cause.message }, { shouldFocus: true });
        return true;
      }
      if (cause instanceof ApiError && cause.code === "SEQUENCE_CHANGED") {
        setError(cause.message);
        setConflict(true);
        return true;
      }
      if (cause instanceof ApiError && (cause.status === 400 || cause.status === 409)) {
        setError(errorMessage(cause));
        return true;
      }
      return false;
    },
  });

  return (
    <FormDialog
      open={view !== null}
      onOpenChange={(open) => (open ? onOpenChange(true) : close())}
      title="Ajustar el siguiente secuencial"
      {...(view
        ? {
            description: `${DOCUMENT_TYPE_LABELS[view.documentType]} · punto ${pointLabel(view)} · ${ENVIRONMENT_LABELS[view.environment]}`,
          }
        : {})}
      submitLabel="Guardar ajuste"
      pending={adjust.isPending || form.formState.isSubmitting}
      // El conflicto se explica junto a su acción, Recargar; el resto de errores, en el cuerpo.
      error={conflict ? undefined : error}
      onSubmit={form.handleSubmit((values) => {
        // El envío implícito con Enter tampoco duplica un ajuste pendiente.
        if (!view || adjust.isPending) return;
        setError(undefined);
        setConflict(false);
        const desired = parseNext(values.nextNumber);
        if (desired === null) {
          form.setError("nextNumber", { message: RANGE_MESSAGE }, { shouldFocus: true });
          return;
        }
        if (view.lastReserved !== null && desired <= view.lastReserved) {
          form.setError(
            "nextNumber",
            {
              message: `El último secuencial reservado es ${view.lastReserved}; el siguiente debe ser mayor.`,
            },
            { shouldFocus: true },
          );
          return;
        }
        const reason = values.reason.trim();
        if (desired < current && !reason) {
          form.setError(
            "reason",
            { message: "Retroceder el secuencial exige un motivo." },
            { shouldFocus: true },
          );
          return;
        }
        adjust.mutate({
          view,
          input: {
            nextNumber: desired,
            expectedNextNumber: current,
            ...(desired < current ? { reason } : {}),
          },
        });
      })}
    >
      {view && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-foreground-muted">Siguiente vigente</dt>
          <dd>{formatSequential(current)}</dd>
          <dt className="text-foreground-muted">Último reservado</dt>
          <dd>{view.lastReserved === null ? "—" : formatSequential(view.lastReserved)}</dd>
        </dl>
      )}
      <FormField
        id="sequence-next"
        label="Siguiente secuencial"
        hint={`Un número entero entre 1 y ${SEQUENTIAL_MAX}.`}
        error={errors.nextNumber?.message}
      >
        <Input
          {...fieldAria("sequence-next", errors.nextNumber?.message, "hint")}
          {...form.register("nextNumber")}
          inputMode="numeric"
          autoComplete="off"
          maxLength={9}
          className="max-w-80"
        />
      </FormField>
      {/* Lo que pasará con el cambio se ve siempre: no es una ayuda, es su consecuencia. */}
      {!errors.nextNumber && consequence(current, next) && (
        <p role="status" className="-mt-2 text-sm text-foreground">
          {consequence(current, next)}
        </p>
      )}
      {decreasing && (
        <FormField id="sequence-reason" label="Motivo" error={errors.reason?.message}>
          <Input
            {...fieldAria("sequence-reason", errors.reason?.message)}
            {...form.register("reason")}
            maxLength={REASON_MAX_LENGTH}
            autoComplete="off"
          />
        </FormField>
      )}
      {conflict && (
        <div
          role="alert"
          className="flex flex-col items-start gap-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm"
        >
          <p>{error}</p>
          <Button
            variant="outline"
            size="legacy-sm"
            onClick={() =>
              void onReload().then(() => {
                setError(undefined);
                setConflict(false);
              })
            }
          >
            Recargar
          </Button>
        </div>
      )}
    </FormDialog>
  );
}
