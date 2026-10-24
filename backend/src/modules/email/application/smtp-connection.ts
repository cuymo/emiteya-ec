// La conexión con el servidor de correo de una empresa, con su contraseña abierta de la bóveda solo
// para este envío. Sin la contraseña sellada o sin bóveda, el envío no puede intentarse.
import type { EmailFailureCode } from "../domain/failures.ts";
import type { EmailSettingsRecord } from "../domain/settings.ts";
import {
  SmtpPasswordUnavailableError,
  type EmailSettingsRepository,
  type SmtpConnection,
  type SmtpPasswordVault,
} from "./ports.ts";

export async function openSmtpConnection(
  repository: EmailSettingsRepository,
  vault: SmtpPasswordVault | null,
  companyId: string,
  settings: EmailSettingsRecord,
): Promise<SmtpConnection | EmailFailureCode> {
  let password: string | null = null;
  if (settings.username !== null) {
    const sealed = await repository.findSecret(companyId);
    if (sealed === null || vault === null) return "PASSWORD_UNAVAILABLE";
    try {
      password = vault.open(sealed, companyId);
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
