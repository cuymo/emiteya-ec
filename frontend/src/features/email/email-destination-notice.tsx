// Destino del correo en la confirmación «Emitir» (add-email-delivery, design D14; spec email-delivery,
// «Destino del correo al emitir»): a qué direcciones irá el correo automático del comprobante, o por
// qué no saldrá. Decide en el mismo orden que el servidor: el envío apagado en la instalación, sin
// servidor, el envío automático apagado, el ambiente de Pruebas (solo al correo de prueba), y los
// correos del receptor o, sin ellos, el RIDE impreso. El operador lo ve sin datos del servidor de
// correo (`GET /email/availability`). Los correos del receptor solo se consultan si el correo va a
// salir hacia él.
"use client";

import { partyViewSchema } from "@facturador/contracts";
import { useQueries } from "@tanstack/react-query";
import { ExternalLink, Mail, MailX } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useEnvironmentState } from "@/features/company/company-api";
import { PARTIES_KEY } from "@/features/parties/parties-api";
import { useEmailAvailability, useEmailRecipients } from "./email-api";

/** Un tercero receptor del comprobante, como lo conoce el borrador. */
export type EmailReceiver = Readonly<{ id: string; legalName: string }>;

export type EmailReceivers =
  /** Factura, retención, liquidación y guía: los terceros que recibirán el correo. */
  | Readonly<{ parties: readonly EmailReceiver[]; consumerFinal?: boolean }>
  /** Notas de crédito y de débito: el comprador de la factura que modifican. */
  | Readonly<{ invoiceId: string }>;

const PRINTED = "Entrega el RIDE impreso si lo pide.";

function Notice({ sending, children }: { sending: boolean; children: ReactNode }) {
  const Icon = sending ? Mail : MailX;
  return (
    <div
      data-slot="email-destination-notice"
      className="flex items-start gap-2 rounded-md border border-border bg-surface-subtle px-3 py-2 text-sm text-foreground"
    >
      <Icon
        aria-hidden="true"
        className={cn("mt-0.5 size-4 shrink-0", sending ? "text-info" : "text-foreground-muted")}
      />
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
}

export function EmailDestinationNotice({
  open,
  receivers,
}: {
  /** Si la confirmación está abierta: antes no consulta nada. */
  open: boolean;
  receivers: EmailReceivers;
}) {
  const environment = useEnvironmentState();
  const availability = useEmailAvailability(open);
  const ready = availability.data;
  // El correo va hacia el receptor solo en Producción, con el envío y el servidor listos.
  const towardReceiver =
    open &&
    ready !== undefined &&
    ready.deliveryEnabled &&
    ready.configured &&
    ready.autoSend &&
    environment === "PRODUCTION";
  // Un tercero que es destinatario y transportista de una guía se consulta una vez.
  const parties = ("parties" in receivers ? receivers.parties : []).filter(
    (party, index, all) => all.findIndex((other) => other.id === party.id) === index,
  );
  const consumerFinal = "parties" in receivers && receivers.consumerFinal === true;
  const invoiceId = "invoiceId" in receivers ? receivers.invoiceId : null;
  const partyQueries = useQueries({
    queries: parties.map((party) => ({
      queryKey: [...PARTIES_KEY, "detail", party.id],
      enabled: towardReceiver && !consumerFinal,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        apiFetch(`/parties/${encodeURIComponent(party.id)}`, { schema: partyViewSchema, signal }),
    })),
  });
  const invoiceRecipients = useEmailRecipients(
    invoiceId ?? "",
    towardReceiver && invoiceId !== null,
  );

  if (!open) return null;
  if (availability.isError || environment === "UNKNOWN") {
    return <Notice sending={false}>No pudimos saber si se enviará por correo.</Notice>;
  }
  if (!ready || environment === "PENDING") {
    return <Notice sending={false}>Consultando el envío por correo…</Notice>;
  }
  if (!ready.deliveryEnabled) {
    return (
      <Notice sending={false}>
        No se enviará por correo: el envío de correos está apagado en esta instalación.
      </Notice>
    );
  }
  if (!ready.configured) {
    return (
      <Notice sending={false}>
        No se enviará por correo: la empresa no tiene un servidor de correo configurado.
      </Notice>
    );
  }
  if (!ready.autoSend) {
    return (
      <Notice sending={false}>
        No se enviará por correo automáticamente: el envío automático está apagado. Podrás enviarlo
        desde su detalle.
      </Notice>
    );
  }
  if (environment === "TEST") {
    return ready.testRecipient ? (
      <Notice sending>
        Pruebas: el correo irá solo al correo de prueba {ready.testRecipient}, no al receptor.
      </Notice>
    ) : (
      <Notice sending={false}>
        No se enviará por correo: falta el correo de prueba para los comprobantes del ambiente de
        Pruebas.
      </Notice>
    );
  }
  if (consumerFinal) {
    return (
      <Notice sending={false}>
        No se enviará por correo: es una venta a consumidor final. {PRINTED}
      </Notice>
    );
  }

  let addresses: string[];
  if (invoiceId !== null) {
    if (invoiceRecipients.isError) {
      return <Notice sending={false}>No pudimos saber si se enviará por correo.</Notice>;
    }
    if (!invoiceRecipients.data) {
      return <Notice sending={false}>Consultando el envío por correo…</Notice>;
    }
    addresses = invoiceRecipients.data.recipients;
  } else {
    if (partyQueries.some((query) => query.isError)) {
      return <Notice sending={false}>No pudimos saber si se enviará por correo.</Notice>;
    }
    if (partyQueries.some((query) => !query.data)) {
      return <Notice sending={false}>Consultando el envío por correo…</Notice>;
    }
    // Sin repetir, sin distinguir mayúsculas, en el orden de los terceros, como el servidor.
    const seen = new Set<string>();
    addresses = partyQueries
      .flatMap((query) => query.data!.emails)
      .filter((address) => {
        const key = address.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  if (addresses.length > 0) {
    return <Notice sending>Se enviará por correo a: {addresses.join(", ")}.</Notice>;
  }
  if (invoiceId !== null) {
    return (
      <Notice sending={false}>
        No se enviará por correo: el comprador de la factura no tiene correo. {PRINTED}
      </Notice>
    );
  }
  if (parties.length === 1) {
    const party = parties[0]!;
    return (
      <Notice sending={false}>
        No se enviará por correo: {party.legalName} no tiene correo. {PRINTED}{" "}
        <Link
          href={`/terceros/${encodeURIComponent(party.id)}`}
          target="_blank"
          rel="noopener"
          className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
        >
          Agregar su correo
          <ExternalLink aria-hidden="true" className="size-3.5" />
          <span className="sr-only">(se abre en otra pestaña)</span>
        </Link>
      </Notice>
    );
  }
  return (
    <Notice sending={false}>
      No se enviará por correo: ninguno de sus receptores tiene correo. Entrega el RIDE impreso si
      lo piden.
    </Notice>
  );
}
