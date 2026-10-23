// Presentación del correo de los comprobantes (add-email-delivery, design D14): el texto, la variante
// semántica y el icono de cada estado de un envío, para que el estado nunca dependa solo del color.
// «Enviado» significa que el servidor de correo lo aceptó, nunca que el receptor lo recibió.
import type { EmailDeliveryView, EmailDeliveryStatus, EmailSecurity } from "@facturador/contracts";
import {
  Clock3,
  MailCheck,
  MailMinus,
  MailQuestion,
  MailX,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";

export type EmailStatusVariant = "success" | "warning" | "info" | "destructive" | "neutral";

export const EMAIL_STATUS_PRESENTATION: Record<
  EmailDeliveryStatus,
  { label: string; variant: EmailStatusVariant; icon: LucideIcon }
> = {
  PENDING: { label: "Pendiente", variant: "info", icon: Clock3 },
  RETRYING: { label: "Reintentando", variant: "warning", icon: RefreshCw },
  SENT: { label: "Enviado", variant: "success", icon: MailCheck },
  FAILED: { label: "No enviado", variant: "destructive", icon: MailX },
  NO_RECIPIENT: { label: "Sin destinatario", variant: "neutral", icon: MailQuestion },
  DISABLED: { label: "Desactivado", variant: "neutral", icon: MailMinus },
};

type Delivery = EmailDeliveryView;
type RecipientOutcome = Delivery["recipients"][number]["outcome"];

export const EMAIL_ORIGIN_LABELS: Record<Delivery["origin"], string> = {
  AUTOMATIC: "Automático",
  MANUAL: "Reenvío",
};

/** Sin resultado todavía, la dirección espera el intento que la acepte o la rechace. */
export function recipientOutcomeLabel(outcome: RecipientOutcome): string {
  if (outcome === "ACCEPTED") return "Aceptada";
  if (outcome === "REJECTED") return "Rechazada";
  return "Pendiente";
}

export const EMAIL_ATTEMPT_OUTCOME_LABELS: Record<Delivery["attempts"][number]["outcome"], string> =
  {
    SENT: "Aceptado por el servidor",
    RETRYABLE: "Fallo temporal",
    DETERMINISTIC: "Fallo definitivo",
  };

export const EMAIL_SECURITY_LABELS: Record<EmailSecurity, string> = {
  TLS: "TLS directo (puerto 465)",
  STARTTLS: "STARTTLS (puerto 587)",
  NONE: "Sin cifrado (solo el buzón de pruebas)",
};

/** El puerto habitual de cada cifrado, que el formulario propone al cambiarlo. */
export const EMAIL_SECURITY_DEFAULT_PORTS: Record<EmailSecurity, number> = {
  TLS: 465,
  STARTTLS: 587,
  NONE: 1025,
};
