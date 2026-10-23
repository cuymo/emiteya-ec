// Rutas del correo bajo /api/v1 (add-email-delivery, design D10). La empresa sale de la sesión;
// ninguna respuesta incluye la contraseña del servidor de correo.
import { Router } from "express";
import type { EmailSettingsResponse } from "@facturador/contracts";
import { contextOf } from "../../../identity/infrastructure/http/request-context.ts";
import type { EmailSettings, EmailSettingsState } from "../../application/settings.ts";

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

export function emailRouter(settings: EmailSettings): Router {
  const router = Router();

  router.get("/email/settings", async (_req, res) => {
    res.status(200).json({ data: toEmailSettingsResponse(await settings.get(contextOf(res))) });
  });

  router.put("/email/settings", async (req, res) => {
    const state = await settings.update(contextOf(res), req.body);
    res.status(200).json({ data: toEmailSettingsResponse(state) });
  });

  return router;
}
