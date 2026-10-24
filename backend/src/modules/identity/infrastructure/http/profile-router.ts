// Perfil y avatar propios bajo /api/v1/me (redesign-account-profile, design D1 y D6). PUT recibe la
// imagen como cuerpo binario, sin multipart, con un parser acotado por AVATAR_MAX_BYTES; el formato
// real lo decide el contenido. GET sirve solo el avatar del usuario de la sesión.
import express, { Router, type RequestHandler } from "express";
import { AVATAR_UPLOAD_CONTENT_TYPES } from "@facturador/contracts";
import { AppError } from "../../../../platform/http/errors.ts";
import { avatarTooLarge, type OwnProfileService } from "../../application/own-profile.ts";
import { contextOf } from "./request-context.ts";

function rawAvatarBody(maxBytes: number): RequestHandler {
  const parse = express.raw({ type: [...AVATAR_UPLOAD_CONTENT_TYPES], limit: maxBytes });
  return (req, res, next) => {
    if (!req.is([...AVATAR_UPLOAD_CONTENT_TYPES])) {
      next(
        new AppError(
          "UNSUPPORTED_MEDIA_TYPE",
          415,
          "La foto debe enviarse como imagen PNG o JPEG.",
        ),
      );
      return;
    }
    parse(req, res, (error?: unknown) => {
      const type = (error as { type?: string } | undefined)?.type;
      next(type === "entity.too.large" ? avatarTooLarge(maxBytes) : error);
    });
  };
}

export function profileRouter({
  profile,
  avatarMaxBytes,
}: {
  profile: OwnProfileService;
  avatarMaxBytes: number;
}): Router {
  const router = Router();

  router.get("/me/profile", async (_req, res) => {
    res.status(200).json({ data: await profile.profile(contextOf(res)) });
  });

  router.put("/me/name", async (req, res) => {
    res.status(200).json({ data: await profile.changeName(contextOf(res), req.body) });
  });

  router.get("/me/avatar", async (_req, res) => {
    const avatar = await profile.readAvatar(contextOf(res));
    res
      .status(200)
      .type(avatar.mimeType)
      .set({
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-cache",
        ETag: `"${avatar.sha256}"`,
      })
      .send(Buffer.from(avatar.content));
  });

  router.put("/me/avatar", rawAvatarBody(avatarMaxBytes), async (req, res) => {
    const body: unknown = req.body;
    const content = Buffer.isBuffer(body) ? body : Buffer.alloc(0);
    res.status(200).json({ data: await profile.replaceAvatar(contextOf(res), content) });
  });

  router.delete("/me/avatar", async (_req, res) => {
    res.status(200).json({ data: await profile.removeAvatar(contextOf(res)) });
  });

  return router;
}
