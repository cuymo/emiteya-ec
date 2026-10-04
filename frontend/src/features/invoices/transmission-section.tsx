// Sección "Transmisión al SRI" del detalle de una factura (add-sri-transmission, design D20).
// Usuario: el operador, para ver si la factura quedó autorizada; el administrador, para destrabar
// las que requieren atención. Decisión: si la factura está lista para entregarse o necesita una
// acción. P0: estado y acción "Reconciliar con el SRI" (solo el administrador, en un estado
// admitido); P1: mensajes del SRI y datos de la autorización; P2: historial plegable; P3
// (identificadores de intentos, cabeceras y tiempos técnicos): no se muestran. Nunca XML ni SOAP.
"use client";

import {
  INVOICE_STATE_LABELS,
  RECONCILIATION_REASON_MAX,
  requestReconciliationSchema,
  type InvoiceView,
  type SriMessageView,
  type TransmissionEventView,
} from "@facturador/contracts";
import { CirclePause, RefreshCw } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useSession } from "@/components/session";
import { ErrorState, Skeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { canSee } from "@/lib/permissions";
import { ENVIRONMENT_LABELS } from "@/features/company/company-api";
import { CAUSE_LABELS, OPERATION_LABELS, OUTCOME_LABELS, formatDateTime } from "./invoice-format";
import { useInvoiceTransmission, useRequestReconciliation } from "./invoices-api";

/** Qué significa el estado para el usuario, en una frase. */
const STATE_EXPLANATIONS: Record<InvoiceView["state"], string> = {
  RESERVED: "La factura todavía no está firmada: no se envía al SRI hasta completar la firma.",
  SIGNED: "La factura está firmada y espera su envío al SRI.",
  SEND_UNKNOWN:
    "No se pudo confirmar si el SRI recibió la factura. Se verifica con su misma clave antes de cualquier reenvío.",
  RECEIVED:
    "El SRI recibió la factura y está decidiendo su autorización; puede tardar hasta 24 horas.",
  RETURNED: "El SRI devolvió la factura. Revisa sus mensajes.",
  AUTHORIZED: "El SRI autorizó la factura: está lista para entregarse.",
  NOT_AUTHORIZED: "El SRI no autorizó la factura. Revisa sus mensajes.",
  MANUAL_REVIEW:
    "El resultado del SRI no se pudo resolver automáticamente: un administrador debe reconciliar la factura.",
};

/** Mensajes del SRI con su identificador, su texto, la información adicional y el tipo. */
function SriMessageList({
  messages,
  label,
}: {
  messages: readonly SriMessageView[];
  label: string;
}) {
  if (messages.length === 0) return null;
  return (
    <ul aria-label={label} className="flex flex-col gap-0.5 text-sm">
      {messages.map((message, index) => (
        <li key={index} className="rounded-md border border-border bg-surface px-1.5 py-1">
          <p className="break-words">
            {message.identifier && (
              <span className="font-medium tabular-nums">
                Código {message.identifier.trim()} ·{" "}
              </span>
            )}
            {message.message?.trim() || "Mensaje sin texto"}
            {message.type && (
              <span className="text-foreground-muted"> · {message.type.trim()}</span>
            )}
          </p>
          {message.additionalInformation?.trim() && (
            <p className="text-foreground-muted break-words">
              {message.additionalInformation.trim()}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

function eventTitle(event: TransmissionEventView): string {
  if (event.kind === "TRANSITION") {
    const to = INVOICE_STATE_LABELS[event.toState];
    return event.fromState ? `${INVOICE_STATE_LABELS[event.fromState]} → ${to}` : to;
  }
  return `${OPERATION_LABELS[event.operation]}: ${event.outcome ? OUTCOME_LABELS[event.outcome] : "pendiente de clasificar"}`;
}

function eventDetail(event: TransmissionEventView): string {
  if (event.kind === "TRANSITION") {
    const cause = CAUSE_LABELS[event.cause] ?? event.cause;
    return event.actor === "USER"
      ? `${cause} · ${event.actorName ?? "Administrador"}`
      : `${cause} · Sistema`;
  }
  return event.origin === "MANUAL" ? "Pedida por un administrador" : "Automática";
}

/** Historial plegable: transiciones e intentos resumidos, sin datos técnicos. */
function TransmissionHistory({ invoiceId }: { invoiceId: string }) {
  const [open, setOpen] = useState(false);
  const history = useInvoiceTransmission(invoiceId, open);
  let content: ReactNode = null;
  if (open) {
    if (history.isPending) content = <Skeleton className="h-8 w-full" />;
    else if (history.isError)
      content = (
        <ErrorState
          message="No pudimos cargar el historial."
          onRetry={() => void history.refetch()}
        />
      );
    else
      content = (
        <>
          <ol aria-label="Historial de la transmisión" className="flex flex-col gap-1">
            {history.data.events.map((event, index) => (
              <li key={index} className="flex flex-col gap-0.5 border-l-2 border-border pl-1.5">
                <span className="font-medium">{eventTitle(event)}</span>
                <span className="text-foreground-muted">
                  {formatDateTime(event.at)} · {eventDetail(event)}
                </span>
                {event.kind === "ATTEMPT" && (
                  <SriMessageList messages={event.messages} label="Mensajes del intento" />
                )}
              </li>
            ))}
          </ol>
          {history.data.total > history.data.events.length && (
            <p className="text-foreground-muted">
              Se muestran las {history.data.events.length} entradas más recientes de{" "}
              {history.data.total}.
            </p>
          )}
        </>
      );
  }
  return (
    <details
      className="rounded-lg border border-border bg-surface"
      onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}
    >
      <summary className="flex min-h-5.5 cursor-pointer items-center px-1.5 font-medium">
        Historial de la transmisión
      </summary>
      <div className="flex flex-col gap-1 border-t border-border px-1.5 py-1 text-sm">
        {content}
      </div>
    </details>
  );
}

export function TransmissionSection({ invoice }: { invoice: InvoiceView }) {
  const { me } = useSession();
  const headingId = useId();
  const canReconcile = canSee(me.role, "invoices.reconcile");
  const [confirming, setConfirming] = useState(false);
  const reconcile = useRequestReconciliation({ onSuccess: () => setConfirming(false) });
  const { transmission } = invoice;
  const authorization = transmission.authorization;
  const messages = transmission.lastResult?.messages ?? [];

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="text-lg font-semibold">
          Transmisión al SRI
        </h2>
        {canReconcile && transmission.reconcilable && (
          <Button onClick={() => setConfirming(true)}>
            <RefreshCw aria-hidden="true" />
            Reconciliar con el SRI
          </Button>
        )}
      </div>
      <p className="text-sm">
        {invoice.state === "MANUAL_REVIEW" && transmission.inProgress
          ? "La reconciliación está en curso: el estado se actualizará cuando el SRI responda."
          : STATE_EXPLANATIONS[invoice.state]}
        {transmission.inProgress && !["RESERVED", "MANUAL_REVIEW"].includes(invoice.state) && (
          <span className="text-foreground-muted"> Hay una interacción con el SRI en curso.</span>
        )}
      </p>
      {transmission.stopped && (
        <div
          role="status"
          className="flex items-start gap-1 rounded-md border border-warning/40 bg-warning/10 px-1.5 py-1 text-sm"
        >
          <CirclePause aria-hidden="true" className="mt-0.5 size-2 shrink-0" />
          <div className="flex flex-col gap-0.5">
            <p className="font-medium">La transmisión está detenida.</p>
            <p>{transmission.stopped.message}</p>
            <p className="text-foreground-muted">
              {formatDateTime(transmission.stopped.at)} ·{" "}
              {canReconcile && transmission.reconcilable
                ? "Reconcilia con el SRI para continuar."
                : "Un administrador puede reconciliarla con el SRI."}
            </p>
          </div>
        </div>
      )}
      {authorization && (
        <dl className="grid grid-cols-1 gap-x-3 gap-y-0.5 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="text-foreground-muted">Número de autorización</dt>
          <dd className="font-mono text-xs break-all">{authorization.number}</dd>
          <dt className="text-foreground-muted">Fecha de autorización</dt>
          <dd>{formatDateTime(authorization.authorizedAt)}</dd>
          <dt className="text-foreground-muted">Ambiente</dt>
          <dd>{ENVIRONMENT_LABELS[authorization.environment]}</dd>
        </dl>
      )}
      {messages.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <h3 className="text-sm font-medium">Mensajes del SRI</h3>
          <SriMessageList messages={messages} label="Mensajes del SRI" />
        </div>
      )}
      <TransmissionHistory invoiceId={invoice.id} />
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Reconciliar con el SRI"
        description={
          <p>
            Se consultará al SRI por la clave de la factura {invoice.documentNumber} y se aplicarán
            sus reglas: nunca se crea otro número, otra clave ni otro contenido, y solo se reenvía
            el mismo XML firmado si el SRI no conoce la factura y no hay evidencia de que la
            recibió.
          </p>
        }
        confirmLabel="Reconciliar"
        pending={reconcile.isPending}
        onConfirm={(reason) => {
          if (reason) reconcile.mutate({ id: invoice.id, reason });
        }}
        requiredText={{
          label: "Motivo",
          hint: "Queda en la auditoría.",
          maxLength: RECONCILIATION_REASON_MAX,
          validate: (text) =>
            requestReconciliationSchema.safeParse({ reason: text }).error?.issues[0]?.message ??
            null,
        }}
      />
    </section>
  );
}
