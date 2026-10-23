// Tarjeta «Correo» de la pestaña de documentos (add-email-delivery, design D14), en los seis
// detalles. Usuario: administrador u operador. Objetivo: saber si el comprobante salió por correo y
// volver a enviarlo si hace falta. P0: el estado del último envío con su motivo y «Reenviar correo».
// P1: sus direcciones con su resultado y la nota de Pruebas. P2: el historial plegable con los
// intentos. «Enviado» es que el servidor de correo lo aceptó, nunca que el receptor lo recibió.
"use client";

import type { DocumentType, EmailDeliveryView } from "@facturador/contracts";
import { FlaskConical, Printer, Send } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { useSession } from "@/components/session";
import { ErrorState, Skeleton } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { canSee } from "@/lib/permissions";
import { useDocumentEmailDeliveries } from "@/features/email/email-api";
import {
  EMAIL_ATTEMPT_OUTCOME_LABELS,
  EMAIL_ORIGIN_LABELS,
  EMAIL_STATUS_PRESENTATION,
  recipientOutcomeLabel,
} from "@/features/email/email-format";
import { ResendEmailDialog } from "@/features/email/resend-email-dialog";
import { formatDateTime } from "@/features/invoices/invoice-format";

/** Lo que dice el estado cuando el servidor no da un motivo propio. */
const STATUS_NOTES: Partial<Record<EmailDeliveryView["status"], string>> = {
  PENDING: "Saldrá en unos segundos.",
  SENT: "El servidor de correo lo aceptó. No confirma que llegó al buzón del receptor.",
};

export function EmailStatusBadge({ status }: { status: EmailDeliveryView["status"] }) {
  const { label, variant, icon: Icon } = EMAIL_STATUS_PRESENTATION[status];
  return (
    <Badge variant={variant} data-email-status={status}>
      <Icon aria-hidden="true" />
      {label}
    </Badge>
  );
}

/** Quién y cuándo: «Automático · …» o «Reenvío de Ana Admin · …». */
function originLine(delivery: EmailDeliveryView): string {
  const origin =
    delivery.origin === "MANUAL" && delivery.requestedBy
      ? `${EMAIL_ORIGIN_LABELS.MANUAL} de ${delivery.requestedBy.name}`
      : EMAIL_ORIGIN_LABELS[delivery.origin];
  return `${origin} · ${formatDateTime(delivery.sentAt ?? delivery.createdAt)}`;
}

function Recipients({ delivery }: { delivery: EmailDeliveryView }) {
  if (delivery.recipients.length === 0) return null;
  return (
    <ul aria-label="Direcciones" className="flex flex-col gap-1 text-sm">
      {delivery.recipients.map((recipient) => (
        <li key={recipient.address} className="flex flex-col">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="break-all">{recipient.address}</span>
            <span className="text-foreground-muted">
              {recipientOutcomeLabel(recipient.outcome)}
            </span>
          </span>
          {recipient.reason && <span className="text-danger">{recipient.reason}</span>}
        </li>
      ))}
    </ul>
  );
}

function TestNote() {
  return (
    <p className="flex gap-2 text-sm text-foreground-muted">
      <FlaskConical aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      Ambiente de Pruebas: fue solo al correo de prueba, no al receptor.
    </p>
  );
}

/** Historial plegable: cada envío con su estado, sus direcciones y sus intentos. */
function EmailHistory({ deliveries }: { deliveries: EmailDeliveryView[] }) {
  return (
    <details className="rounded-lg border border-border bg-surface">
      <summary className="flex min-h-11 cursor-pointer items-center px-3 font-medium">
        Historial de envíos
      </summary>
      <ol
        aria-label="Historial de envíos"
        className="flex flex-col gap-3 border-t border-border px-3 py-2 text-sm"
      >
        {deliveries.map((delivery) => (
          <li key={delivery.id} className="flex flex-col gap-1 border-l-2 border-border pl-3">
            <span className="flex flex-wrap items-center gap-2">
              <EmailStatusBadge status={delivery.status} />
              <span className="text-foreground-muted">{originLine(delivery)}</span>
            </span>
            {delivery.reason && <span>{delivery.reason}</span>}
            <Recipients delivery={delivery} />
            {delivery.testRedirect && <TestNote />}
            {delivery.attempts.length > 0 && (
              <ol aria-label="Intentos" className="flex flex-col gap-0.5 text-foreground-muted">
                {delivery.attempts.map((attempt) => (
                  <li key={attempt.number}>
                    Intento {attempt.number} · {formatDateTime(attempt.at)} ·{" "}
                    {EMAIL_ATTEMPT_OUTCOME_LABELS[attempt.outcome]}
                    {attempt.smtpCode !== null && ` (código ${attempt.smtpCode})`}
                  </li>
                ))}
              </ol>
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}

export function EmailSection({
  documentId,
  documentType,
}: {
  documentId: string;
  documentType: DocumentType;
}) {
  const { me } = useSession();
  const headingId = useId();
  const canResend = canSee(me.role, "email.resend");
  const deliveries = useDocumentEmailDeliveries(documentId, true);
  // Cada apertura es una solicitud nueva, con su propia clave de idempotencia.
  const [dialog, setDialog] = useState({ open: false, opening: 0 });

  let body: ReactNode;
  if (deliveries.isPending) body = <Skeleton className="h-16 w-full" />;
  else if (deliveries.isError)
    body = (
      <ErrorState
        message="No pudimos cargar los envíos por correo."
        onRetry={() => void deliveries.refetch()}
      />
    );
  else {
    const latest = deliveries.data[0];
    body = latest ? (
      <>
        <div className="flex flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <EmailStatusBadge status={latest.status} />
            <span className="text-sm text-foreground-muted">{originLine(latest)}</span>
          </span>
          {(latest.reason ?? STATUS_NOTES[latest.status]) && (
            <p className="text-sm">{latest.reason ?? STATUS_NOTES[latest.status]}</p>
          )}
        </div>
        <Recipients delivery={latest} />
        {latest.testRedirect && <TestNote />}
      </>
    ) : (
      <p className="text-sm text-foreground-muted">Todavía no se envió por correo.</p>
    );
  }
  const sent = (deliveries.data?.length ?? 0) > 0;

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={headingId} className="text-base font-semibold">
          Correo
        </h3>
        {canResend && deliveries.isSuccess && (
          <Button
            variant="outline"
            onClick={() => setDialog((current) => ({ open: true, opening: current.opening + 1 }))}
          >
            <Send aria-hidden="true" />
            {sent ? "Reenviar correo" : "Enviar correo"}
          </Button>
        )}
      </div>
      {body}
      {documentType === "03" && (
        <p className="flex gap-2 text-sm text-foreground-muted">
          <Printer aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          Si entregas la liquidación impresa, imprime dos ejemplares del RIDE para que los firme el
          proveedor.
        </p>
      )}
      {sent && <EmailHistory deliveries={deliveries.data!} />}
      {canResend && (
        <ResendEmailDialog
          key={dialog.opening}
          open={dialog.open}
          onOpenChange={(open) => setDialog((current) => ({ ...current, open }))}
          documentId={documentId}
          resend={sent}
        />
      )}
    </section>
  );
}
