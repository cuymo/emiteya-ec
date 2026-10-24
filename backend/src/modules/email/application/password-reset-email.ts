// Envío del enlace de recuperación de la contraseña (add-password-reset-by-email, design D3): con el
// servidor de correo de la primera empresa de la cuenta que lo tenga configurado. Con el envío
// apagado por el despliegue, o sin ninguna empresa configurada, no conecta. `identity` lo usa por su
// puerto `PasswordResetMailer`, que compone main.ts.
import { composePasswordResetMessage } from "../domain/password-reset-message.ts";
import type {
  EmailDeploymentPolicy,
  EmailSettingsRepository,
  MailTransport,
  SmtpPasswordVault,
} from "./ports.ts";
import { openSmtpConnection } from "./smtp-connection.ts";

export type PasswordResetEmailOutcome = "sent" | "no_mail_server" | "send_failed";

export type PasswordResetEmailDependencies = Readonly<{
  settings: EmailSettingsRepository;
  vault: SmtpPasswordVault | null;
  transport: MailTransport;
  policy: EmailDeploymentPolicy;
}>;

export function createPasswordResetEmail(deps: PasswordResetEmailDependencies) {
  return {
    async send(input: {
      to: string;
      companyIds: readonly string[];
      link: string;
      expiresInMinutes: number;
    }): Promise<PasswordResetEmailOutcome> {
      if (!deps.policy.deliveryEnabled) return "no_mail_server";
      for (const companyId of input.companyIds) {
        const settings = await deps.settings.find(companyId);
        if (settings === null) continue;
        const connection = await openSmtpConnection(deps.settings, deps.vault, companyId, settings);
        if (typeof connection === "string") return "send_failed";
        const message = composePasswordResetMessage(input);
        const outcome = await deps.transport.send(connection, {
          from: { name: settings.fromName, address: settings.fromAddress },
          to: [input.to],
          bcc: null,
          subject: message.subject,
          text: message.text,
          html: message.html,
          attachments: [],
          messageId: null,
        });
        return outcome.kind === "FAILED" || outcome.accepted.length === 0 ? "send_failed" : "sent";
      }
      return "no_mail_server";
    },
  };
}

export type PasswordResetEmail = ReturnType<typeof createPasswordResetEmail>;
