// Diálogo «Enviar correo de prueba» (add-email-delivery, design D14), como la carga de la firma:
// la dirección, y dentro del diálogo si el servidor de correo aceptó el correo o su motivo. La
// prueba usa el servidor guardado, no los cambios sin guardar del formulario.
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { sendTestEmailSchema } from "@facturador/contracts";
import { MailCheck, MailX } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { errorMessage } from "@/components/feedback";
import { fieldAria, FormDialog, FormField } from "@/components/form-dialog";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api";
import { EMAIL_ERROR_MESSAGES, useSendTestEmail } from "./email-api";

type FormInput = z.input<typeof sendTestEmailSchema>;
type FormOutput = z.output<typeof sendTestEmailSchema>;

/** Los rechazos que el diálogo explica dentro: el envío apagado, sin servidor o el límite. */
const SHOWN_INSIDE = new Set([400, 409, 429]);

export function TestEmailDialog({
  open,
  onOpenChange,
  defaultTo,
  unsavedChanges,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** El correo de prueba guardado o, sin él, el del administrador. */
  defaultTo: string;
  unsavedChanges: boolean;
}) {
  const [error, setError] = useState<string>();
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(sendTestEmailSchema),
    defaultValues: { to: defaultTo },
  });
  const { errors } = form.formState;
  const test = useSendTestEmail({
    onError: (cause) => {
      if (cause instanceof ApiError && SHOWN_INSIDE.has(cause.status)) {
        setError(errorMessage(cause, EMAIL_ERROR_MESSAGES));
        return true;
      }
      return false;
    },
  });
  const close = () => {
    form.reset({ to: defaultTo });
    setError(undefined);
    test.reset();
    onOpenChange(false);
  };
  const result = test.isPending || error ? undefined : test.data;

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title="Enviar correo de prueba"
      description="Comprueba que el servidor de correo guardado acepta los envíos de la empresa."
      submitLabel="Enviar prueba"
      pending={test.isPending || form.formState.isSubmitting}
      error={error}
      onSubmit={form.handleSubmit(({ to }) => {
        if (test.isPending) return;
        setError(undefined);
        test.mutate(to);
      })}
    >
      {unsavedChanges && (
        <p className="text-sm text-foreground-muted">
          Tienes cambios sin guardar: la prueba usa el servidor guardado.
        </p>
      )}
      <FormField id="test-email-to" label="Enviar a" error={errors.to?.message}>
        <Input
          {...fieldAria("test-email-to", errors.to?.message)}
          {...form.register("to")}
          type="email"
          autoComplete="email"
        />
      </FormField>
      {result &&
        (result.accepted ? (
          <div
            role="status"
            className="flex gap-2 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm"
          >
            <MailCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
            <p>
              {result.message} Revisa la bandeja de entrada de {result.to}; si no aparece, mira en
              el correo no deseado.
            </p>
          </div>
        ) : (
          <div
            role="alert"
            className="flex gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm"
          >
            <MailX aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
            <p>{result.message}</p>
          </div>
        ))}
    </FormDialog>
  );
}
