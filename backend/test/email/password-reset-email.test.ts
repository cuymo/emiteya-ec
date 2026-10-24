// Envío del enlace de recuperación (add-password-reset-by-email, design D3): la primera empresa con
// el correo configurado, nada con el envío apagado o sin configuración, y el mensaje con el enlace
// escapado y su vencimiento.
import { describe, expect, it } from "vitest";
import { createPasswordResetEmail } from "../../src/modules/email/application/password-reset-email.ts";
import type {
  EmailSettingsRepository,
  MailTransport,
  OutgoingMail,
} from "../../src/modules/email/application/ports.ts";
import { composePasswordResetMessage } from "../../src/modules/email/domain/password-reset-message.ts";

const SETTINGS = {
  host: "smtp.b.ec",
  port: 587,
  security: "STARTTLS",
  username: null,
  fromName: "Empresa B",
  fromAddress: "facturas@b.ec",
};

function deps(options: { deliveryEnabled?: boolean; failing?: boolean } = {}) {
  const sent: OutgoingMail[] = [];
  const repository = {
    find: (companyId: string) => Promise.resolve(companyId === "b" ? SETTINGS : null),
    findSecret: () => Promise.resolve(null),
  } as unknown as EmailSettingsRepository;
  const transport: MailTransport = {
    send: (_connection, mail) => {
      sent.push(mail);
      return Promise.resolve(
        options.failing
          ? ({ kind: "FAILED", failure: { code: "CONNECTION_FAILED" } } as never)
          : ({ kind: "SENT", accepted: mail.to, rejected: [] } as never),
      );
    },
  };
  const service = createPasswordResetEmail({
    settings: repository,
    vault: null,
    transport,
    policy: { deliveryEnabled: options.deliveryEnabled ?? true, plaintextAllowed: false },
  });
  return { service, sent };
}

const INPUT = {
  to: "ana@b.ec",
  companyIds: ["a", "b"],
  link: "https://emiteya.example.ec/restablecer-contrasena#token=abc",
  expiresInMinutes: 30,
};

describe("envío del enlace de recuperación", () => {
  it("usa la primera empresa con el correo configurado y su remitente", async () => {
    const { service, sent } = deps();
    expect(await service.send(INPUT)).toBe("sent");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      from: { name: "Empresa B", address: "facturas@b.ec" },
      to: ["ana@b.ec"],
      subject: "Restablece tu contraseña de EmiteYa",
      attachments: [],
    });
    expect(sent[0]!.text).toContain(INPUT.link);
  });

  it("con el envío apagado o sin empresa configurada no conecta", async () => {
    const off = deps({ deliveryEnabled: false });
    expect(await off.service.send(INPUT)).toBe("no_mail_server");
    expect(off.sent).toEqual([]);
    const none = deps();
    expect(await none.service.send({ ...INPUT, companyIds: ["a"] })).toBe("no_mail_server");
    expect(none.sent).toEqual([]);
  });

  it("un rechazo del servidor queda como envío fallido", async () => {
    expect(await deps({ failing: true }).service.send(INPUT)).toBe("send_failed");
  });

  it("el mensaje lleva el enlace escapado en el HTML y su vencimiento", () => {
    const message = composePasswordResetMessage({
      link: 'https://x.ec/restablecer-contrasena#token=a"b<c',
      expiresInMinutes: 30,
    });
    expect(message.text).toContain("Vence en 30 minutos");
    expect(message.html).toContain("token=a&quot;b&lt;c");
    expect(message.html).not.toContain('a"b<c');
  });
});
