// Transporte SMTP contra un servidor falso (ADR 0029; add-email-delivery, design D5 y D6; spec
// email-delivery, «Estados del envío», «Reintentos de los fallos temporales» y «Conexión segura con
// el servidor de correo»): aceptado con sus adjuntos, una dirección rechazada, todas rechazadas,
// credenciales rechazadas sin filtrar la contraseña, rechazo temporal, servidor caído, tiempo
// agotado, TLS con certificado válido e inválido, STARTTLS ausente y sin cifrado no admitido.
import { beforeAll, describe, expect, it } from "vitest";
import type { OutgoingMail, SmtpConnection } from "../../src/modules/email/application/ports.ts";
import { failureClass } from "../../src/modules/email/domain/failures.ts";
import { createSmtpMailTransport } from "../../src/modules/email/infrastructure/smtp-transport.ts";
import {
  closedPort,
  silentServer,
  smtpError,
  startSmtpServer,
  testCertificates,
} from "../support/smtp-test-server.ts";

const PASSWORD = "clave-smtp-ñ-secreta";
const mail = (to: string[] = ["compras@cliente.ec", "pagos@cliente.ec"]): OutgoingMail => ({
  from: { name: "Ferretería Andina", address: "facturas@andina.ec" },
  to,
  bcc: null,
  subject: "Factura 001-001-000000123 de Ferretería Andina",
  text: "Adjuntamos la factura.",
  html: null,
  attachments: [
    {
      filename: "2310202601179001234500110010010000001231234567811.xml",
      contentType: "application/xml",
      content: Buffer.from("<factura/>"),
    },
    {
      filename: "2310202601179001234500110010010000001231234567811.pdf",
      contentType: "application/pdf",
      content: Buffer.from("%PDF-1.3\n%%EOF\n"),
    },
  ],
  messageId: "<envio-1@andina.ec>",
});
const plain = (port: number, overrides: Partial<SmtpConnection> = {}): SmtpConnection => ({
  host: "127.0.0.1",
  port,
  security: "NONE",
  username: null,
  password: null,
  ...overrides,
});
const transport = (overrides: Partial<Parameters<typeof createSmtpMailTransport>[0]> = {}) =>
  createSmtpMailTransport({
    connectionTimeoutMs: 2_000,
    socketTimeoutMs: 5_000,
    plaintextAllowed: true,
    ...overrides,
  });

describe("transporte SMTP", () => {
  let certificates: ReturnType<typeof testCertificates>;

  beforeAll(() => {
    certificates = testCertificates();
  });

  it("el servidor acepta el correo con sus dos adjuntos y su Message-ID", async () => {
    const server = await startSmtpServer({ disabledCommands: ["STARTTLS"] });
    try {
      const outcome = await transport().send(plain(server.port), mail());
      expect(outcome).toEqual({
        kind: "SENT",
        accepted: ["compras@cliente.ec", "pagos@cliente.ec"],
        rejected: [],
        smtpCode: 250,
      });
      const [received] = server.messages;
      expect(received!.from).toBe("facturas@andina.ec");
      expect(received!.raw).toContain("Message-ID: <envio-1@andina.ec>");
      expect(received!.raw).toContain(".xml");
      expect(received!.raw).toContain(".pdf");
    } finally {
      await server.close();
    }
  });

  it("una dirección rechazada no impide el envío a las demás", async () => {
    const server = await startSmtpServer({
      disabledCommands: ["STARTTLS"],
      onRcptTo: (address, _session, callback) =>
        callback(
          address.address === "pagos@cliente.ec" ? smtpError("Buzón inexistente", 550) : null,
        ),
    });
    try {
      const outcome = await transport().send(plain(server.port), mail());
      expect(outcome).toEqual({
        kind: "SENT",
        accepted: ["compras@cliente.ec"],
        rejected: [{ address: "pagos@cliente.ec", smtpCode: 550 }],
        smtpCode: 250,
      });
    } finally {
      await server.close();
    }
  });

  it("todas las direcciones rechazadas es un fallo definitivo", async () => {
    const server = await startSmtpServer({
      disabledCommands: ["STARTTLS"],
      onRcptTo: (_address, _session, callback) => callback(smtpError("Buzón inexistente", 550)),
    });
    try {
      const outcome = await transport().send(plain(server.port), mail());
      expect(outcome).toMatchObject({
        kind: "FAILED",
        failure: { code: "ALL_RECIPIENTS_REJECTED" },
      });
      expect(failureClass("ALL_RECIPIENTS_REJECTED")).toBe("DETERMINISTIC");
    } finally {
      await server.close();
    }
  });

  it("las credenciales rechazadas son definitivas y el detalle no lleva la contraseña", async () => {
    const server = await startSmtpServer({
      disabledCommands: ["STARTTLS"],
      allowInsecureAuth: true,
      authOptional: false,
      onAuth: (_auth, _session, callback) => callback(smtpError("Credenciales inválidas", 535)),
    });
    try {
      const outcome = await transport().send(
        plain(server.port, { username: "facturas@andina.ec", password: PASSWORD }),
        mail(),
      );
      expect(outcome).toMatchObject({
        kind: "FAILED",
        failure: { code: "AUTH_REJECTED", smtpCode: 535 },
      });
      const detail = outcome.kind === "FAILED" ? outcome.failure.detail : "";
      expect(detail).not.toContain(PASSWORD);
      expect(detail).not.toContain(Buffer.from(PASSWORD).toString("base64"));
      expect(detail.length).toBeLessThanOrEqual(200);
      expect(failureClass("AUTH_REJECTED")).toBe("DETERMINISTIC");
    } finally {
      await server.close();
    }
  });

  it("un rechazo temporal del remitente se reintenta", async () => {
    const server = await startSmtpServer({
      disabledCommands: ["STARTTLS"],
      onMailFrom: (_address, _session, callback) => callback(smtpError("Intenta más tarde", 451)),
    });
    try {
      const outcome = await transport().send(plain(server.port), mail());
      expect(outcome).toMatchObject({
        kind: "FAILED",
        failure: { code: "TEMPORARY_REJECTION", smtpCode: 451 },
      });
      expect(failureClass("TEMPORARY_REJECTION")).toBe("RETRYABLE");
    } finally {
      await server.close();
    }
  });

  it("un rechazo definitivo del remitente no se reintenta", async () => {
    const server = await startSmtpServer({
      disabledCommands: ["STARTTLS"],
      onMailFrom: (_address, _session, callback) =>
        callback(smtpError("Remitente no permitido", 553)),
    });
    try {
      const outcome = await transport().send(plain(server.port), mail());
      expect(outcome).toMatchObject({ kind: "FAILED", failure: { code: "SENDER_REJECTED" } });
    } finally {
      await server.close();
    }
  });

  it("un servidor que no escucha está no disponible y se reintenta", async () => {
    const outcome = await transport().send(plain(await closedPort()), mail());
    expect(outcome).toMatchObject({ kind: "FAILED", failure: { code: "SERVER_UNAVAILABLE" } });
    expect(failureClass("SERVER_UNAVAILABLE")).toBe("RETRYABLE");
  });

  it("un servidor que no saluda agota la espera y se reintenta", async () => {
    const silent = await silentServer();
    try {
      const outcome = await transport({ connectionTimeoutMs: 300 }).send(
        plain(silent.port),
        mail(),
      );
      expect(outcome).toMatchObject({ kind: "FAILED", failure: { code: "TIMEOUT" } });
      expect(failureClass("TIMEOUT")).toBe("RETRYABLE");
    } finally {
      await silent.close();
    }
  });

  it("TLS directo con un certificado de confianza envía, con la autenticación cifrada", async () => {
    const server = await startSmtpServer({
      secure: true,
      key: certificates.key,
      cert: certificates.cert,
      authOptional: false,
    });
    try {
      const outcome = await transport({ trustedCa: certificates.ca }).send(
        {
          host: "localhost",
          port: server.port,
          security: "TLS",
          username: "facturas@andina.ec",
          password: PASSWORD,
        },
        mail(["compras@cliente.ec"]),
      );
      expect(outcome).toMatchObject({ kind: "SENT", accepted: ["compras@cliente.ec"] });
      expect(server.authAttempts).toEqual(["facturas@andina.ec"]);
    } finally {
      await server.close();
    }
  });

  it("un certificado autofirmado o de otro nombre falla sin enviar las credenciales", async () => {
    const selfSigned = await startSmtpServer({
      secure: true,
      key: certificates.selfSignedKey,
      cert: certificates.selfSigned,
      authOptional: false,
    });
    const wrongName = await startSmtpServer({
      secure: true,
      key: certificates.key,
      cert: certificates.cert,
      authOptional: false,
    });
    try {
      const secure = (port: number, host: string): SmtpConnection => ({
        host,
        port,
        security: "TLS",
        username: "facturas@andina.ec",
        password: PASSWORD,
      });
      const first = await transport({ trustedCa: certificates.ca }).send(
        secure(selfSigned.port, "localhost"),
        mail(),
      );
      // El certificado es de «localhost»; conectar por la IP no coincide con su nombre.
      const second = await transport({ trustedCa: certificates.ca }).send(
        secure(wrongName.port, "127.0.0.1"),
        mail(),
      );
      for (const outcome of [first, second]) {
        expect(outcome).toMatchObject({ kind: "FAILED", failure: { code: "TLS_FAILED" } });
      }
      expect(selfSigned.authAttempts).toEqual([]);
      expect(wrongName.authAttempts).toEqual([]);
      expect(failureClass("TLS_FAILED")).toBe("DETERMINISTIC");
    } finally {
      await selfSigned.close();
      await wrongName.close();
    }
  });

  it("STARTTLS exigido con un servidor que no lo ofrece falla sin enviar las credenciales", async () => {
    const server = await startSmtpServer({
      disabledCommands: ["STARTTLS"],
      allowInsecureAuth: true,
    });
    try {
      const outcome = await transport().send(
        plain(server.port, {
          security: "STARTTLS",
          username: "facturas@andina.ec",
          password: PASSWORD,
        }),
        mail(),
      );
      expect(outcome).toMatchObject({ kind: "FAILED", failure: { code: "TLS_REQUIRED" } });
      expect(server.authAttempts).toEqual([]);
    } finally {
      await server.close();
    }
  });

  it("sin cifrado en un despliegue que no lo admite no conecta", async () => {
    const server = await startSmtpServer({ disabledCommands: ["STARTTLS"] });
    try {
      const outcome = await transport({ plaintextAllowed: false }).send(plain(server.port), mail());
      expect(outcome).toMatchObject({ kind: "FAILED", failure: { code: "PLAINTEXT_NOT_ALLOWED" } });
      expect(server.messages).toEqual([]);
    } finally {
      await server.close();
    }
  });
});
