// Destino del correo en la confirmación «Emitir» (add-email-delivery, tarea 10.2, design D14; spec
// email-delivery, «Destino del correo al emitir»): cada caso en el orden del servidor, con un
// operador, que ve el destino sin consultar la configuración del correo; los correos del receptor
// solo se consultan si el correo va a salir hacia él.
import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionGate } from "@/components/session";
import {
  EmailDestinationNotice,
  type EmailReceivers,
} from "@/features/email/email-destination-notice";
import { OPERATOR_ME, errorBody, mockApi, navigation, renderApp, type Route } from "./harness";

const ok =
  (data: unknown): Route =>
  () => ({ status: 200, body: { data } });
const status = (environment: "TEST" | "PRODUCTION") =>
  ok({ environment, displayName: "COMERCIAL ANDINA S.A.", readiness: { ready: true, checks: [] } });
const availability = (overrides: Record<string, unknown> = {}) =>
  ok({
    configured: true,
    deliveryEnabled: true,
    autoSend: true,
    testRecipient: null,
    ...overrides,
  });
const party = (id: string, legalName: string, emails: string[]) =>
  ok({
    id,
    identificationType: "04",
    identificationTypeLabel: "RUC",
    identification: "0992877878001",
    legalName,
    address: null,
    emails,
    phone: null,
    roles: ["CUSTOMER"],
    status: "ACTIVE",
    systemRecord: null,
    version: 1,
    createdAt: "2026-10-03T10:00:00.000Z",
    updatedAt: "2026-10-03T10:00:00.000Z",
  });
const BUYER: EmailReceivers = { parties: [{ id: "party-1", legalName: "EL PERNO CIA. LTDA." }] };

function render(
  receivers: EmailReceivers,
  routes: Record<string, Route>,
  { open = true }: { open?: boolean } = {},
) {
  const calls = mockApi({
    "GET /api/v1/me": ok(OPERATOR_ME),
    "GET /api/v1/company/status": status("PRODUCTION"),
    "GET /api/v1/email/availability": availability(),
    ...routes,
  });
  renderApp(
    <SessionGate fallback={<p>cargando</p>}>
      <EmailDestinationNotice open={open} receivers={receivers} />
    </SessionGate>,
  );
  return calls;
}
const notice = async (text: string | RegExp) => {
  const element = await screen.findByText(text);
  return element.closest("[data-slot=email-destination-notice]")!;
};
const keys = (calls: { key: string }[]) => calls.map((call) => call.key);

beforeEach(() => {
  navigation.pathname = "/borradores/draft-1";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("destino del correo al emitir", () => {
  it("receptor con correos: dice a qué direcciones irá, sin consultar la configuración", async () => {
    const calls = render(BUYER, {
      "GET /api/v1/parties/party-1": party("party-1", "EL PERNO CIA. LTDA.", [
        "compras@cliente.ec",
        "pagos@cliente.ec",
      ]),
    });
    const element = await notice("Se enviará por correo a: compras@cliente.ec, pagos@cliente.ec.");
    expect(element.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(keys(calls)).not.toContain("GET /api/v1/email/settings");
  });

  it("receptor sin correo: lo dice, pide el RIDE impreso y enlaza al tercero en otra pestaña", async () => {
    render(BUYER, { "GET /api/v1/parties/party-1": party("party-1", "EL PERNO CIA. LTDA.", []) });
    await notice(
      /No se enviará por correo: EL PERNO CIA\. LTDA\. no tiene correo\. Entrega el RIDE impreso/,
    );
    const link = screen.getByRole("link", { name: /Agregar su correo/ });
    expect(link.getAttribute("href")).toBe("/terceros/party-1");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("consumidor final: no sale correo y no consulta al tercero", async () => {
    const calls = render({ ...BUYER, consumerFinal: true }, {});
    await notice(
      "No se enviará por correo: es una venta a consumidor final. Entrega el RIDE impreso si lo pide.",
    );
    expect(keys(calls).some((key) => key.startsWith("GET /api/v1/parties"))).toBe(false);
  });

  it("Pruebas: irá solo al correo de prueba, sin consultar al receptor", async () => {
    const calls = render(BUYER, {
      "GET /api/v1/company/status": status("TEST"),
      "GET /api/v1/email/availability": availability({ testRecipient: "revision@empresa.ec" }),
    });
    await notice(
      "Pruebas: el correo irá solo al correo de prueba revision@empresa.ec, no al receptor.",
    );
    expect(keys(calls).some((key) => key.startsWith("GET /api/v1/parties"))).toBe(false);
  });

  it("Pruebas sin correo de prueba: no sale correo", async () => {
    render(BUYER, { "GET /api/v1/company/status": status("TEST") });
    await notice(/No se enviará por correo: falta el correo de prueba/);
  });

  it.each([
    [{ autoSend: false }, /el envío automático está apagado\. Podrás enviarlo desde su detalle\./],
    [
      { configured: false, autoSend: false },
      /la empresa no tiene un servidor de correo configurado/,
    ],
    [{ deliveryEnabled: false }, /el envío de correos está apagado en esta instalación/],
  ])("apagado (%o): dice por qué no saldrá, sin consultar al receptor", async (overrides, text) => {
    const calls = render(BUYER, { "GET /api/v1/email/availability": availability(overrides) });
    await notice(text);
    expect(keys(calls).some((key) => key.startsWith("GET /api/v1/parties"))).toBe(false);
  });

  it("notas: las direcciones del comprador de la factura que modifican", async () => {
    const calls = render(
      { invoiceId: "inv-1" },
      {
        "GET /api/v1/documents/inv-1/email-recipients": ok({
          recipients: ["compras@cliente.ec"],
          environment: "PRODUCTION",
          testRedirect: false,
          testRecipient: null,
        }),
      },
    );
    await notice("Se enviará por correo a: compras@cliente.ec.");
    expect(keys(calls)).toContain("GET /api/v1/documents/inv-1/email-recipients");
  });

  it("notas sin correo del comprador: no sale correo", async () => {
    render(
      { invoiceId: "inv-1" },
      {
        "GET /api/v1/documents/inv-1/email-recipients": ok({
          recipients: [],
          environment: "PRODUCTION",
          testRedirect: false,
          testRecipient: null,
        }),
      },
    );
    await notice(/el comprador de la factura no tiene correo/);
  });

  it("guía: los destinatarios y el transportista, sin repetir terceros ni direcciones", async () => {
    const calls = render(
      {
        parties: [
          { id: "cli-1", legalName: "EL PERNO CIA. LTDA." },
          { id: "cli-2", legalName: "FERRETERÍA SUR" },
          { id: "cli-1", legalName: "EL PERNO CIA. LTDA." },
          { id: "car-1", legalName: "TRANSPORTES ANDINOS S.A." },
        ],
      },
      {
        "GET /api/v1/parties/cli-1": party("cli-1", "EL PERNO CIA. LTDA.", ["compras@perno.ec"]),
        "GET /api/v1/parties/cli-2": party("cli-2", "FERRETERÍA SUR", [
          "COMPRAS@perno.ec",
          "sur@ferreteria.ec",
        ]),
        "GET /api/v1/parties/car-1": party("car-1", "TRANSPORTES ANDINOS S.A.", [
          "flota@andinos.ec",
        ]),
      },
    );
    await notice("Se enviará por correo a: compras@perno.ec, sur@ferreteria.ec, flota@andinos.ec.");
    expect(keys(calls).filter((key) => key === "GET /api/v1/parties/cli-1")).toHaveLength(1);
  });

  it("guía sin correos de sus receptores: no sale correo", async () => {
    render(
      {
        parties: [
          { id: "cli-1", legalName: "EL PERNO CIA. LTDA." },
          { id: "car-1", legalName: "TRANSPORTES ANDINOS S.A." },
        ],
      },
      {
        "GET /api/v1/parties/cli-1": party("cli-1", "EL PERNO CIA. LTDA.", []),
        "GET /api/v1/parties/car-1": party("car-1", "TRANSPORTES ANDINOS S.A.", []),
      },
    );
    await notice(/ninguno de sus receptores tiene correo/);
  });

  it("si no puede consultar la disponibilidad, lo dice sin inventar un destino", async () => {
    render(BUYER, {
      "GET /api/v1/email/availability": () => ({
        status: 403,
        body: errorBody("FORBIDDEN", "No."),
      }),
    });
    await notice("No pudimos saber si se enviará por correo.");
  });

  it("con la confirmación cerrada no consulta nada", async () => {
    const calls = render(BUYER, {}, { open: false });
    await waitFor(() => expect(keys(calls)).toContain("GET /api/v1/me"));
    expect(keys(calls)).not.toContain("GET /api/v1/email/availability");
    expect(document.querySelector("[data-slot=email-destination-notice]")).toBeNull();
  });
});
