// Avatares propios en `user_avatar` (redesign-account-profile, design D4): una fila por identidad,
// con su clave primaria, así que una carga es un upsert y dos a la vez dejan una sola fila.
import type { DbClient } from "../../../platform/db/database.ts";
import type { ImageMimeType } from "../../../platform/images/inspection.ts";
import type { AvatarStore } from "../application/own-profile.ts";

export function createPrismaAvatars(prisma: DbClient): AvatarStore {
  return {
    async find(userId) {
      const row = await prisma.userAvatar.findUnique({ where: { userId } });
      if (!row) return null;
      return {
        mimeType: row.mimeType as ImageMimeType,
        sizeBytes: row.sizeBytes,
        sha256: row.sha256,
        content: row.content,
        updatedAt: row.updatedAt,
      };
    },
    async save(userId, avatar) {
      const data = {
        mimeType: avatar.mimeType,
        sizeBytes: avatar.sizeBytes,
        sha256: avatar.sha256,
        content: Buffer.from(avatar.content),
        updatedAt: avatar.updatedAt,
      };
      await prisma.userAvatar.upsert({
        where: { userId },
        create: { userId, ...data },
        update: data,
      });
    },
    async remove(userId) {
      await prisma.userAvatar.deleteMany({ where: { userId } });
    },
  };
}
