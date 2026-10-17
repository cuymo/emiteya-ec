// Presentación canónica del estado de los comprobantes (productize-invoice-list-and-shared-table-
// foundation, design D12; decisión PO-1 del propietario). Sobre el `Badge` derivado de la plantilla,
// adaptado de la insignia de estado de `src/app/(main)/dashboard/tasks/_components/columns.tsx`
// (MIT; frontend/THIRD_PARTY_NOTICES.md) a variantes semánticas con tokens, no clases de paleta.
// - Texto del glosario e icono: el estado nunca depende solo del color.
// - «Verificando con el SRI» es información, nunca un rechazo, y explica que no hay que volver a
//   emitir la venta. «Requiere revisión» es una advertencia, distinta de «Devuelto» y «No
//   autorizado».
// - La transmisión detenida es un indicador operativo aparte, no un estado fiscal.
// - `StateCell` es la fachada que usan las pantallas de comprobantes: todas muestran este mapeo sin
//   cambiar su estructura. Los enums del backend no cambian.
"use client";

import {
  INVOICE_ATTENTION_STATES,
  INVOICE_STATE_LABELS,
  type InvoiceState,
} from "@facturador/contracts";
import {
  BadgeCheck,
  Ban,
  CircleHelp,
  CirclePause,
  Clock3,
  FileCheck2,
  Hourglass,
  PencilLine,
  SearchCheck,
  TriangleAlert,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type DocumentStateVariant = "info" | "success" | "warning" | "destructive";

/** Mapeo aprobado por el propietario: texto, variante semántica e icono de cada estado. */
export const DOCUMENT_STATE_PRESENTATION: Record<
  InvoiceState,
  { label: string; variant: DocumentStateVariant; icon: LucideIcon }
> = {
  RESERVED: { label: INVOICE_STATE_LABELS.RESERVED, variant: "info", icon: Hourglass },
  SIGNED: { label: INVOICE_STATE_LABELS.SIGNED, variant: "info", icon: FileCheck2 },
  SEND_UNKNOWN: { label: INVOICE_STATE_LABELS.SEND_UNKNOWN, variant: "info", icon: SearchCheck },
  RECEIVED: { label: INVOICE_STATE_LABELS.RECEIVED, variant: "info", icon: Clock3 },
  RETURNED: { label: INVOICE_STATE_LABELS.RETURNED, variant: "destructive", icon: Undo2 },
  AUTHORIZED: { label: INVOICE_STATE_LABELS.AUTHORIZED, variant: "success", icon: BadgeCheck },
  NOT_AUTHORIZED: { label: INVOICE_STATE_LABELS.NOT_AUTHORIZED, variant: "destructive", icon: Ban },
  MANUAL_REVIEW: {
    label: INVOICE_STATE_LABELS.MANUAL_REVIEW,
    variant: "warning",
    icon: TriangleAlert,
  },
};

export const SEND_UNKNOWN_HELP = "El envío pudo haber llegado. No emitas esta venta nuevamente.";

/** La regla del servidor para «Requiere atención» (`attention=true`), sin ampliarla. */
export function requiresAttention(document: {
  state: InvoiceState;
  transmissionStopped: boolean;
}): boolean {
  return (
    (INVOICE_ATTENTION_STATES as readonly InvoiceState[]).includes(document.state) ||
    document.transmissionStopped
  );
}

/** Ayuda breve de «Verificando con el SRI»: con foco, con el puntero o con un toque. */
function SendUnknownHelp() {
  const helpId = useId();
  const [open, setOpen] = useState(false);
  return (
    <>
      <span id={helpId} className="sr-only">
        {SEND_UNKNOWN_HELP}
      </span>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Qué significa «Verificando con el SRI»"
            aria-describedby={helpId}
            className="text-muted-foreground"
            onClick={() => setOpen((current) => !current)}
          >
            <CircleHelp aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent className="max-w-64">{SEND_UNKNOWN_HELP}</TooltipContent>
      </Tooltip>
    </>
  );
}

export function DocumentStatusBadge({ state }: { state: InvoiceState }) {
  const { label, variant, icon: Icon } = DOCUMENT_STATE_PRESENTATION[state];
  return (
    <span className="inline-flex items-center gap-0.5">
      <Badge variant={variant} data-document-state={state}>
        <Icon aria-hidden="true" />
        {label}
      </Badge>
      {state === "SEND_UNKNOWN" && <SendUnknownHelp />}
    </span>
  );
}

/** La transmisión agotó sus intentos y espera al administrador; el estado fiscal no cambia. */
export function TransmissionStoppedBadge() {
  return (
    <Badge variant="warning">
      <CirclePause aria-hidden="true" />
      Transmisión detenida
    </Badge>
  );
}

/** Marca discreta de «Requiere atención», con nombre accesible; no colorea la fila. */
export function AttentionMarker({ className }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="Requiere atención"
      title="Requiere atención"
      className={cn("inline-block size-2 shrink-0 rounded-full bg-warning", className)}
    />
  );
}

/**
 * Estado de un comprobante con su indicador de transmisión detenida. Es lo que las pantallas de
 * comprobantes usan como `StateCell` (fachada, PO-1).
 */
export function StateCell({
  state,
  stopped = false,
}: {
  state: InvoiceState;
  /** La transmisión se detuvo y espera una decisión del administrador. */
  stopped?: boolean;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <DocumentStatusBadge state={state} />
      {stopped && <TransmissionStoppedBadge />}
    </span>
  );
}

/**
 * Un borrador en la lista de su tipo (unify-drafts-into-document-lists, design D5): todavía no es un
 * comprobante, así que su insignia es neutra, con su icono y su texto.
 */
export function DraftStateBadge() {
  return (
    <Badge variant="neutral" data-document-state="DRAFT">
      <PencilLine aria-hidden="true" />
      Borrador
    </Badge>
  );
}
