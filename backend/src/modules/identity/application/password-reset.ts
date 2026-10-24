// Recuperación de la contraseña por correo (add-password-reset-by-email, design D3): `identity` pide
// el envío del enlace con este puerto y `main.ts` lo compone con el módulo `email`, que envía con el
// servidor de correo de la empresa. `identity` nunca importa `email`.

/** Lo que vale el enlace: 30 minutos (design D1). */
export const PASSWORD_RESET_MINUTES = 30;

/** Resultado del envío del enlace; nunca lleva el correo, el enlace ni el token. */
export type PasswordResetDelivery = "sent" | "no_mail_server" | "send_failed";

export interface PasswordResetMailer {
  /**
   * Envía el enlace a `to` con el servidor de la primera empresa de `companyIds` que tenga el correo
   * configurado. Sin ninguna, o con el envío apagado, no envía nada.
   */
  send(input: {
    to: string;
    companyIds: readonly string[];
    link: string;
    expiresInMinutes: number;
  }): Promise<PasswordResetDelivery>;
}
