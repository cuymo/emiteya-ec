// Rutas del logo bajo /api/v1 (design D5 y D12). PUT recibe la imagen como cuerpo binario, sin
// multipart, con un parser propio acotado por LOGO_MAX_BYTES; el formato real lo decide el contenido.
// GET sirve solo el logo vigente de la empresa del contexto, nunca un asset por identificador.
import express, { Router, type RequestHandler } from "express";
import { LOGO_UPLOAD_CONTENT_TYPES } from "@facturador/contracts";
import { AppError } from "../../../../platform/http/errors.ts";
import { contextOf } from "../../../identity/infrastructure/http/request-context.ts";
import { logoTooLarge } from "../../application/errors.ts";
import type { TaxpayerLogo } from "../../application/taxpayer-logo.ts";
import { toTaxpayerView } from "./taxpayer-router.ts";

function rawLogoBody(logoMaxBytes: number): RequestHandler {
  const parse = express.raw({ type: [...LOGO_UPLOAD_CONTENT_TYPES], limit: logoMaxBytes });
  return (req, res, next) => {
    if (!req.is([...LOGO_UPLOAD_CONTENT_TYPES])) {
      next(
        new AppError(
          "UNSUPPORTED_MEDIA_TYPE",
          415,
          "El logo debe enviarse como imagen PNG o JPEG.",
        ),
      );
      return;
    }
    parse(req, res, (error?: unknown) => {
      const type = (error as { type?: string } | undefined)?.type;
      next(type === "entity.too.large" ? logoTooLarge(logoMaxBytes) : error);
    });
  };
}

export function logoRouter({
  logo,
  logoMaxBytes,
}: {
  logo: TaxpayerLogo;
  logoMaxBytes: number;
}): Router {
  const router = Router();

  router.get("/taxpayer/logo", async (_req, res) => {
    const current = await logo.readLogo(contextOf(res));
    res
      .status(200)
      .type(current.mimeType)
      .set({
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-cache",
        ETag: `"${current.sha256}"`,
      })
      .send(Buffer.from(current.content));
  });

  router.put("/taxpayer/logo", rawLogoBody(logoMaxBytes), async (req, res) => {
    const body: unknown = req.body;
    const content = Buffer.isBuffer(body) ? body : Buffer.alloc(0);
    const stored = await logo.replaceLogo(contextOf(res), req.query, content);
    res.status(200).json({ data: toTaxpayerView(stored, logoMaxBytes) });
  });

  router.delete("/taxpayer/logo", async (req, res) => {
    const stored = await logo.removeLogo(contextOf(res), req.query);
    res.status(200).json({ data: toTaxpayerView(stored, logoMaxBytes) });
  });

  return router;
}
