// Datos del correo de los comprobantes (add-email-delivery, design D10 y D14): el servidor de correo
// de la empresa y su prueba, lo que la confirmación de la emisión necesita saber, y el historial, las
// direcciones propuestas y el reenvío de un comprobante. El reenvío lleva una `Idempotency-Key` que
// el diálogo genera al abrirse y reutiliza en sus reintentos.
"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import {
  IDEMPOTENCY_KEY_HEADER,
  emailAvailabilitySchema,
  emailDeliveryViewSchema,
  emailRecipientsViewSchema,
  emailSettingsResponseSchema,
  testEmailResultSchema,
  type DocumentState,
  type EmailDeliveryStatus,
  type EmailSettingsResponse,
  type UpdateEmailSettingsInput,
} from "@facturador/contracts";
import { z } from "zod";
import { errorMessage, toast, useMutationFeedback } from "@/components/feedback";
import { isUnauthenticated, useSession } from "@/components/session";
import { apiFetch } from "@/lib/api";
import { canSee } from "@/lib/permissions";
import { DOCUMENTS_KEY } from "@/features/archive/archive-api";
import { DASHBOARD_KEY } from "@/features/dashboard/dashboard-api";

export const EMAIL_SETTINGS_KEY = ["email", "settings"] as const;
export const EMAIL_AVAILABILITY_KEY = ["email", "availability"] as const;
export const emailDeliveriesKey = (documentId: string) =>
  [...DOCUMENTS_KEY, "email-deliveries", documentId] as const;
export const emailRecipientsKey = (documentId: string) =>
  [...DOCUMENTS_KEY, "email-recipients", documentId] as const;

const documentPath = (id: string) => `/documents/${encodeURIComponent(id)}`;

/** Textos propios de los rechazos que `errorMessage` no pasa tal cual (el `429`). */
export const EMAIL_ERROR_MESSAGES: Record<string, string> = {
  EMAIL_TEST_RATE_LIMITED:
    "Puedes enviar hasta 5 correos de prueba por minuto. Espera un momento antes de probar otra vez.",
};

/**
 * Rechazos de la configuración que se muestran junto a su campo, no como aviso flotante. Un
 * `EMAIL_SETTINGS_CHANGED` tampoco es un aviso: la pantalla muestra su franja con «Recargar».
 */
export const EMAIL_SETTINGS_FIELD_ERRORS = {
  EMAIL_PLAINTEXT_NOT_ALLOWED: "security",
  EMAIL_PASSWORD_REQUIRED: "password",
  EMAIL_USERNAME_REQUIRED: "username",
} as const satisfies Record<string, keyof UpdateEmailSettingsInput>;

export function useEmailSettings(enabled: boolean) {
  return useQuery({
    queryKey: EMAIL_SETTINGS_KEY,
    enabled,
    queryFn: ({ signal }) =>
      apiFetch("/email/settings", { schema: emailSettingsResponseSchema, signal }),
  });
}

/** Para la confirmación de la emisión: también la lee el operador, sin datos del servidor. */
export function useEmailAvailability(enabled: boolean) {
  return useQuery({
    queryKey: EMAIL_AVAILABILITY_KEY,
    enabled,
    queryFn: ({ signal }) =>
      apiFetch("/email/availability", { schema: emailAvailabilitySchema, signal }),
  });
}

export function useSaveEmailSettings(options: {
  onSuccess: (response: EmailSettingsResponse) => void;
  onError: (error: unknown) => boolean;
}) {
  return useMutationFeedback({
    mutationFn: (input: UpdateEmailSettingsInput) =>
      apiFetch("/email/settings", {
        method: "PUT",
        json: input,
        schema: emailSettingsResponseSchema,
      }),
    success: (response, input) =>
      input.expectedVersion !== null && response.settings?.version === input.expectedVersion
        ? "No había cambios que guardar."
        : "Guardaste el servidor de correo.",
    invalidate: [EMAIL_SETTINGS_KEY, EMAIL_AVAILABILITY_KEY],
    onSuccess: options.onSuccess,
    onError: options.onError,
  });
}

/**
 * El resultado de la prueba se muestra dentro de su diálogo, no en un aviso flotante: un `200` con
 * `accepted: false` es un rechazo del servidor de correo, no un error de la API. Solo un error que
 * el diálogo no muestra (`onError` devuelve false) va a un aviso.
 */
export function useSendTestEmail(options: { onError: (error: unknown) => boolean }) {
  return useMutation({
    mutationFn: (to: string) =>
      apiFetch("/email/test", { method: "POST", json: { to }, schema: testEmailResultSchema }),
    onError: (error) => {
      // La sesión vencida la resuelve el manejador global, que lleva al inicio de sesión.
      if (isUnauthenticated(error) || options.onError(error)) return;
      const message = errorMessage(error, EMAIL_ERROR_MESSAGES);
      toast.error(message, { id: message });
    },
  });
}

/** Mientras el último envío espera su intento, el historial se vuelve a consultar solo. */
const POLL_MS: Partial<Record<EmailDeliveryStatus, number>> = { PENDING: 5_000, RETRYING: 30_000 };

/**
 * El historial de envíos de un comprobante, del más reciente al más antiguo. Solo para un
 * comprobante autorizado: la tarjeta «Correo» y la atención de su pestaña comparten la consulta.
 */
export function useDocumentEmailDeliveries(documentId: string, enabled: boolean) {
  return useQuery({
    queryKey: emailDeliveriesKey(documentId),
    enabled,
    queryFn: ({ signal }) =>
      apiFetch(`${documentPath(documentId)}/email-deliveries`, {
        schema: z.array(emailDeliveryViewSchema),
        signal,
      }),
    refetchInterval: (query) => {
      const latest = query.state.data?.[0];
      return (latest && POLL_MS[latest.status]) ?? false;
    },
  });
}

/**
 * La pestaña de documentos pide atención cuando el último envío del comprobante falló. Sin el
 * comprobante todavía (mientras carga su detalle), no consulta.
 */
export function useEmailNeedsAttention(document: { id: string; state: DocumentState } | undefined) {
  const { me } = useSession();
  const enabled = document?.state === "AUTHORIZED" && canSee(me.role, "archive.read");
  const deliveries = useDocumentEmailDeliveries(document?.id ?? "", enabled);
  return enabled && deliveries.data?.[0]?.status === "FAILED";
}

/** Las direcciones propuestas para enviar o reenviar: los correos vigentes de sus receptores. */
export function useEmailRecipients(documentId: string, enabled: boolean) {
  return useQuery({
    queryKey: emailRecipientsKey(documentId),
    enabled,
    queryFn: ({ signal }) =>
      apiFetch(`${documentPath(documentId)}/email-recipients`, {
        schema: emailRecipientsViewSchema,
        signal,
      }),
  });
}

export function useResendEmail(options: {
  documentId: string;
  onSuccess: () => void;
  onError: (error: unknown) => boolean;
}) {
  return useMutationFeedback({
    mutationFn: ({ recipients, key }: { recipients: string[]; key: string }) =>
      apiFetch(`${documentPath(options.documentId)}/email-deliveries`, {
        method: "POST",
        json: { recipients },
        headers: { [IDEMPOTENCY_KEY_HEADER]: key },
        schema: emailDeliveryViewSchema,
      }),
    success: (delivery) =>
      delivery.testRedirect
        ? `Programaste el envío al correo de prueba ${delivery.recipients[0]?.address ?? ""}.`.trim()
        : "Programaste el envío del correo.",
    // `DOCUMENTS_KEY` abarca el historial y las direcciones del comprobante, y la bandeja.
    invalidate: [DOCUMENTS_KEY, DASHBOARD_KEY],
    onSuccess: options.onSuccess,
    onError: options.onError,
  });
}
