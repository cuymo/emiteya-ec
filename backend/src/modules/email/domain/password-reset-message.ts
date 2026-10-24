// Mensaje del enlace de recuperación de la contraseña (add-password-reset-by-email, design D3): en
// texto y en HTML, con el enlace, su vencimiento y qué hacer si no se pidió. No lleva datos de la
// cuenta más allá del destinatario, ni el token fuera del enlace.

export type PasswordResetMessage = Readonly<{ subject: string; text: string; html: string }>;

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

export function composePasswordResetMessage(input: {
  link: string;
  expiresInMinutes: number;
}): PasswordResetMessage {
  const { link, expiresInMinutes } = input;
  const subject = "Restablece tu contraseña de EmiteYa";
  const text = [
    "Recibimos una solicitud para restablecer la contraseña de tu cuenta de EmiteYa.",
    `Para poner una contraseña nueva, abre este enlace. Vence en ${expiresInMinutes} minutos y sirve una sola vez:`,
    link,
    "Si no lo pediste, ignora este correo: tu contraseña no cambia.",
  ].join("\n\n");
  const href = escapeHtml(link);
  const html = [
    '<!doctype html><html lang="es"><body style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;line-height:1.5">',
    "<p>Recibimos una solicitud para restablecer la contraseña de tu cuenta de EmiteYa.</p>",
    `<p>Para poner una contraseña nueva, usa este botón. El enlace vence en ${expiresInMinutes} minutos y sirve una sola vez.</p>`,
    `<p><a href="${href}" style="display:inline-block;background:#1d4ed8;color:#ffffff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">Poner una contraseña nueva</a></p>`,
    `<p style="font-size:13px;color:#4b5563">Si el botón no funciona, copia esta dirección en tu navegador:<br>${href}</p>`,
    "<p>Si no lo pediste, ignora este correo: tu contraseña no cambia.</p>",
    "</body></html>",
  ].join("");
  return { subject, text, html };
}
