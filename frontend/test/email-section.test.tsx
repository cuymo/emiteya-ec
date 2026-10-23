// Tarjeta «Correo» de la pestaña de documentos (add-email-delivery, tarea 10.1, design D14): cada
// estado del último envío con su motivo y sus direcciones, sin envíos, la nota de Pruebas, el
// recordatorio de la liquidación, el historial con los intentos, el reenvío (éxito, error, el mismo
// intento repetido con su clave, Pruebas y direcciones inválidas), sin permiso sin el botón, el
// teclado y la atención de la pestaña cuando el último envío falló.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InvoiceView } from "@facturador/contracts";
import { SessionGate } from "@/components/session";
import { DocumentsSection } from "@/features/archive/documents-section";
import { DocumentDetailTabs } from "@/features/documents/document-detail-tabs";
import { useEmailNeedsAttention } from "@/features/email/email-api";
import {
  ADMIN_ME,
  OPERATOR_ME,
  errorBody,
  mockApi,
  navigation,
  renderApp,
  type Route,
} from "./harness";

const { denied } = vi.hoisted(() => ({ denied: new Set<string>() }));
vi.mock("@/lib/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/permissions")>();
  return {
    ...actual,
    canSee: (...args: Parameters<typeof actual.canSee>) =>
      !denied.has(args[1]) && actual.canSee(...args),
  };
});

const AT = "2026-10-23T15:00:00.000Z";
const SUMMARY = {
  id: "inv-1",
  documentType: "01",
  number: "001-001-000000001",
  issueDate: "2026-10-23",
  buyer: { name: "EL PERNO CIA. LTDA.", identification: "0992877878001" },
  total: "28.75",
  recipients: null,
  state: "AUTHORIZED",
  transmissionStopped: false,
  documents: { ride: "AVAILABLE", authorizedXml: true, signedXml: true },
  artifacts: [],
  rideGeneration: {
    status: "AVAILABLE",
    reason: null,
    stoppedAt: null,
    retryable: false,
  },
};
const delivery = (overrides: Record<string, unknown> = {}) => ({
  id: "mail-1",
  origin: "AUTOMATIC",
  requestedBy: null,
  environment: "PRODUCTION",
  testRedirect: false,
  status: "SENT",
  recipients: [{ address: "compras@cliente.ec", outcome: "ACCEPTED", reason: null }],
  reason: null,
  createdAt: AT,
  sentAt: AT,
  finishedAt: AT,
  attempts: [{ number: 1, at: AT, outcome: "SENT", smtpCode: 250 }],
  ...overrides,
});
const PROPOSED = {
  recipients: ["compras@cliente.ec", "pagos@cliente.ec"],
  environment: "PRODUCTION",
  testRedirect: false,
  testRecipient: null,
};
const ok =
  (data: unknown): Route =>
  () => ({ status: 200, body: { data } });

function render(
  routes: Record<string, Route>,
  {
    me = OPERATOR_ME,
    documentType = "01",
  }: { me?: typeof ADMIN_ME | typeof OPERATOR_ME; documentType?: string } = {},
) {
  const calls = mockApi({
    "GET /api/v1/me": ok(me),
    "GET /api/v1/documents/inv-1": ok({ ...SUMMARY, documentType }),
    ...routes,
  });
  renderApp(
    <SessionGate fallback={<p>cargando</p>}>
      <DocumentsSection
        document={{ id: "inv-1", documentType, state: "AUTHORIZED" } as InvoiceView}
      />
    </SessionGate>,
  );
  return calls;
}
/** Lo que la tarjeta muestra fuera del historial plegable, que repite el último envío. */
const OUTSIDE_HISTORY = { ignore: "details *" };
const card = async () =>
  (await screen.findByRole("heading", { name: "Correo" })).closest("section")!;

beforeEach(() => {
  navigation.pathname = "/facturas/inv-1";
  navigation.search = new URLSearchParams();
  denied.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("tarjeta Correo", () => {
  it("sin envíos lo dice y ofrece «Enviar correo»", async () => {
    render({ "GET /api/v1/documents/inv-1/email-deliveries": ok([]) });
    const section = await card();
    expect(
      await within(section).findByText("Todavía no se envió por correo.", OUTSIDE_HISTORY),
    ).toBeDefined();
    expect(within(section).getByRole("button", { name: "Enviar correo" })).toBeDefined();
    expect(within(section).queryByText("Historial de envíos")).toBeNull();
  });

  it("enviado: dice que el servidor lo aceptó, sin afirmar que llegó, con sus direcciones", async () => {
    render({
      "GET /api/v1/documents/inv-1/email-deliveries": ok([
        delivery({
          recipients: [
            { address: "compras@cliente.ec", outcome: "ACCEPTED", reason: null },
            {
              address: "viejo@cliente.ec",
              outcome: "REJECTED",
              reason: "El servidor de correo rechazó la dirección.",
            },
          ],
        }),
      ]),
    });
    const section = await card();
    expect(await within(section).findByText("Enviado", OUTSIDE_HISTORY)).toBeDefined();
    expect(within(section).getByText(/^Automático · /, OUTSIDE_HISTORY)).toBeDefined();
    expect(
      within(section).getByText(
        "El servidor de correo lo aceptó. No confirma que llegó al buzón del receptor.",
        OUTSIDE_HISTORY,
      ),
    ).toBeDefined();
    const addresses = within(section)
      .getAllByRole("list", { name: "Direcciones" })
      .find((list) => !list.closest("details"))!;
    expect(within(addresses).getByText("Aceptada")).toBeDefined();
    expect(within(addresses).getByText("Rechazada")).toBeDefined();
    expect(
      within(addresses).getByText("El servidor de correo rechazó la dirección."),
    ).toBeDefined();
    expect(within(section).getByRole("button", { name: "Reenviar correo" })).toBeDefined();
  });

  it.each([
    ["FAILED", "No enviado", "El servidor rechazó el usuario o la contraseña."],
    ["RETRYING", "Reintentando", "El servidor de correo no respondió a tiempo."],
    [
      "NO_RECIPIENT",
      "Sin destinatario",
      "El receptor no tiene correo: entrega el RIDE impreso si el receptor lo pide.",
    ],
    [
      "DISABLED",
      "Desactivado",
      "El envío automático está desactivado: puedes enviar el correo a mano.",
    ],
    ["PENDING", "Pendiente", null],
  ])("%s: muestra «%s» con su motivo", async (status, label, reason) => {
    render({
      "GET /api/v1/documents/inv-1/email-deliveries": ok([
        delivery({ status, reason, sentAt: null, recipients: [], attempts: [] }),
      ]),
    });
    const section = await card();
    expect(await within(section).findByText(label, OUTSIDE_HISTORY)).toBeDefined();
    expect(
      within(section).getByText(reason ?? "Saldrá en unos segundos.", OUTSIDE_HISTORY),
    ).toBeDefined();
  });

  it("un reenvío dice quién lo pidió, y en Pruebas que fue solo al correo de prueba", async () => {
    render({
      "GET /api/v1/documents/inv-1/email-deliveries": ok([
        delivery({
          origin: "MANUAL",
          requestedBy: { name: "Óscar Operador" },
          environment: "TEST",
          testRedirect: true,
          recipients: [{ address: "pruebas@empresa.ec", outcome: "ACCEPTED", reason: null }],
        }),
      ]),
    });
    const section = await card();
    expect(
      await within(section).findByText(/^Reenvío de Óscar Operador · /, OUTSIDE_HISTORY),
    ).toBeDefined();
    expect(
      within(section).getAllByText(
        "Ambiente de Pruebas: fue solo al correo de prueba, no al receptor.",
        OUTSIDE_HISTORY,
      ).length,
    ).toBeGreaterThan(0);
  });

  it("la liquidación recuerda imprimir los dos RIDE para que los firme el proveedor", async () => {
    render({ "GET /api/v1/documents/inv-1/email-deliveries": ok([]) }, { documentType: "03" });
    const section = await card();
    expect(
      await within(section).findByText(
        /imprime dos ejemplares del RIDE para que los firme el proveedor/,
        OUTSIDE_HISTORY,
      ),
    ).toBeDefined();
  });

  it("el historial plegable muestra cada envío, del más reciente al más antiguo, con sus intentos", async () => {
    const user = userEvent.setup();
    render({
      "GET /api/v1/documents/inv-1/email-deliveries": ok([
        delivery({ id: "mail-2", origin: "MANUAL", requestedBy: { name: "Ana Admin" } }),
        delivery({
          id: "mail-1",
          status: "FAILED",
          sentAt: null,
          reason: "El servidor de correo no respondió a tiempo.",
          recipients: [{ address: "compras@cliente.ec", outcome: null, reason: null }],
          attempts: [
            { number: 1, at: AT, outcome: "RETRYABLE", smtpCode: 421 },
            { number: 2, at: AT, outcome: "RETRYABLE", smtpCode: null },
          ],
        }),
      ]),
    });
    const section = await card();
    await user.click(await within(section).findByText("Historial de envíos"));
    const history = within(section).getByRole("list", { name: "Historial de envíos" });
    const entries = within(history)
      .getAllByRole("listitem")
      .filter((item) => item.parentElement === history);
    expect(entries).toHaveLength(2);
    expect(within(entries[0]!).getByText(/^Reenvío de Ana Admin/)).toBeDefined();
    expect(within(entries[1]!).getByText("No enviado")).toBeDefined();
    expect(within(entries[1]!).getByText("Pendiente")).toBeDefined();
    expect(
      within(entries[1]!).getByText(/^Intento 1 · .* · Fallo temporal \(código 421\)$/),
    ).toBeDefined();
    expect(within(entries[1]!).getByText(/^Intento 2 · .* · Fallo temporal$/)).toBeDefined();
  });

  it("sin permiso para reenviar no hay botón, aunque ve los envíos", async () => {
    denied.add("email.resend");
    const calls = render({ "GET /api/v1/documents/inv-1/email-deliveries": ok([delivery()]) });
    const section = await card();
    expect(await within(section).findByText("Enviado", OUTSIDE_HISTORY)).toBeDefined();
    expect(within(section).queryByRole("button", { name: /correo/ })).toBeNull();
    expect(calls.some((call) => call.key.endsWith("/email-recipients"))).toBe(false);
  });
});

describe("reenvío del correo", () => {
  const open = async (routes: Record<string, Route>) => {
    const user = userEvent.setup();
    const calls = render({
      "GET /api/v1/documents/inv-1/email-deliveries": ok([delivery({ status: "FAILED" })]),
      "GET /api/v1/documents/inv-1/email-recipients": ok(PROPOSED),
      ...routes,
    });
    await user.click(await within(await card()).findByRole("button", { name: "Reenviar correo" }));
    const dialog = await screen.findByRole("dialog", { name: "Reenviar correo" });
    return { user, calls, dialog };
  };
  const input = (dialog: HTMLElement, position: number) =>
    within(dialog).getByLabelText(`Correo ${position}`) as HTMLInputElement;

  it("propone las direcciones del receptor, se editan y el envío vuelve a consultar el historial", async () => {
    const keys: string[] = [];
    const { user, calls, dialog } = await open({
      "POST /api/v1/documents/inv-1/email-deliveries": (init) => {
        keys.push(new Headers(init.headers).get("Idempotency-Key") ?? "");
        return { status: 202, body: { data: delivery({ id: "mail-2", status: "PENDING" }) } };
      },
    });
    expect(await within(dialog).findByDisplayValue("compras@cliente.ec")).toBeDefined();
    expect(input(dialog, 2).value).toBe("pagos@cliente.ec");
    await user.click(within(dialog).getByRole("button", { name: "Quitar el correo 1" }));
    await user.click(within(dialog).getByRole("button", { name: "Agregar correo" }));
    await user.keyboard("tesoreria@cliente.ec");
    const historyReads = () =>
      calls.filter((call) => call.key === "GET /api/v1/documents/inv-1/email-deliveries").length;
    const before = historyReads();
    await user.click(within(dialog).getByRole("button", { name: "Reenviar correo" }));
    expect(await screen.findByText("Programaste el envío del correo.")).toBeDefined();
    expect(calls.find((call) => call.key.startsWith("POST"))?.body).toEqual({
      recipients: ["pagos@cliente.ec", "tesoreria@cliente.ec"],
    });
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(historyReads()).toBeGreaterThan(before));
  });

  it("un rechazo del servidor se explica dentro del diálogo, que sigue abierto", async () => {
    const { user, dialog } = await open({
      "POST /api/v1/documents/inv-1/email-deliveries": () => ({
        status: 409,
        body: errorBody(
          "EMAIL_DELIVERY_DISABLED",
          "El envío de correos está desactivado en este despliegue.",
        ),
      }),
    });
    await within(dialog).findByDisplayValue("compras@cliente.ec");
    await user.click(within(dialog).getByRole("button", { name: "Reenviar correo" }));
    expect(
      await within(dialog).findByText("El envío de correos está desactivado en este despliegue."),
    ).toBeDefined();
    expect(screen.getByRole("dialog", { name: "Reenviar correo" })).toBeDefined();
  });

  it("reintentar la misma solicitud reutiliza su clave; cambiar las direcciones usa otra", async () => {
    const keys: string[] = [];
    const { user, dialog } = await open({
      "POST /api/v1/documents/inv-1/email-deliveries": (init) => {
        keys.push(new Headers(init.headers).get("Idempotency-Key") ?? "");
        return { status: 503, body: errorBody("UNAVAILABLE", "x") };
      },
    });
    await within(dialog).findByDisplayValue("compras@cliente.ec");
    const submit = within(dialog).getByRole("button", { name: "Reenviar correo" });
    await user.click(submit);
    await waitFor(() => expect(keys).toHaveLength(1));
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
    await user.click(submit);
    await waitFor(() => expect(keys).toHaveLength(2));
    expect(keys[1]).toBe(keys[0]);
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
    await user.click(within(dialog).getByRole("button", { name: "Quitar el correo 2" }));
    await user.click(submit);
    await waitFor(() => expect(keys).toHaveLength(3));
    expect(keys[2]).not.toBe(keys[0]);
  });

  it("una dirección inválida o repetida se marca en su campo y no se envía", async () => {
    const { user, calls, dialog } = await open({});
    await within(dialog).findByDisplayValue("compras@cliente.ec");
    await user.clear(input(dialog, 2));
    await user.type(input(dialog, 2), "COMPRAS@cliente.ec");
    await user.click(within(dialog).getByRole("button", { name: "Agregar correo" }));
    await user.keyboard("no-es-correo");
    await user.click(within(dialog).getByRole("button", { name: "Reenviar correo" }));
    expect(await within(dialog).findByText("El correo está repetido.")).toBeDefined();
    expect(input(dialog, 3).getAttribute("aria-invalid")).toBe("true");
    expect(calls.some((call) => call.key.startsWith("POST"))).toBe(false);
  });

  it("sin direcciones pide al menos una", async () => {
    const { user, calls, dialog } = await open({
      "GET /api/v1/documents/inv-1/email-recipients": ok({ ...PROPOSED, recipients: [] }),
    });
    expect(
      await within(dialog).findByText(
        "El receptor no tiene correo registrado: escribe a qué dirección enviarlo.",
      ),
    ).toBeDefined();
    await user.click(within(dialog).getByRole("button", { name: "Reenviar correo" }));
    expect(await within(dialog).findByText("Escribe al menos un correo.")).toBeDefined();
    expect(calls.some((call) => call.key.startsWith("POST"))).toBe(false);
  });

  it("en Pruebas va solo al correo de prueba; sin él, lo explica sin enviar", async () => {
    const { user, calls, dialog } = await open({
      "GET /api/v1/documents/inv-1/email-recipients": ok({
        ...PROPOSED,
        environment: "TEST",
        testRedirect: true,
        testRecipient: "pruebas@empresa.ec",
      }),
      "POST /api/v1/documents/inv-1/email-deliveries": () => ({
        status: 202,
        body: {
          data: delivery({
            status: "PENDING",
            testRedirect: true,
            recipients: [{ address: "pruebas@empresa.ec", outcome: null, reason: null }],
          }),
        },
      }),
    });
    expect(
      await within(dialog).findByText(
        /el correo irá solo al correo de prueba pruebas@empresa\.ec, nunca al receptor/,
      ),
    ).toBeDefined();
    expect(within(dialog).queryByLabelText("Correo 1")).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Reenviar correo" }));
    expect(
      await screen.findByText("Programaste el envío al correo de prueba pruebas@empresa.ec."),
    ).toBeDefined();
    expect(calls.find((call) => call.key.startsWith("POST"))?.body).toEqual({
      recipients: ["pruebas@empresa.ec"],
    });
  });

  it("en Pruebas sin correo de prueba no envía", async () => {
    const { user, calls, dialog } = await open({
      "GET /api/v1/documents/inv-1/email-recipients": ok({
        ...PROPOSED,
        environment: "TEST",
        testRedirect: true,
        testRecipient: null,
      }),
    });
    await within(dialog).findByText(/configura el correo de prueba/);
    await user.click(within(dialog).getByRole("button", { name: "Reenviar correo" }));
    expect(within(dialog).getAllByText(/configura el correo de prueba/).length).toBe(2);
    expect(calls.some((call) => call.key.startsWith("POST"))).toBe(false);
  });

  it("se abre y se cierra con el teclado, y el foco vuelve a «Reenviar correo»", async () => {
    const user = userEvent.setup();
    render({
      "GET /api/v1/documents/inv-1/email-deliveries": ok([delivery()]),
      "GET /api/v1/documents/inv-1/email-recipients": ok(PROPOSED),
    });
    const trigger = await within(await card()).findByRole("button", { name: "Reenviar correo" });
    trigger.focus();
    await user.keyboard("{Enter}");
    const dialog = await screen.findByRole("dialog", { name: "Reenviar correo" });
    await within(dialog).findByDisplayValue("compras@cliente.ec");
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});

describe("atención de la pestaña de documentos", () => {
  function Tabs({ state }: { state: InvoiceView["state"] }) {
    const attention = useEmailNeedsAttention({ id: "inv-1", state });
    return (
      <DocumentDetailTabs
        label="Secciones"
        tabs={[
          { id: "resumen", label: "Resumen", content: null },
          { id: "documentos", label: "RIDE y XML", content: null, attention },
        ]}
      />
    );
  }
  const renderTabs = (
    routes: Record<string, Route>,
    state: InvoiceView["state"] = "AUTHORIZED",
  ) => {
    const calls = mockApi({ "GET /api/v1/me": ok(OPERATOR_ME), ...routes });
    renderApp(
      <SessionGate fallback={<p>cargando</p>}>
        <Tabs state={state} />
      </SessionGate>,
    );
    return calls;
  };

  it("pide atención cuando el último envío falló", async () => {
    renderTabs({
      "GET /api/v1/documents/inv-1/email-deliveries": ok([delivery({ status: "FAILED" })]),
    });
    expect(await screen.findByRole("tab", { name: "RIDE y XML, requiere atención" })).toBeDefined();
  });

  it("no la pide si el último se envió, aunque uno anterior fallara", async () => {
    renderTabs({
      "GET /api/v1/documents/inv-1/email-deliveries": ok([
        delivery({ id: "mail-2" }),
        delivery({ status: "FAILED" }),
      ]),
    });
    await screen.findByRole("tab", { name: "Resumen" });
    await waitFor(() => expect(screen.getByRole("tab", { name: "RIDE y XML" })).toBeDefined());
  });

  it("un comprobante sin autorizar no consulta sus envíos", async () => {
    const calls = renderTabs({}, "SIGNED");
    await screen.findByRole("tab", { name: "RIDE y XML" });
    expect(calls.some((call) => call.key.includes("email-deliveries"))).toBe(false);
  });
});
