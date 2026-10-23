// Servidor de correo de la empresa (add-email-delivery, design D8 a D11; spec email-delivery,
// «Servidor de correo de la empresa»). Solo el administrador lo consulta y lo cambia. La contraseña
// se cifra con la clave maestra de custodia y nunca sale: la consulta dice si hay una guardada. Un
// guardado sin cambios no sube la versión ni audita; uno con cambios exige la versión vigente.
import { updateEmailSettingsSchema, type EmailAvailability } from "@facturador/contracts";
import { parseInput, type Authorizer } from "../../identity/application/authorization.ts";
import type { RequestContext } from "../../identity/application/request-context.ts";
import {
  settingsChanges,
  type EmailSettingsFields,
  type EmailSettingsRecord,
} from "../domain/settings.ts";
import {
  emailCustodyDisabled,
  emailPasswordRequired,
  emailPlaintextNotAllowed,
  emailSettingsChanged,
  emailUsernameRequired,
} from "./errors.ts";
import {
  SmtpPasswordUnavailableError,
  type EmailDeploymentPolicy,
  type EmailScope,
  type EmailSettingsRepository,
  type EmailUnitOfWork,
  type SealedSmtpPassword,
  type SmtpPasswordVault,
} from "./ports.ts";

export type EmailSettingsDependencies = Readonly<{
  settings: EmailSettingsRepository;
  uow: EmailUnitOfWork;
  authorizer: Authorizer;
  /** null si la instalación no tiene custodia de secretos. */
  vault: SmtpPasswordVault | null;
  policy: EmailDeploymentPolicy;
}>;

export type EmailSettingsState = Readonly<{
  settings: EmailSettingsRecord | null;
  deliveryEnabled: boolean;
  plaintextAllowed: boolean;
}>;

/** Qué hacer con la contraseña guardada: dejarla, reemplazarla o quitarla. */
type PasswordPlan =
  | Readonly<{ kind: "KEEP" }>
  | Readonly<{ kind: "REPLACE"; sealed: SealedSmtpPassword }>
  | Readonly<{ kind: "REMOVE" }>;

export function createEmailSettings(deps: EmailSettingsDependencies) {
  const { authorizer, policy } = deps;

  const state = (settings: EmailSettingsRecord | null): EmailSettingsState => ({
    settings,
    deliveryEnabled: policy.deliveryEnabled,
    plaintextAllowed: policy.plaintextAllowed,
  });

  /** Si la contraseña escrita es la guardada; una guardada que no se puede abrir no se compara. */
  function samePassword(stored: SealedSmtpPassword | null, password: string, companyId: string) {
    if (stored === null || deps.vault === null) return false;
    try {
      return deps.vault.open(stored, companyId) === password;
    } catch (error) {
      if (error instanceof SmtpPasswordUnavailableError) return false;
      throw error;
    }
  }

  async function passwordPlan(
    scope: EmailScope,
    companyId: string,
    username: string | null,
    password: string | undefined,
  ): Promise<PasswordPlan> {
    const stored = await scope.settings.findSecret(companyId);
    if (username === null) {
      if (password !== undefined) throw emailUsernameRequired();
      return stored ? { kind: "REMOVE" } : { kind: "KEEP" };
    }
    if (password === undefined) {
      if (!stored) throw emailPasswordRequired();
      return { kind: "KEEP" };
    }
    if (deps.vault === null) throw emailCustodyDisabled();
    if (samePassword(stored, password, companyId)) return { kind: "KEEP" };
    return { kind: "REPLACE", sealed: deps.vault.seal(password, companyId) };
  }

  return {
    async get(ctx: RequestContext): Promise<EmailSettingsState> {
      authorizer.requirePermission(ctx, "email.configure");
      return state(await deps.settings.find(ctx.companyId));
    },

    /**
     * Lo que la confirmación de la emisión necesita saber (requisito «Destino del correo al emitir»):
     * también para el operador, sin el servidor, el usuario ni la contraseña.
     */
    async availability(ctx: RequestContext): Promise<EmailAvailability> {
      authorizer.requirePermission(ctx, "email.resend");
      const settings = await deps.settings.find(ctx.companyId);
      return {
        configured: settings !== null,
        deliveryEnabled: policy.deliveryEnabled,
        autoSend: settings?.autoSend ?? false,
        testRecipient: settings?.testRecipient ?? null,
      };
    },

    async update(ctx: RequestContext, body: unknown): Promise<EmailSettingsState> {
      authorizer.requirePermission(ctx, "email.configure");
      const input = parseInput(updateEmailSettingsSchema, body);
      if (input.security === "NONE" && !policy.plaintextAllowed) throw emailPlaintextNotAllowed();
      const fields: EmailSettingsFields = {
        host: input.host,
        port: input.port,
        security: input.security,
        username: input.username,
        fromName: input.fromName,
        fromAddress: input.fromAddress,
        bccAddress: input.bccAddress,
        autoSend: input.autoSend,
        testRecipient: input.testRecipient,
      };
      const saved = await deps.uow.run(async (scope) => {
        await scope.settings.lock(ctx.companyId);
        const current = await scope.settings.find(ctx.companyId);
        const plan = await passwordPlan(scope, ctx.companyId, input.username, input.password);
        const changes = settingsChanges(current, fields, plan.kind !== "KEEP");
        // Lo mismo dos veces, por un doble clic o un reintento: una sola configuración, sin evento.
        if (current !== null && changes === null) return current;
        if ((current?.version ?? null) !== input.expectedVersion) throw emailSettingsChanged();
        if (current === null) await scope.settings.insert(ctx.companyId, fields, ctx.userId);
        else if (
          !(await scope.settings.updateIfVersion(
            ctx.companyId,
            current.version,
            fields,
            ctx.userId,
          ))
        )
          throw emailSettingsChanged();
        if (plan.kind === "REPLACE") await scope.settings.saveSecret(ctx.companyId, plan.sealed);
        if (plan.kind === "REMOVE") await scope.settings.deleteSecret(ctx.companyId);
        await scope.audit.append({
          companyId: ctx.companyId,
          actor: { type: "USER", userId: ctx.userId },
          action: "email_settings.changed",
          ...(changes ? { changes } : {}),
          correlationId: ctx.requestId,
        });
        return scope.settings.find(ctx.companyId);
      });
      return state(saved);
    },
  };
}

export type EmailSettings = ReturnType<typeof createEmailSettings>;
