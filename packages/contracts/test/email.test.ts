import { describe, expect, it } from "vitest";
import {
  emailDeliveryViewSchema,
  emailSettingsResponseSchema,
  resendEmailSchema,
  sendTestEmailSchema,
  updateEmailSettingsSchema,
} from "../src/index.ts";

// Contratos del correo (add-email-delivery, design D8 y D10).
const settings = {
  host: " smtp.empresa.ec ",
  port: 465,
  security: "TLS",
  username: "facturas@empresa.ec",
  password: " clave con espacios ",
  fromName: " Ferretería Andina ",
  fromAddress: "facturas@empresa.ec",
  bccAddress: "",
  autoSend: true,
  testRecipient: "revision@empresa.ec",
  expectedVersion: null,
};
const messages = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((issue) => issue.message) ?? [];

describe("configuración del correo", () => {
  it("normaliza los textos, conserva la contraseña tal cual y vacía los opcionales", () => {
    expect(updateEmailSettingsSchema.parse(settings)).toEqual({
      ...settings,
      host: "smtp.empresa.ec",
      fromName: "Ferretería Andina",
      bccAddress: null,
      password: " clave con espacios ",
    });
  });

  it("sin contraseña se conserva la guardada; sin usuario no hay autenticación", () => {
    const { password: _password, ...rest } = settings;
    const parsed = updateEmailSettingsSchema.parse({ ...rest, username: "", expectedVersion: 3 });
    expect(parsed.password).toBeUndefined();
    expect(parsed.username).toBeNull();
    expect(parsed.expectedVersion).toBe(3);
  });

  it("rechaza datos fuera de sus límites, indicando el campo", () => {
    for (const [field, value, message] of [
      ["port", 0, "El puerto va de 1 a 65535."],
      ["port", 65536, "El puerto va de 1 a 65535."],
      ["host", "", "El servidor es obligatorio."],
      ["host", "smtp empresa.ec", "El servidor no puede tener espacios."],
      ["security", "SSL", "La seguridad no es válida."],
      ["fromAddress", "no-es-correo", "El correo no tiene un formato válido."],
      ["bccAddress", "otro", "El correo no tiene un formato válido."],
      ["testRecipient", "a b@x.ec", "El correo no tiene un formato válido."],
      [
        "fromName",
        "Andina\r\nBcc: x@y.ec",
        "El nombre del remitente no puede tener saltos de línea.",
      ],
      ["username", "a\nb", "El usuario no puede tener saltos de línea."],
      ["password", "", "La contraseña no puede estar vacía."],
      ["password", "a\r\nb", "La contraseña no puede tener saltos de línea."],
    ] as const) {
      const result = updateEmailSettingsSchema.safeParse({ ...settings, [field]: value });
      expect(result.success, `${field}`).toBe(false);
      expect(messages(result), `${field}`).toContain(message);
    }
  });

  it("rechaza campos desconocidos, como la empresa", () => {
    expect(
      messages(updateEmailSettingsSchema.safeParse({ ...settings, companyId: "otra" })),
    ).toContain("La solicitud contiene campos no permitidos.");
  });

  it("la consulta nunca lleva la contraseña", () => {
    const view = {
      host: "smtp.empresa.ec",
      port: 465,
      security: "TLS",
      username: "facturas@empresa.ec",
      passwordSet: true,
      fromName: "Ferretería Andina",
      fromAddress: "facturas@empresa.ec",
      bccAddress: null,
      autoSend: true,
      testRecipient: null,
      version: 1,
      updatedAt: "2026-10-23T15:00:00.000Z",
    };
    const response = { settings: view, deliveryEnabled: false, plaintextAllowed: false };
    expect(emailSettingsResponseSchema.parse(response)).toEqual(response);
    expect(
      emailSettingsResponseSchema.safeParse({
        ...response,
        settings: { ...view, password: "secreta" },
      }).success,
    ).toBe(false);
  });
});

describe("correo de prueba y reenvío", () => {
  it("el correo de prueba exige una dirección válida", () => {
    expect(sendTestEmailSchema.parse({ to: " revision@empresa.ec " })).toEqual({
      to: "revision@empresa.ec",
    });
    expect(sendTestEmailSchema.safeParse({ to: "revision" }).success).toBe(false);
  });

  it("el reenvío admite de 1 a 10 direcciones distintas sin distinguir mayúsculas", () => {
    expect(resendEmailSchema.parse({ recipients: [" pagos@cliente.ec "] }).recipients).toEqual([
      "pagos@cliente.ec",
    ]);
    expect(messages(resendEmailSchema.safeParse({ recipients: [] }))).toContain(
      "Escribe al menos un correo.",
    );
    const eleven = Array.from({ length: 11 }, (_, i) => `c${i}@cliente.ec`);
    expect(messages(resendEmailSchema.safeParse({ recipients: eleven }))).toContain(
      "Un envío admite como máximo 10 correos.",
    );
    const repeated = resendEmailSchema.safeParse({
      recipients: ["Pagos@Cliente.ec", "pagos@cliente.ec"],
    });
    expect(repeated.error?.issues[0]).toMatchObject({
      path: ["recipients", 1],
      message: "El correo está repetido.",
    });
  });

  it("un envío nunca afirma que se entregó ni que se leyó", () => {
    const delivery = {
      id: "d1",
      origin: "AUTOMATIC",
      requestedBy: null,
      environment: "PRODUCTION",
      testRedirect: false,
      status: "SENT",
      recipients: [{ address: "a@b.ec", outcome: "ACCEPTED", reason: null }],
      reason: null,
      createdAt: "2026-10-23T15:00:00.000Z",
      sentAt: "2026-10-23T15:00:05.000Z",
      finishedAt: "2026-10-23T15:00:05.000Z",
      attempts: [{ number: 1, at: "2026-10-23T15:00:05.000Z", outcome: "SENT", smtpCode: 250 }],
    };
    expect(emailDeliveryViewSchema.parse(delivery)).toEqual(delivery);
    for (const status of ["DELIVERED", "READ"]) {
      expect(emailDeliveryViewSchema.safeParse({ ...delivery, status }).success).toBe(false);
    }
  });
});
