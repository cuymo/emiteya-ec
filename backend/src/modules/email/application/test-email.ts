// Correo de prueba (add-email-delivery, design D10 y D11; spec email-delivery, «Correo de prueba»):
// el administrador comprueba la configuración guardada enviando un correo a una dirección que elige
// y ve si el servidor lo aceptó o el motivo del rechazo, sin secretos. Con el envío apagado por el
// despliegue no conecta; sin configuración tampoco. Hasta 5 pruebas por minuto y empresa. Cada
// prueba deja su evento con la dirección y el resultado.
import { sendTestEmailSchema, type TestEmailResult } from "@facturador/contracts";
import { parseInput, type Authorizer } from "../../identity/application/authorization.ts";
import type { RequestContext } from "../../identity/application/request-context.ts";
import { failureMessage, type EmailFailureCode } from "../domain/failures.ts";
import {
  TEST_EMAILS_PER_MINUTE,
  emailDeliveryDisabled,
  emailNotConfigured,
  emailTestRateLimited,
} from "./errors.ts";
import {
  SmtpPasswordUnavailableError,
  type EmailDeploymentPolicy,
  type EmailSettingsRepository,
  type EmailUnitOfWork,
  type MailTransport,
  type SmtpConnection,
  type SmtpPasswordVault,
} from "./ports.ts";

const WINDOW_MS = 60_000;

export type TestEmailDependencies = Readonly<{
  settings: EmailSettingsRepository;
  uow: EmailUnitOfWork;
  authorizer: Authorizer;
  vault: SmtpPasswordVault | null;
  transport: MailTransport;
  policy: EmailDeploymentPolicy;
  now?: () => Date;
}>;

export function createTestEmail(deps: TestEmailDependencies) {
  const now = deps.now ?? (() => new Date());
  // Ventana deslizante por empresa, en memoria de la instancia: una defensa de recursos, no una
  // regla de negocio.
  const recent = new Map<string, number[]>();

  function reserveSlot(companyId: string) {
    const at = now().getTime();
    const times = (recent.get(companyId) ?? []).filter((time) => at - time < WINDOW_MS);
    if (times.length >= TEST_EMAILS_PER_MINUTE) throw emailTestRateLimited();
    times.push(at);
    recent.set(companyId, times);
  }

  async function connectionOf(
    companyId: string,
    settings: NonNullable<Awaited<ReturnType<EmailSettingsRepository["find"]>>>,
  ): Promise<SmtpConnection | EmailFailureCode> {
    let password: string | null = null;
    if (settings.username !== null) {
      const sealed = await deps.settings.findSecret(companyId);
      if (sealed === null || deps.vault === null) return "PASSWORD_UNAVAILABLE";
      try {
        password = deps.vault.open(sealed, companyId);
      } catch (error) {
        if (error instanceof SmtpPasswordUnavailableError) return "PASSWORD_UNAVAILABLE";
        throw error;
      }
    }
    return {
      host: settings.host,
      port: settings.port,
      security: settings.security,
      username: settings.username,
      password,
    };
  }

  return {
    async send(ctx: RequestContext, body: unknown): Promise<TestEmailResult> {
      deps.authorizer.requirePermission(ctx, "email.configure");
      const { to } = parseInput(sendTestEmailSchema, body);
      if (!deps.policy.deliveryEnabled) throw emailDeliveryDisabled();
      const settings = await deps.settings.find(ctx.companyId);
      if (settings === null) throw emailNotConfigured();
      reserveSlot(ctx.companyId);

      const connection = await connectionOf(ctx.companyId, settings);
      let failure: EmailFailureCode | null;
      if (typeof connection === "string") failure = connection;
      else {
        const outcome = await deps.transport.send(connection, {
          from: { name: settings.fromName, address: settings.fromAddress },
          to: [to],
          bcc: null,
          subject: `Correo de prueba de ${settings.fromName}`,
          text: [
            "Este es un correo de prueba enviado desde Configuración → Correos.",
            "Si lo recibiste, el servidor de correo de la empresa funciona para enviar los comprobantes.",
          ].join("\n\n"),
          html: null,
          attachments: [],
          messageId: null,
        });
        failure =
          outcome.kind === "FAILED"
            ? outcome.failure.code
            : outcome.accepted.length === 0
              ? "ALL_RECIPIENTS_REJECTED"
              : null;
      }

      const at = now();
      await deps.uow.run((scope) =>
        scope.audit.append({
          companyId: ctx.companyId,
          actor: { type: "USER", userId: ctx.userId },
          action: "email.test_sent",
          changes: { to, accepted: failure === null, failureCode: failure },
          correlationId: ctx.requestId,
        }),
      );
      return {
        accepted: failure === null,
        message:
          failure === null ? "El servidor aceptó el correo de prueba." : failureMessage(failure),
        to,
        at: at.toISOString(),
      };
    },
  };
}

export type TestEmail = ReturnType<typeof createTestEmail>;
