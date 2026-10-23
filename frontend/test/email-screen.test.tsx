// Configuración → Correos (add-email-delivery, tarea 8.4, design D14): el estado del envío (listo,
// desactivado por el despliegue o sin configurar), el formulario con las reglas del contrato, la
// contraseña que vacía se conserva, el conflicto con «Recargar», los rechazos junto a su campo y el
// diálogo de prueba con su resultado dentro.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionGate } from "@/components/session";
import { EmailScreen } from "@/features/email/email-screen";
import {
  ADMIN_ME,
  OPERATOR_ME,
  errorBody,
  mockApi,
  navigation,
  renderApp,
  type Route,
} from "./harness";

const AT = "2026-10-23T15:00:00.000Z";
const SETTINGS: Record<string, unknown> = {
  host: "smtp.empresa.ec",
  port: 587,
  security: "STARTTLS",
  username: "facturas@empresa.ec",
  passwordSet: true,
  fromName: "Comercial Andina",
  fromAddress: "facturas@empresa.ec",
  bccAddress: null,
  autoSend: true,
  testRecipient: "pruebas@empresa.ec",
  version: 3,
  updatedAt: AT,
};
const response = (
  settings: Record<string, unknown> | null = SETTINGS,
  overrides: Record<string, unknown> = {},
) => ({ settings, deliveryEnabled: true, plaintextAllowed: false, ...overrides });
const ok = (data: unknown) => () => ({ status: 200, body: { data } });

function renderEmail(
  routes: Record<string, Route>,
  me: typeof ADMIN_ME | typeof OPERATOR_ME = ADMIN_ME,
) {
  const calls = mockApi({ "GET /api/v1/me": ok(me), ...routes });
  renderApp(
    <SessionGate fallback={<p>cargando</p>}>
      <EmailScreen />
    </SessionGate>,
  );
  return calls;
}

beforeEach(() => {
  navigation.pathname = "/configuracion/correos";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Correos (design D14)", () => {
  it("mientras carga, el recuadro está ocupado; la pestaña ya nombra la pantalla", async () => {
    renderEmail({ "GET /api/v1/email/settings": () => new Promise(() => undefined) as never });
    const section = await screen.findByRole("region", { name: "Correos" });
    expect(section.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("heading", { level: 1, name: "Correos" }).className).toContain(
      "sr-only",
    );
  });

  it("un error de carga ofrece reintentar", async () => {
    const user = userEvent.setup();
    let fail = true;
    renderEmail({
      "GET /api/v1/email/settings": () =>
        fail
          ? { status: 503, body: errorBody("UNAVAILABLE", "x") }
          : { status: 200, body: { data: response() } },
    });
    // Un 503 se reintenta solo dos veces antes de mostrar el error.
    const retry = await screen.findByRole(
      "button",
      { name: "Intentar de nuevo" },
      { timeout: 5_000 },
    );
    fail = false;
    await user.click(retry);
    expect(await screen.findByRole("form", { name: "Servidor de correo" })).toBeDefined();
  });

  it("el operador ve el estado sin permiso y no consulta la configuración", async () => {
    const calls = renderEmail({}, OPERATOR_ME);
    expect(await screen.findByText("No tienes permiso para ver esta sección")).toBeDefined();
    expect(calls.map((call) => call.key)).not.toContain("GET /api/v1/email/settings");
  });

  it("sin configurar: lo dice, propone STARTTLS en el 587 con envío automático y no ofrece la prueba", async () => {
    renderEmail({ "GET /api/v1/email/settings": ok(response(null)) });
    expect(await screen.findByText("Sin configurar")).toBeDefined();
    expect(
      screen.getByText(/Registra el servidor de correo de la empresa para enviar a cada receptor/),
    ).toBeDefined();
    expect((screen.getByLabelText("Puerto") as HTMLInputElement).value).toBe("587");
    expect((screen.getByLabelText("Seguridad") as HTMLSelectElement).value).toBe("STARTTLS");
    expect(
      (screen.getByLabelText("Enviar por correo cada comprobante autorizado") as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(screen.queryByRole("button", { name: "Enviar correo de prueba" })).toBeNull();
    expect(screen.queryByText("Contraseña guardada")).toBeNull();
  });

  it("desactivado por el despliegue: lo dice aunque haya servidor guardado", async () => {
    renderEmail({
      "GET /api/v1/email/settings": ok(response(SETTINGS, { deliveryEnabled: false })),
    });
    expect(await screen.findByText("Desactivado")).toBeDefined();
    expect(screen.getByText(/El envío de correos está apagado en este despliegue/)).toBeDefined();
  });

  it("listo: con el envío automático apagado explica que se envía a mano, y avisa sin correo de prueba", async () => {
    renderEmail({
      "GET /api/v1/email/settings": ok(
        response({ ...SETTINGS, autoSend: false, testRecipient: null }),
      ),
    });
    expect(await screen.findByText("Listo")).toBeDefined();
    expect(screen.getByText(/El envío automático está apagado/)).toBeDefined();
    expect(
      screen.getByText(
        "Sin correo de prueba, los comprobantes del ambiente de Pruebas no se envían.",
      ),
    ).toBeDefined();
  });

  it("«Sin cifrado» solo aparece si el despliegue lo admite", async () => {
    renderEmail({ "GET /api/v1/email/settings": ok(response()) });
    const security = (await screen.findByLabelText("Seguridad")) as HTMLSelectElement;
    expect([...security.options].map((option) => option.value)).toEqual(["TLS", "STARTTLS"]);
  });

  it("con el despliegue que lo admite, cambiar el cifrado propone su puerto habitual", async () => {
    const user = userEvent.setup();
    renderEmail({
      "GET /api/v1/email/settings": ok(response(SETTINGS, { plaintextAllowed: true })),
    });
    const security = (await screen.findByLabelText("Seguridad")) as HTMLSelectElement;
    expect([...security.options].map((option) => option.value)).toEqual([
      "TLS",
      "STARTTLS",
      "NONE",
    ]);
    await user.selectOptions(security, "TLS");
    expect((screen.getByLabelText("Puerto") as HTMLInputElement).value).toBe("465");
    await user.clear(screen.getByLabelText("Puerto"));
    await user.type(screen.getByLabelText("Puerto"), "2525");
    await user.selectOptions(security, "NONE");
    expect((screen.getByLabelText("Puerto") as HTMLInputElement).value).toBe("2525");
  });

  it("guarda sin repetir la contraseña guardada, con los opcionales vacíos y la versión de partida", async () => {
    const user = userEvent.setup();
    const calls = renderEmail({
      "GET /api/v1/email/settings": ok(response()),
      "PUT /api/v1/email/settings": ok(response({ ...SETTINGS, fromName: "Andina", version: 4 })),
    });
    expect(await screen.findByText("Contraseña guardada")).toBeDefined();
    expect(screen.getByLabelText("Contraseña").getAttribute("placeholder")).toBe(
      "Déjala vacía para conservarla",
    );
    await user.clear(screen.getByLabelText("Nombre"));
    await user.type(screen.getByLabelText("Nombre"), "Andina");
    await user.click(screen.getByRole("button", { name: "Guardar servidor" }));
    expect(await screen.findByText("Guardaste el servidor de correo.")).toBeDefined();
    expect(calls.find((call) => call.key === "PUT /api/v1/email/settings")?.body).toEqual({
      host: "smtp.empresa.ec",
      port: 587,
      security: "STARTTLS",
      username: "facturas@empresa.ec",
      fromName: "Andina",
      fromAddress: "facturas@empresa.ec",
      bccAddress: null,
      autoSend: true,
      testRecipient: "pruebas@empresa.ec",
      expectedVersion: 3,
    });
  });

  it("una contraseña escrita se envía, y el formulario valida con las reglas del contrato", async () => {
    const user = userEvent.setup();
    const calls = renderEmail({
      "GET /api/v1/email/settings": ok(response(null)),
      "PUT /api/v1/email/settings": ok(response({ ...SETTINGS, version: 1 })),
    });
    await user.click(await screen.findByRole("button", { name: "Guardar servidor" }));
    expect(await screen.findByText("El servidor es obligatorio.")).toBeDefined();
    expect(screen.getByText("El nombre del remitente es obligatorio.")).toBeDefined();
    expect(calls.some((call) => call.key === "PUT /api/v1/email/settings")).toBe(false);

    await user.type(screen.getByLabelText("Servidor"), "smtp.empresa.ec");
    await user.type(screen.getByLabelText("Usuario (opcional)"), "facturas@empresa.ec");
    await user.type(screen.getByLabelText("Contraseña"), " clave con espacios ");
    await user.type(screen.getByLabelText("Nombre"), "Comercial Andina");
    await user.type(screen.getByLabelText("Correo"), "facturas@empresa.ec");
    await user.click(screen.getByRole("button", { name: "Guardar servidor" }));
    await waitFor(() =>
      expect(calls.find((call) => call.key === "PUT /api/v1/email/settings")?.body).toMatchObject({
        password: " clave con espacios ",
        expectedVersion: null,
      }),
    );
  });

  it("ante un conflicto pide recargar y parte de la versión vigente", async () => {
    const user = userEvent.setup();
    let current = SETTINGS;
    const versions: unknown[] = [];
    renderEmail({
      "GET /api/v1/email/settings": () => ({ status: 200, body: { data: response(current) } }),
      "PUT /api/v1/email/settings": (init) => {
        const body = JSON.parse(init.body ?? "{}") as { expectedVersion: number };
        versions.push(body.expectedVersion);
        return body.expectedVersion === 3
          ? {
              status: 409,
              body: errorBody("EMAIL_SETTINGS_CHANGED", "Otro usuario cambió la configuración."),
            }
          : { status: 200, body: { data: response({ ...current, version: 5 }) } };
      },
    });
    await screen.findByText("Contraseña guardada");
    current = { ...SETTINGS, host: "smtp.nuevo.ec", version: 4 };
    await user.click(screen.getByRole("button", { name: "Guardar servidor" }));
    const alert = await screen.findByText(/Otro administrador cambió el servidor de correo/);
    await user.click(
      within(alert.parentElement as HTMLElement).getByRole("button", { name: "Recargar" }),
    );
    await waitFor(() =>
      expect((screen.getByLabelText("Servidor") as HTMLInputElement).value).toBe("smtp.nuevo.ec"),
    );
    expect(screen.queryByText(/Otro administrador cambió el servidor de correo/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Guardar servidor" }));
    await waitFor(() => expect(versions).toEqual([3, 4]));
  });

  it("los rechazos del servidor van junto a su campo, con el foco en él", async () => {
    const user = userEvent.setup();
    let code = "EMAIL_PASSWORD_REQUIRED";
    renderEmail({
      "GET /api/v1/email/settings": ok(response({ ...SETTINGS, passwordSet: false })),
      "PUT /api/v1/email/settings": () => ({
        status: 400,
        body: errorBody(
          code,
          code === "EMAIL_PASSWORD_REQUIRED" ? "Escribe la contraseña." : "Elige TLS.",
        ),
      }),
    });
    await user.click(await screen.findByRole("button", { name: "Guardar servidor" }));
    expect(await screen.findByText("Escribe la contraseña.")).toBeDefined();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Contraseña")));
    expect(screen.getByLabelText("Contraseña").getAttribute("aria-invalid")).toBe("true");

    code = "EMAIL_PLAINTEXT_NOT_ALLOWED";
    await user.click(screen.getByRole("button", { name: "Guardar servidor" }));
    expect(await screen.findByText("Elige TLS.")).toBeDefined();
    expect(screen.getByLabelText("Seguridad").getAttribute("aria-invalid")).toBe("true");
  });

  it("se recorre con el teclado en el orden de lectura y se guarda con Enter", async () => {
    const user = userEvent.setup();
    const calls = renderEmail({
      "GET /api/v1/email/settings": ok(response()),
      "PUT /api/v1/email/settings": ok(response()),
    });
    const host = await screen.findByLabelText("Servidor");
    host.focus();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByLabelText("Puerto"));
    // La ayuda de un campo va antes que su control, como se lee.
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Ayuda: Seguridad" }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByLabelText("Seguridad"));
    await user.click(host);
    await user.keyboard("{Enter}");
    expect(await screen.findByText("No había cambios que guardar.")).toBeDefined();
    expect(calls.filter((call) => call.key === "PUT /api/v1/email/settings")).toHaveLength(1);
  });

  describe("correo de prueba", () => {
    const openTest = async (test: Route, settings = SETTINGS) => {
      const user = userEvent.setup();
      const calls = renderEmail({
        "GET /api/v1/email/settings": ok(response(settings)),
        "POST /api/v1/email/test": test,
      });
      await user.click(await screen.findByRole("button", { name: "Enviar correo de prueba" }));
      const dialog = await screen.findByRole("dialog", { name: "Enviar correo de prueba" });
      return { user, calls, dialog };
    };

    it("propone el correo de prueba y muestra dentro que el servidor lo aceptó", async () => {
      const { user, calls, dialog } = await openTest(
        ok({
          accepted: true,
          message: "El servidor aceptó el correo de prueba.",
          to: "pruebas@empresa.ec",
          at: AT,
        }),
      );
      expect((within(dialog).getByLabelText("Enviar a") as HTMLInputElement).value).toBe(
        "pruebas@empresa.ec",
      );
      await user.click(within(dialog).getByRole("button", { name: "Enviar prueba" }));
      expect(
        await within(dialog).findByText(
          /El servidor aceptó el correo de prueba\. Revisa la bandeja de entrada de pruebas@empresa\.ec/,
        ),
      ).toBeDefined();
      expect(calls).toContainEqual({
        key: "POST /api/v1/email/test",
        body: { to: "pruebas@empresa.ec" },
      });
    });

    it("sin correo de prueba propone el del administrador; un rechazo muestra su motivo dentro", async () => {
      const { user, dialog } = await openTest(
        ok({
          accepted: false,
          message: "El servidor rechazó el usuario o la contraseña.",
          to: ADMIN_ME.email,
          at: AT,
        }),
        { ...SETTINGS, testRecipient: null },
      );
      expect((within(dialog).getByLabelText("Enviar a") as HTMLInputElement).value).toBe(
        ADMIN_ME.email,
      );
      await user.click(within(dialog).getByRole("button", { name: "Enviar prueba" }));
      expect(
        within(await within(dialog).findByRole("alert")).getByText(
          "El servidor rechazó el usuario o la contraseña.",
        ),
      ).toBeDefined();
    });

    it("con el envío apagado en el despliegue lo explica dentro", async () => {
      const { user, dialog } = await openTest(() => ({
        status: 409,
        body: errorBody(
          "EMAIL_DELIVERY_DISABLED",
          "El envío de correos está desactivado en este despliegue.",
        ),
      }));
      await user.click(within(dialog).getByRole("button", { name: "Enviar prueba" }));
      expect(
        await within(dialog).findByText("El envío de correos está desactivado en este despliegue."),
      ).toBeDefined();
    });

    it("el límite por minuto se explica dentro, y cerrar limpia el resultado", async () => {
      const { user, dialog } = await openTest(() => ({
        status: 429,
        body: errorBody("EMAIL_TEST_RATE_LIMITED", "Too many requests"),
      }));
      await user.click(within(dialog).getByRole("button", { name: "Enviar prueba" }));
      expect(
        await within(dialog).findByText(/Puedes enviar hasta 5 correos de prueba por minuto/),
      ).toBeDefined();
      await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      await user.click(screen.getByRole("button", { name: "Enviar correo de prueba" }));
      const reopened = await screen.findByRole("dialog", { name: "Enviar correo de prueba" });
      expect(within(reopened).queryByText(/Puedes enviar hasta 5/)).toBeNull();
    });

    it("con cambios sin guardar avisa que la prueba usa el servidor guardado", async () => {
      const user = userEvent.setup();
      renderEmail({ "GET /api/v1/email/settings": ok(response()) });
      await user.type(await screen.findByLabelText("Servidor"), "x");
      await user.click(screen.getByRole("button", { name: "Enviar correo de prueba" }));
      const dialog = await screen.findByRole("dialog", { name: "Enviar correo de prueba" });
      expect(
        within(dialog).getByText("Tienes cambios sin guardar: la prueba usa el servidor guardado."),
      ).toBeDefined();
    });
  });
});
