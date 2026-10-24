// Recuperación de la contraseña por correo de punta a punta (add-password-reset-by-email, design D1 a
// D3): el enlace sale por el servidor de correo de la empresa, la pantalla lo usa una vez y la cuenta
// entra con la contraseña nueva. Una empresa sin correo configurado no envía nada.
import request from "../support/http-client.ts";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startSmtpServer, type SmtpTestServer } from "../support/smtp-test-server.ts";
import { BASE_URL, PASSWORD, createMember, signIn } from "./auth-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { buildEmailApp } from "./email-harness.ts";
import { insertCompany } from "./fixtures.ts";
import { sessionCookie } from "./taxpayer-harness.ts";

/** El texto del correo sin la codificación quoted-printable. */
const decoded = (raw: string) =>
  raw
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-F]{2})/g, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)));

describe("recuperación de la contraseña por correo", () => {
  let db: MigratedSchema;
  let api: ReturnType<typeof buildEmailApp>;
  let server: SmtpTestServer;
  let companyA: string;
  const ip = "192.0.2.77";

  const requestReset = (email: string) =>
    request(api.app)
      .post("/api/auth/request-password-reset")
      .set("X-Forwarded-For", ip)
      .set("Origin", BASE_URL)
      .send({ email });

  beforeAll(async () => {
    server = await startSmtpServer({ disabledCommands: ["STARTTLS"] });
    db = await createMigratedSchema("password_reset_flow");
    api = buildEmailApp(db, {
      policy: { deliveryEnabled: true, plaintextAllowed: true },
      passwordReset: { publicOrigin: "https://emiteya.example.ec" },
    });
    companyA = await insertCompany(db.database.prisma, "Empresa A");
    const companyB = await insertCompany(db.database.prisma, "Empresa B");
    await createMember(api.uow, companyA, { name: "Admin A", email: "admin@a.ec", role: "ADMIN" });
    await createMember(api.uow, companyA, { name: "Operador A", email: "operador@a.ec" });
    await createMember(api.uow, companyB, { name: "Operador B", email: "operador@b.ec" });
    const admin = await sessionCookie(api.app, "admin@a.ec");
    const configured = await request(api.app)
      .put("/api/v1/email/settings")
      .set("Cookie", admin)
      .send({
        host: "127.0.0.1",
        port: server.port,
        security: "NONE",
        username: null,
        fromName: "Ferretería Andina",
        fromAddress: "facturas@andina.ec",
        bccAddress: null,
        autoSend: true,
        testRecipient: null,
        expectedVersion: null,
      });
    expect(configured.status, JSON.stringify(configured.body)).toBeLessThan(300);
  });

  afterAll(async () => {
    await db.drop();
    await server.close();
  });

  it("el enlace llega por el servidor de la empresa y la cuenta entra con la contraseña nueva", async () => {
    const res = await requestReset("operador@a.ec");
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(server.messages).toHaveLength(1));
    const [mail] = server.messages;
    expect(mail!.to).toEqual(["operador@a.ec"]);
    expect(mail!.from).toBe("facturas@andina.ec");
    const text = decoded(mail!.raw);
    expect(text).toContain("Restablece");
    expect(text).toContain("30 minutos");
    const token = /restablecer-contrasena#token=([^\s"<&]+)/.exec(text)?.[1];
    expect(token).toBeTruthy();

    const NEW = "contrasena-recuperada-1";
    const reset = await request(api.app)
      .post("/api/auth/reset-password")
      .set("X-Forwarded-For", ip)
      .set("Origin", BASE_URL)
      .send({ newPassword: NEW, token: decodeURIComponent(token!) });
    expect(reset.status).toBe(200);
    expect((await signIn(api.app, "operador@a.ec", PASSWORD)).status).toBe(401);
    expect((await signIn(api.app, "operador@a.ec", NEW)).status).toBe(200);
  });

  it("una empresa sin correo configurado no envía nada, con la misma respuesta", async () => {
    const before = server.messages.length;
    const res = await requestReset("operador@b.ec");
    expect(res.status).toBe(200);
    await vi.waitFor(() =>
      expect(
        api.events.some(
          (event) =>
            event.type === "password_reset_requested" && event.outcome === "no_mail_server",
        ),
      ).toBe(true),
    );
    expect(server.messages).toHaveLength(before);
  });
});
