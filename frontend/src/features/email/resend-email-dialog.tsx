// Diálogo «Enviar correo» o «Reenviar correo» de un comprobante autorizado (add-email-delivery,
// design D14): las direcciones vigentes de su receptor, propuestas y editables (hasta 10, con agregar
// y quitar), o en Pruebas la nota de que irá solo al correo de prueba. La `Idempotency-Key` nace al
// abrir el diálogo y se reutiliza en sus reintentos: un doble clic o un reintento tras un error de
// red no envían dos correos. Si se cambian las direcciones después de un intento, es otra solicitud
// y lleva otra clave.
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { EMAIL_RESEND_MAX_RECIPIENTS, emailAddressSchema } from "@facturador/contracts";
import { FlaskConical, Plus, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useFieldArray, useForm, type UseFormReturn } from "react-hook-form";
import { z } from "zod";
import { AddRowButton } from "@/components/add-row-button";
import { RowActionButton } from "@/components/data-table/table-controls";
import { errorMessage } from "@/components/feedback";
import { fieldAria, FormDialog, FormField } from "@/components/form-dialog";
import { ErrorState, Skeleton } from "@/components/states";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api";
import { useEmailRecipients, useResendEmail } from "./email-api";
import { emailRowsSchema, toEmailRows } from "./email-rows";

const formSchema = z.object({
  recipients: emailRowsSchema({
    max: EMAIL_RESEND_MAX_RECIPIENTS,
    address: emailAddressSchema,
    tooMany: `Un envío admite como máximo ${EMAIL_RESEND_MAX_RECIPIENTS} correos.`,
    required: "Escribe al menos un correo.",
  }),
});
type FormInput = z.input<typeof formSchema>;
type FormOutput = z.output<typeof formSchema>;

const TEST_RECIPIENT_MISSING =
  "Este comprobante es del ambiente de Pruebas: configura el correo de prueba en Configuración → Correos para enviarlo.";

function RecipientRows({
  form,
  pending,
}: {
  form: UseFormReturn<FormInput, unknown, FormOutput>;
  pending: boolean;
}) {
  const { errors } = form.formState;
  const rows = useFieldArray({ control: form.control, name: "recipients" });
  const addRef = useRef<HTMLButtonElement>(null);
  // Quitar la décima dirección vuelve a mostrar «Agregar correo»: el foco va a él cuando aparece.
  const focusAdd = useRef(false);
  useEffect(() => {
    if (!focusAdd.current) return;
    focusAdd.current = false;
    addRef.current?.focus();
  });
  const legendId = useId();
  const full = rows.fields.length >= EMAIL_RESEND_MAX_RECIPIENTS;
  const listError = errors.recipients?.root?.message ?? errors.recipients?.message;

  return (
    <fieldset aria-labelledby={legendId} disabled={pending} className="flex min-w-0 flex-col gap-2">
      <span id={legendId} className="text-sm font-medium">
        Enviar a
      </span>
      {rows.fields.map((field, index) => {
        const id = `resend-email-${index}`;
        const error = errors.recipients?.[index]?.address?.message;
        return (
          <FormField
            key={field.id}
            id={id}
            label={`Correo ${index + 1}`}
            labelClassName="sr-only"
            error={error}
            action={
              rows.fields.length > 1 ? (
                <RowActionButton
                  icon={Trash2}
                  tone="danger"
                  label={`Quitar el correo ${index + 1}`}
                  onClick={() => {
                    rows.remove(index);
                    focusAdd.current = true;
                  }}
                />
              ) : undefined
            }
          >
            <Input
              {...fieldAria(id, error)}
              {...form.register(`recipients.${index}.address`)}
              type="email"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
            />
          </FormField>
        );
      })}
      {listError && (
        <p role="alert" className="text-xs text-danger">
          {listError}
        </p>
      )}
      {full ? (
        <p className="text-sm text-foreground-muted">
          Un envío admite hasta {EMAIL_RESEND_MAX_RECIPIENTS} correos.
        </p>
      ) : (
        <AddRowButton
          ref={addRef}
          onClick={() =>
            rows.append({ address: "" }, { focusName: `recipients.${rows.fields.length}.address` })
          }
        >
          <Plus aria-hidden="true" data-icon="inline-start" />
          Agregar correo
        </AddRowButton>
      )}
    </fieldset>
  );
}

export function ResendEmailDialog({
  open,
  onOpenChange,
  documentId,
  resend,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: string;
  /** Si el comprobante ya tiene un envío: «Reenviar correo»; si no, «Enviar correo». */
  resend: boolean;
}) {
  const [error, setError] = useState<string>();
  // Una clave por solicitud del diálogo: la misma en sus reintentos, otra si cambian las direcciones.
  const attempt = useRef<{ key: string; recipients: string } | null>(null);
  const proposed = useEmailRecipients(documentId, open);
  const data = proposed.data;
  // Las direcciones propuestas llenan el formulario al llegar, sin pisar lo que ya se escribió.
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(formSchema),
    defaultValues: { recipients: [] },
    ...(data ? { values: { recipients: toEmailRows(data.recipients) } } : {}),
    resetOptions: { keepDirtyValues: true },
  });
  const send = useResendEmail({
    documentId,
    onSuccess: () => onOpenChange(false),
    onError: (cause) => {
      if (cause instanceof ApiError && (cause.status === 400 || cause.status === 409)) {
        setError(errorMessage(cause));
        return true;
      }
      return false;
    },
  });
  const submit = (recipients: string[]) => {
    if (send.isPending) return;
    setError(undefined);
    const fingerprint = JSON.stringify(recipients);
    if (attempt.current?.recipients !== fingerprint) {
      attempt.current = { key: crypto.randomUUID(), recipients: fingerprint };
    }
    send.mutate({ recipients, key: attempt.current.key });
  };
  const title = resend ? "Reenviar correo" : "Enviar correo";

  let body;
  if (proposed.isPending) body = <Skeleton className="h-24 w-full" />;
  else if (proposed.isError)
    body = (
      <ErrorState
        message="No pudimos cargar los correos del receptor."
        onRetry={() => void proposed.refetch()}
      />
    );
  else if (data?.testRedirect)
    body = (
      <div
        role="note"
        className="flex gap-2 rounded-md border border-info/40 bg-info/10 px-3 py-2 text-sm"
      >
        <FlaskConical aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-info" />
        <p>
          {data.testRecipient
            ? `Este comprobante es del ambiente de Pruebas: el correo irá solo al correo de prueba ${data.testRecipient}, nunca al receptor.`
            : TEST_RECIPIENT_MISSING}
        </p>
      </div>
    );
  else if (data)
    body = (
      <>
        {data.recipients.length === 0 && (
          <p className="text-sm text-foreground-muted">
            El receptor no tiene correo registrado: escribe a qué dirección enviarlo.
          </p>
        )}
        <RecipientRows form={form} pending={send.isPending} />
      </>
    );

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description="El correo lleva el XML autorizado y el RIDE del comprobante."
      submitLabel={title}
      pending={send.isPending}
      error={error}
      onSubmit={(event) => {
        event.preventDefault();
        if (!data || proposed.isPending) return;
        if (data.testRedirect) {
          // En Pruebas el correo va solo al correo de prueba; sin él, no se envía.
          if (!data.testRecipient) setError(TEST_RECIPIENT_MISSING);
          else submit([data.testRecipient]);
          return;
        }
        void form.handleSubmit(({ recipients }) => submit(recipients))(event);
      }}
    >
      {body}
    </FormDialog>
  );
}
