// Rutas de la configuración tributaria bajo /api/v1 (design D12). Exigen el contexto de
// requireContext y responden con listas permitidas: nunca identificadores de assets ni bytes.
import { Router, type Response } from "express";
import type { TaxpayerView } from "@facturador/contracts";
import { contextOf } from "../../../identity/infrastructure/http/request-context.ts";
import type { StoredConfig } from "../../application/ports.ts";
import type { TaxpayerConfiguration } from "../../application/taxpayer-configuration.ts";
import { DEFAULT_ENVIRONMENT } from "../../domain/taxpayer-config.ts";

export function toTaxpayerView(stored: StoredConfig | null, logoMaxBytes: number): TaxpayerView {
  const logo = stored?.config.logo;
  return {
    configured: stored !== null,
    version: stored?.version ?? null,
    environment: stored?.config.environment ?? DEFAULT_ENVIRONMENT,
    taxIdentityLocked: stored?.taxIdentityLocked ?? false,
    profile: stored ? { ...stored.config.profile } : null,
    logo: logo ? { mimeType: logo.mimeType, sizeBytes: logo.sizeBytes, sha256: logo.sha256 } : null,
    logoMaxBytes,
    updatedAt: stored?.createdAt.toISOString() ?? null,
  };
}

function send<T>(res: Response, status: number, data: T) {
  res.status(status).json({ data });
}

export function taxpayerRouter({
  configuration,
  logoMaxBytes,
}: {
  configuration: TaxpayerConfiguration;
  logoMaxBytes: number;
}): Router {
  const router = Router();
  const view = (stored: StoredConfig | null) => toTaxpayerView(stored, logoMaxBytes);

  router.get("/taxpayer", async (_req, res) => {
    send(res, 200, view(await configuration.getTaxpayer(contextOf(res))));
  });

  router.put("/taxpayer", async (req, res) => {
    send(res, 200, view(await configuration.updateProfile(contextOf(res), req.body)));
  });

  router.put("/taxpayer/environment", async (req, res) => {
    send(res, 200, view(await configuration.changeEnvironment(contextOf(res), req.body)));
  });

  return router;
}
