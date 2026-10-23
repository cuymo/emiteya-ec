// Indicador del correo de un comprobante en la bandeja (add-email-delivery, design D14): el estado de
// su último envío junto al estado ante el SRI. En la fila es un icono con su nombre accesible; en la
// tarjeta del teléfono, donde no hay puntero para la ayuda, lleva también su texto. Sin envíos, nada.
import type { EmailDeliveryStatus } from "@facturador/contracts";
import { cn } from "@/lib/utils";
import { EMAIL_STATUS_PRESENTATION, type EmailStatusVariant } from "./email-format";

const TONE: Record<EmailStatusVariant, string> = {
  success: "text-success",
  warning: "text-warning",
  info: "text-info",
  destructive: "text-danger",
  neutral: "text-foreground-muted",
};

export function EmailIndicator({
  status,
  withLabel = false,
}: {
  status: EmailDeliveryStatus | null;
  withLabel?: boolean;
}) {
  if (status === null) return null;
  const { label, variant, icon: Icon } = EMAIL_STATUS_PRESENTATION[status];
  const name = `Correo: ${label.toLowerCase()}`;
  if (withLabel) {
    return (
      <span
        data-email-status={status}
        className={cn("inline-flex items-center gap-1 text-xs font-medium", TONE[variant])}
      >
        <Icon aria-hidden="true" className="size-3.5 shrink-0" />
        {name}
      </span>
    );
  }
  return (
    <span
      role="img"
      aria-label={name}
      title={name}
      data-email-status={status}
      className={cn("inline-flex shrink-0", TONE[variant])}
    >
      <Icon aria-hidden="true" className="size-4" />
    </span>
  );
}
