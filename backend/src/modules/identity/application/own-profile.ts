// Perfil y avatar propios (redesign-account-profile, design D1, D4, D5 y D6). El usuario sale siempre
// del contexto de la sesión: ninguna operación recibe un identificador, así que cambiar un id no
// alcanza a otra cuenta. El avatar es privado de su dueño y no se audita.
import { createHash } from "node:crypto";
import { changeOwnNameSchema, type OwnProfile } from "@facturador/contracts";
import { AppError, NotFoundError } from "../../../platform/http/errors.ts";
import {
  IMAGE_MAX_DIMENSION,
  formatKilobytes,
  inspectImage,
  type ImageInspection,
  type ImageMimeType,
} from "../../../platform/images/inspection.ts";
import { UserNotFoundError, parseInput, type Authorizer } from "./authorization.ts";
import type { MembershipReader } from "./memberships.ts";
import type { RequestContext } from "./request-context.ts";
import type { UnitOfWork } from "./unit-of-work.ts";

export type StoredAvatar = Readonly<{
  mimeType: ImageMimeType;
  sizeBytes: number;
  sha256: string;
  content: Uint8Array;
  updatedAt: Date;
}>;

/** El avatar de cada identidad: una fila como máximo, que la misma imagen no duplica. */
export interface AvatarStore {
  find(userId: string): Promise<StoredAvatar | null>;
  save(userId: string, avatar: StoredAvatar): Promise<void>;
  remove(userId: string): Promise<void>;
}

const AVATAR_REJECTIONS: Record<Exclude<ImageInspection, { ok: true }>["reason"], string> = {
  UNSUPPORTED_FORMAT: "La foto debe ser una imagen PNG o JPEG.",
  UNREADABLE: "No pudimos leer la imagen. Prueba con otra foto PNG o JPEG.",
  DIMENSIONS_TOO_LARGE: `La foto debe medir como máximo ${IMAGE_MAX_DIMENSION} px por lado.`,
};

export const invalidAvatar = (reason: keyof typeof AVATAR_REJECTIONS) =>
  new AppError("INVALID_AVATAR", 400, AVATAR_REJECTIONS[reason]);
export const avatarTooLarge = (maxBytes: number) =>
  new AppError(
    "AVATAR_TOO_LARGE",
    413,
    `La foto supera el límite de ${formatKilobytes(maxBytes)}.`,
  );
export const avatarNotFound = () =>
  new NotFoundError("AVATAR_NOT_FOUND", "No tienes una foto de perfil.");

/** La versión del avatar en su URL: los primeros 16 caracteres de su SHA-256. */
const versionOf = (avatar: StoredAvatar) => avatar.sha256.slice(0, 16);

export function createOwnProfile(deps: {
  memberships: MembershipReader;
  avatars: AvatarStore;
  authorizer: Authorizer;
  avatarMaxBytes: number;
  /** El nombre propio y su auditoría, en una transacción (design D3). */
  uow?: UnitOfWork;
  now?: () => Date;
}) {
  const now = deps.now ?? (() => new Date());

  async function profileOf(ctx: RequestContext): Promise<OwnProfile> {
    const member = await deps.memberships.findInCompany(ctx.companyId, ctx.userId);
    if (!member) throw new UserNotFoundError();
    const avatar = await deps.avatars.find(ctx.userId);
    return {
      name: member.name,
      email: member.email,
      role: member.role,
      membershipStatus: member.status,
      memberSince: member.createdAt.toISOString(),
      avatar: avatar ? { version: versionOf(avatar) } : null,
      avatarMaxBytes: deps.avatarMaxBytes,
    };
  }

  return {
    async profile(ctx: RequestContext): Promise<OwnProfile> {
      deps.authorizer.requirePermission(ctx, "account.read");
      return profileOf(ctx);
    },

    /**
     * Cambia el nombre propio (design D3): compara y cambia en una transacción, con el evento
     * `user.name_changed` en la empresa activa. El mismo nombre no cambia nada ni deja evento.
     */
    async changeName(ctx: RequestContext, body: unknown): Promise<OwnProfile> {
      deps.authorizer.requirePermission(ctx, "account.updateProfile");
      const { name } = parseInput(changeOwnNameSchema, body);
      const uow = deps.uow;
      if (!uow) throw new Error("El cambio del nombre necesita la unidad de trabajo");
      await uow.run(async (scope) => {
        const before = await scope.identity.findUserName(ctx.userId);
        if (before === null) throw new UserNotFoundError();
        if (before === name) return;
        if (!(await scope.identity.renameUser(ctx.userId, before, name))) return;
        await scope.audit.append({
          companyId: ctx.companyId,
          actor: { type: "USER", userId: ctx.userId },
          action: "user.name_changed",
          targetUserId: ctx.userId,
          changes: { from: before, to: name },
          correlationId: ctx.requestId,
        });
      });
      return profileOf(ctx);
    },

    async readAvatar(ctx: RequestContext): Promise<StoredAvatar> {
      deps.authorizer.requirePermission(ctx, "account.read");
      const avatar = await deps.avatars.find(ctx.userId);
      if (!avatar) throw avatarNotFound();
      return avatar;
    },

    /** Carga o reemplaza el avatar; la misma imagen dos veces deja una sola fila con ella. */
    async replaceAvatar(ctx: RequestContext, content: Uint8Array): Promise<OwnProfile> {
      deps.authorizer.requirePermission(ctx, "account.updateProfile");
      if (content.length > deps.avatarMaxBytes) throw avatarTooLarge(deps.avatarMaxBytes);
      const inspection = inspectImage(content);
      if (!inspection.ok) throw invalidAvatar(inspection.reason);
      await deps.avatars.save(ctx.userId, {
        mimeType: inspection.mimeType,
        sizeBytes: content.length,
        sha256: createHash("sha256").update(content).digest("hex"),
        content,
        updatedAt: now(),
      });
      return profileOf(ctx);
    },

    async removeAvatar(ctx: RequestContext): Promise<OwnProfile> {
      deps.authorizer.requirePermission(ctx, "account.updateProfile");
      await deps.avatars.remove(ctx.userId);
      return profileOf(ctx);
    },
  };
}

export type OwnProfileService = ReturnType<typeof createOwnProfile>;
