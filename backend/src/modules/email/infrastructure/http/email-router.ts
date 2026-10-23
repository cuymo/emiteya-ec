// Rutas del correo bajo /api/v1 (add-email-delivery, design D10). La empresa sale de la sesión;
// ninguna respuesta incluye la contraseña del servidor de correo.
import { Router } from "express";
import {
  IDEMPOTENCY_KEY_HEADER,
  documentIdParamsSchema,
  type EmailDeliveryView,
  type EmailSettingsResponse,
} from "@facturador/contracts";
import { readIdempotencyKey } from "../../../../platform/idempotency/idempotency.ts";
import { parseInput } from "../../../identity/application/authorization.ts";
import { contextOf } from "../../../identity/infrastructure/http/request-context.ts";
import type { DocumentDeliveries } from "../../application/document-deliveries.ts";
import type { EmailDeliveryHistoryEntry } from "../../application/ports.ts";
import type { EmailSettings, EmailSettingsState } from "../../application/settings.ts";
import type { TestEmail } from "../../application/test-email.ts";

export function toEmailSettingsResponse(state: EmailSettingsState): EmailSettingsResponse {
  const { settings } = state;
  return {
    settings: settings
      ? {
          host: settings.host,
          port: settings.port,
          security: settings.security,
          username: settings.username,
          passwordSet: settings.passwordSet,
          fromName: settings.fromName,
          fromAddress: settings.fromAddress,
          bccAddress: settings.bccAddress,
          autoSend: settings.autoSend,
          testRecipient: settings.testRecipient,
          version: settings.version,
          updatedAt: settings.updatedAt.toISOString(),
        }
      : null,
    deliveryEnabled: state.deliveryEnabled,
    plaintextAllowed: state.plaintextAllowed,
  };
}

/** Un envío para la API: sin el contenido del correo ni datos de la configuración. */
export function toEmailDeliveryView(entry: EmailDeliveryHistoryEntry): EmailDeliveryView {
  return {
    id: entry.id,
    origin: entry.origin,
    requestedBy: entry.origin === "MANUAL" ? { name: entry.requesterName ?? "" } : null,
    environment: entry.environment,
    testRedirect: entry.testRedirect,
    status: entry.status,
    recipients: entry.recipients.map((recipient) => ({ ...recipient })),
    reason: entry.failureReason,
    createdAt: entry.createdAt.toISOString(),
    sentAt: entry.sentAt?.toISOString() ?? null,
    finishedAt: entry.finishedAt?.toISOString() ?? null,
    attempts: entry.attempts.map((attempt) => ({
      number: attempt.number,
      at: attempt.at.toISOString(),
      outcome: attempt.outcome,
      smtpCode: attempt.smtpCode,
    })),
  };
}

export function emailRouter({
  settings,
  testEmail,
  documents,
}: {
  settings: EmailSettings;
  testEmail: TestEmail;
  documents: DocumentDeliveries;
}): Router {
  const router = Router();

  router.get("/email/settings", async (_req, res) => {
    res.status(200).json({ data: toEmailSettingsResponse(await settings.get(contextOf(res))) });
  });

  router.put("/email/settings", async (req, res) => {
    const state = await settings.update(contextOf(res), req.body);
    res.status(200).json({ data: toEmailSettingsResponse(state) });
  });

  router.post("/email/test", async (req, res) => {
    res.status(200).json({ data: await testEmail.send(contextOf(res), req.body) });
  });

  router.get("/documents/:documentId/email-deliveries", async (req, res) => {
    const { documentId } = parseInput(documentIdParamsSchema, req.params);
    const entries = await documents.list(contextOf(res), documentId);
    res.status(200).json({ data: entries.map(toEmailDeliveryView) });
  });

  router.get("/documents/:documentId/email-recipients", async (req, res) => {
    const { documentId } = parseInput(documentIdParamsSchema, req.params);
    res.status(200).json({ data: await documents.recipients(contextOf(res), documentId) });
  });

  router.post("/documents/:documentId/email-deliveries", async (req, res) => {
    const { documentId } = parseInput(documentIdParamsSchema, req.params);
    const key = readIdempotencyKey(req.headers[IDEMPOTENCY_KEY_HEADER.toLowerCase()]);
    const entry = await documents.resend(contextOf(res), documentId, key, req.body);
    res.status(202).json({ data: toEmailDeliveryView(entry) });
  });

  return router;
}
