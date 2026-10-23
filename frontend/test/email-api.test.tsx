// Datos del correo (add-email-delivery, tarea 8.2, design D14): las rutas y los cuerpos de cada
// consulta y mutación, el mensaje de «sin cambios», el aviso de un correo de prueba rechazado, el
// texto del límite de pruebas, y la Idempotency-Key del reenvío con lo que vuelve a consultar.
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EMAIL_SETTINGS_FIELD_ERRORS,
  useDocumentEmailDeliveries,
  useEmailAvailability,
  useEmailRecipients,
  useEmailSettings,
  useResendEmail,
  useSaveEmailSettings,
  useSendTestEmail,
} from "@/features/email/email-api";
import { errorBody, mockApi, renderApp } from "./harness";

const ok = (data: unknown) => () => ({ status: 200, body: { data } });
const AT = "2026-10-23T15:00:00.000Z";
const SETTINGS = {
  host: "smtp.empresa.ec",
  port: 587,
  security: "STARTTLS",
  username: "facturas@empresa.ec",
  passwordSet: true,
  fromName: "Empresa",
  fromAddress: "facturas@empresa.ec",
  bccAddress: null,
  autoSend: true,
  testRecipient: "pruebas@empresa.ec",
  version: 3,
  updatedAt: AT,
};
const INPUT = {
  host: "smtp.empresa.ec",
  port: 587,
  security: "STARTTLS" as const,
  username: "facturas@empresa.ec",
  fromName: "Empresa",
  fromAddress: "facturas@empresa.ec",
  bccAddress: "",
  autoSend: true,
  testRecipient: "pruebas@empresa.ec",
  expectedVersion: 3,
};
const DELIVERY = {
  id: "mail-1",
  origin: "MANUAL",
  requestedBy: { name: "Ana Admin" },
  environment: "PRODUCTION",
  testRedirect: false,
  status: "PENDING",
  recipients: [{ address: "cliente@correo.ec", outcome: null, reason: null }],
  reason: null,
  createdAt: AT,
  sentAt: null,
  finishedAt: null,
  attempts: [],
};

afterEach(() => vi.unstubAllGlobals());

function Queries() {
  const settings = useEmailSettings(true);
  const availability = useEmailAvailability(true);
  const deliveries = useDocumentEmailDeliveries("inv/1", true);
  const recipients = useEmailRecipients("inv/1", true);
  return (
    <p>
      {settings.data?.settings?.host} · {String(availability.data?.configured)} ·{" "}
      {deliveries.data?.length} · {recipients.data?.recipients.join(",")}
    </p>
  );
}

function Save({ input }: { input: typeof INPUT }) {
  const save = useSaveEmailSettings({ onSuccess: () => undefined, onError: () => false });
  return <button onClick={() => save.mutate(input)}>Guardar</button>;
}

function Test() {
  const test = useSendTestEmail({ onSuccess: () => undefined, onError: () => false });
  return <button onClick={() => test.mutate("pruebas@empresa.ec")}>Probar</button>;
}

function Resend({ count }: { count: () => number }) {
  const resend = useResendEmail({
    documentId: "inv-1",
    onSuccess: () => undefined,
    onError: () => false,
  });
  const deliveries = useDocumentEmailDeliveries("inv-1", true);
  return (
    <>
      <button onClick={() => resend.mutate({ recipients: ["cliente@correo.ec"], key: "clave-1" })}>
        Reenviar
      </button>
      <p>Consultas: {deliveries.dataUpdatedAt ? count() : 0}</p>
    </>
  );
}

describe("datos del correo", () => {
  it("cada consulta llama a su ruta, con el identificador del comprobante codificado", async () => {
    const calls = mockApi({
      "GET /api/v1/email/settings": ok({
        settings: SETTINGS,
        deliveryEnabled: true,
        plaintextAllowed: false,
      }),
      "GET /api/v1/email/availability": ok({
        configured: true,
        deliveryEnabled: true,
        autoSend: true,
        testRecipient: null,
      }),
      "GET /api/v1/documents/inv%2F1/email-deliveries": ok([DELIVERY]),
      "GET /api/v1/documents/inv%2F1/email-recipients": ok({
        recipients: ["cliente@correo.ec", "pagos@correo.ec"],
        environment: "PRODUCTION",
        testRedirect: false,
        testRecipient: null,
      }),
    });
    renderApp(<Queries />);
    expect(
      await screen.findByText("smtp.empresa.ec · true · 1 · cliente@correo.ec,pagos@correo.ec"),
    ).toBeDefined();
    expect(calls.map((call) => call.key).sort()).toEqual([
      "GET /api/v1/documents/inv%2F1/email-deliveries",
      "GET /api/v1/documents/inv%2F1/email-recipients",
      "GET /api/v1/email/availability",
      "GET /api/v1/email/settings",
    ]);
  });

  it("guardar envía la configuración, y una versión igual dice que no había cambios", async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      "PUT /api/v1/email/settings": ok({
        settings: SETTINGS,
        deliveryEnabled: true,
        plaintextAllowed: false,
      }),
    });
    const view = renderApp(<Save input={INPUT} />);
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("No había cambios que guardar.")).toBeDefined();
    expect(calls).toEqual([{ key: "PUT /api/v1/email/settings", body: INPUT }]);

    view.rerenderApp(<Save input={{ ...INPUT, port: 465, expectedVersion: 2 }} />);
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("Guardaste el servidor de correo.")).toBeDefined();
  });

  it("los rechazos de la configuración van a su campo", () => {
    expect(EMAIL_SETTINGS_FIELD_ERRORS).toEqual({
      EMAIL_PLAINTEXT_NOT_ALLOWED: "security",
      EMAIL_PASSWORD_REQUIRED: "password",
      EMAIL_USERNAME_REQUIRED: "username",
    });
  });

  it("un correo de prueba rechazado avisa con el mensaje del servidor", async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      "POST /api/v1/email/test": ok({
        accepted: false,
        message: "El servidor rechazó el usuario o la contraseña.",
        to: "pruebas@empresa.ec",
        at: AT,
      }),
    });
    renderApp(<Test />);
    await user.click(screen.getByRole("button", { name: "Probar" }));
    expect(
      await screen.findByText("El servidor rechazó el usuario o la contraseña."),
    ).toBeDefined();
    expect(calls).toEqual([{ key: "POST /api/v1/email/test", body: { to: "pruebas@empresa.ec" } }]);
  });

  it("el límite de correos de prueba se explica en su propio texto", async () => {
    const user = userEvent.setup();
    mockApi({
      "POST /api/v1/email/test": () => ({
        status: 429,
        body: errorBody("EMAIL_TEST_RATE_LIMITED", "Too many requests"),
      }),
    });
    renderApp(<Test />);
    await user.click(screen.getByRole("button", { name: "Probar" }));
    expect(
      await screen.findByText(/Puedes enviar hasta 5 correos de prueba por minuto/),
    ).toBeDefined();
  });

  it("el reenvío lleva la clave del diálogo y vuelve a consultar el historial", async () => {
    const user = userEvent.setup();
    const keys: string[] = [];
    let historyReads = 0;
    const calls = mockApi({
      "GET /api/v1/documents/inv-1/email-deliveries": () => {
        historyReads++;
        return { status: 200, body: { data: [] } };
      },
      "POST /api/v1/documents/inv-1/email-deliveries": (init) => {
        keys.push(new Headers(init.headers).get("Idempotency-Key") ?? "");
        return { status: 202, body: { data: DELIVERY } };
      },
    });
    renderApp(<Resend count={() => historyReads} />);
    await screen.findByText("Consultas: 1");
    await user.click(screen.getByRole("button", { name: "Reenviar" }));
    expect(await screen.findByText("Programaste el envío del correo.")).toBeDefined();
    expect(keys).toEqual(["clave-1"]);
    expect(calls).toContainEqual({
      key: "POST /api/v1/documents/inv-1/email-deliveries",
      body: { recipients: ["cliente@correo.ec"] },
    });
    await waitFor(() => expect(historyReads).toBe(2));
  });
});
