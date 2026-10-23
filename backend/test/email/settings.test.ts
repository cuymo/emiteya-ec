import { describe, expect, it } from "vitest";
import { SmtpPasswordUnavailableError } from "../../src/modules/email/application/ports.ts";
import {
  settingsChanges,
  type EmailSettingsFields,
} from "../../src/modules/email/domain/settings.ts";
import { createSmtpPasswordVault } from "../../src/modules/email/infrastructure/password-vault.ts";
import { assertNoSecrets } from "../../src/modules/audit/domain/audit-event.ts";

// Contraseña SMTP y cambios auditables del servidor de correo (add-email-delivery, design D9 y D11).
const keyring = (fill: number) => ({
  activeVersion: "1",
  keys: new Map([["1", Buffer.alloc(32, fill)]]),
});
const fields: EmailSettingsFields = {
  host: "smtp.empresa.ec",
  port: 465,
  security: "TLS",
  username: "facturas@empresa.ec",
  fromName: "Ferretería Andina",
  fromAddress: "facturas@empresa.ec",
  bccAddress: null,
  autoSend: true,
  testRecipient: null,
};

describe("contraseña SMTP en su sobre", () => {
  const vault = createSmtpPasswordVault(keyring(7));

  it("ida y vuelta, sin el texto claro en el sobre", () => {
    const sealed = vault.seal("clave-ñ-€", "empresa-a");
    expect(sealed.formatVersion).toBe(1);
    expect(sealed.passwordCiphertext.includes(Buffer.from("clave-ñ-€"))).toBe(false);
    expect(vault.open(sealed, "empresa-a")).toBe("clave-ñ-€");
  });

  it("un sobre de otra empresa, de otra clave o de otro formato no se abre", () => {
    const sealed = vault.seal("clave", "empresa-a");
    expect(() => vault.open(sealed, "empresa-b")).toThrow(SmtpPasswordUnavailableError);
    expect(() => createSmtpPasswordVault(keyring(8)).open(sealed, "empresa-a")).toThrow(
      SmtpPasswordUnavailableError,
    );
    expect(() => vault.open({ ...sealed, formatVersion: 2 }, "empresa-a")).toThrow(
      SmtpPasswordUnavailableError,
    );
  });
});

describe("cambios auditables del servidor de correo", () => {
  it("la primera configuración lleva sus valores; sin cambios no hay evento", () => {
    expect(settingsChanges(null, fields, true)).toMatchObject({
      "host.to": "smtp.empresa.ec",
      "port.to": 465,
      smtpLoginChanged: true,
    });
    expect(settingsChanges(fields, fields, false)).toBeNull();
  });

  it("solo lo que cambió, y la contraseña como un cambio sin valor que la auditoría admite", () => {
    const changes = settingsChanges(fields, { ...fields, port: 587, security: "STARTTLS" }, true);
    expect(changes).toEqual({
      "port.from": 465,
      "port.to": 587,
      "security.from": "TLS",
      "security.to": "STARTTLS",
      smtpLoginChanged: true,
    });
    expect(() => assertNoSecrets(changes!)).not.toThrow();
  });
});
