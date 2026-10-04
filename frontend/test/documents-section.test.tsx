// Sección "Documentos" del detalle de la factura (add-document-archive, tarea 10.3, design D13):
// cada estado del RIDE, el refresco mientras se prepara, el reintento, la impresión que primero
// registra la solicitud, los errores explicados, el acceso y el foco tras las acciones.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InvoiceView } from "@facturador/contracts";
import { SessionGate } from "@/components/session";
import { DocumentsSection } from "@/features/archive/documents-section";
import {
  ADMIN_ME,
  OPERATOR_ME,
  errorBody,
  mockApi,
  navigation,
  renderApp,
  type Route,
} from "./harness";

const INVOICE = {
  id: "inv-1",
  documentNumber: "001-001-000000001",
  state: "AUTHORIZED",
} as InvoiceView;
const summary = (
  state: string,
  documents: { ride: string; authorizedXml: boolean; signedXml: boolean },
  rideGeneration: Record<string, unknown> = {},
) => ({
  id: "inv-1",
  documentType: "01",
  number: "001-001-000000001",
  issueDate: "2026-10-04",
  buyer: { name: "EL PERNO CIA. LTDA.", identification: "0992877878001" },
  total: "28.75",
  state,
  transmissionStopped: false,
  documents,
  artifacts: [],
  rideGeneration: {
    status: documents.ride,
    reason: null,
    stoppedAt: null,
    retryable: false,
    ...rideGeneration,
  },
});
const AVAILABLE = summary("AUTHORIZED", {
  ride: "AVAILABLE",
  authorizedXml: true,
  signedXml: true,
});
const ok =
  (data: unknown): Route =>
  () => ({ status: 200, body: { data } });

function render(
  routes: Record<string, Route>,
  me: typeof ADMIN_ME | typeof OPERATOR_ME = OPERATOR_ME,
  invoice: InvoiceView = INVOICE,
) {
  const calls = mockApi({
    "GET /api/v1/me": () => ({ status: 200, body: { data: me } }),
    ...routes,
  });
  renderApp(
    <SessionGate fallback={<p>cargando</p>}>
      <DocumentsSection invoice={invoice} />
    </SessionGate>,
  );
  return calls;
}
const print = vi.fn();

beforeEach(() => {
  navigation.pathname = "/facturas/inv-1";
  navigation.search = new URLSearchParams();
  vi.stubGlobal(
    "URL",
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:ride"), revokeObjectURL: vi.fn() }),
  );
  print.mockReset();
  // jsdom no carga el PDF del iframe: se simula la carga y su ventana de impresión.
  vi.spyOn(HTMLIFrameElement.prototype, "contentWindow", "get").mockReturnValue({
    focus: () => {},
    print,
  } as unknown as Window);
  const append = Element.prototype.append;
  vi.spyOn(Element.prototype, "append").mockImplementation(function (this: Element, ...nodes) {
    append.apply(this, nodes);
    for (const node of nodes) {
      if (node instanceof HTMLIFrameElement) setTimeout(() => node.onload?.(new Event("load")), 0);
    }
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Documentos de la factura", () => {
  it("autorizada con RIDE: descargar el RIDE es la acción principal, con imprimir y los XML", async () => {
    render({ "GET /api/v1/documents/inv-1": ok(AVAILABLE) });
    expect(await screen.findByText("El RIDE está listo para entregarse.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Descargar RIDE" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Imprimir" })).toBeDefined();
    expect(screen.getByRole("button", { name: "XML autorizado" })).toBeDefined();
    expect(screen.getByRole("button", { name: "XML firmado" })).toBeDefined();
  });

  it("descarga el RIDE y avisa", async () => {
    const calls = render({
      "GET /api/v1/documents/inv-1": ok(AVAILABLE),
      "GET /api/v1/documents/inv-1/ride": () => ({ status: 200, body: "%PDF" }),
    });
    await userEvent.setup().click(await screen.findByRole("button", { name: "Descargar RIDE" }));
    expect(await screen.findByText("Descargaste el RIDE.")).toBeDefined();
    expect(calls.some((call) => call.key === "GET /api/v1/documents/inv-1/ride")).toBe(true);
  });

  it("imprimir registra primero la solicitud y después pide el mismo RIDE", async () => {
    const calls = render({
      "GET /api/v1/documents/inv-1": ok(AVAILABLE),
      "POST /api/v1/documents/inv-1/print-requests": () => ({
        status: 201,
        body: { data: { id: "del-1", occurredAt: "2026-10-04T15:00:00.000Z" } },
      }),
      "GET /api/v1/documents/inv-1/ride": () => ({ status: 200, body: "%PDF" }),
    });
    await userEvent.setup().click(await screen.findByRole("button", { name: "Imprimir" }));
    expect(await screen.findByText("Abrimos el RIDE para imprimir.")).toBeDefined();
    const keys = calls.map((call) => call.key);
    expect(keys.indexOf("POST /api/v1/documents/inv-1/print-requests")).toBeLessThan(
      keys.indexOf("GET /api/v1/documents/inv-1/ride"),
    );
    await waitFor(() => expect(print).toHaveBeenCalledOnce());
  });

  it("si la solicitud de impresión falla, no pide el RIDE ni abre el diálogo, y explica la integridad", async () => {
    const calls = render({
      "GET /api/v1/documents/inv-1": ok(AVAILABLE),
      "POST /api/v1/documents/inv-1/print-requests": () => ({
        status: 500,
        body: errorBody("ARTIFACT_INTEGRITY_FAILED", "x"),
      }),
    });
    await userEvent.setup().click(await screen.findByRole("button", { name: "Imprimir" }));
    expect(
      await screen.findByText(
        "El documento guardado no pasó la verificación de integridad y no se descargó. Avisa al administrador.",
      ),
    ).toBeDefined();
    expect(calls.some((call) => call.key === "GET /api/v1/documents/inv-1/ride")).toBe(false);
    expect(print).not.toHaveBeenCalled();
  });

  it("con el RIDE en preparación lo indica y vuelve a consultar cada 5 s", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let ride = "PENDING";
    const calls = render({
      "GET /api/v1/documents/inv-1": () => ({
        status: 200,
        body: {
          data: summary("AUTHORIZED", { ride, authorizedXml: true, signedXml: true }),
        },
      }),
    });
    expect(await screen.findByText(/Estamos preparando el RIDE/)).toBeDefined();
    expect(screen.queryByRole("button", { name: "Descargar RIDE" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Imprimir" })).toBeNull();
    ride = "AVAILABLE";
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await screen.findByRole("button", { name: "Descargar RIDE" })).toBeDefined();
    expect(
      calls.filter((call) => call.key === "GET /api/v1/documents/inv-1").length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("con la generación detenida muestra el motivo y reintenta, con el foco en la sección", async () => {
    let stopped = true;
    render({
      "GET /api/v1/documents/inv-1": () => ({
        status: 200,
        body: {
          data: stopped
            ? summary(
                "AUTHORIZED",
                { ride: "STOPPED", authorizedXml: true, signedXml: true },
                {
                  reason: "RIDE_GLYPH_MISSING",
                  stoppedAt: "2026-10-04T15:00:00.000Z",
                  retryable: true,
                },
              )
            : summary("AUTHORIZED", { ride: "PENDING", authorizedXml: true, signedXml: true }),
        },
      }),
      "POST /api/v1/documents/inv-1/ride-attempts": () => {
        stopped = false;
        return {
          status: 202,
          body: {
            data: summary("AUTHORIZED", { ride: "PENDING", authorizedXml: true, signedXml: true }),
          },
        };
      },
    });
    expect(await screen.findByText("La preparación del RIDE se detuvo.")).toBeDefined();
    expect(
      screen.getByText(
        "El comprobante tiene caracteres que el RIDE no puede representar con sus fuentes.",
      ),
    ).toBeDefined();
    expect(screen.getByText(/La factura sigue autorizada/)).toBeDefined();
    await userEvent.setup().click(screen.getByRole("button", { name: "Reintentar generación" }));
    expect(await screen.findByText("Volvimos a preparar el RIDE.")).toBeDefined();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Documentos" })),
    );
    expect(await screen.findByText(/Estamos preparando el RIDE/)).toBeDefined();
  });

  it("un reintento rechazado explica el motivo del servidor", async () => {
    render({
      "GET /api/v1/documents/inv-1": ok(
        summary(
          "AUTHORIZED",
          { ride: "STOPPED", authorizedXml: false, signedXml: true },
          { reason: "RIDE_RENDER_TIMEOUT", retryable: true },
        ),
      ),
      "POST /api/v1/documents/inv-1/ride-attempts": () => ({
        status: 409,
        body: errorBody(
          "RIDE_GENERATION_IN_PROGRESS",
          "El RIDE de este comprobante ya se está preparando.",
        ),
      }),
    });
    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Reintentar generación" }));
    expect(
      await screen.findByText("El RIDE de este comprobante ya se está preparando."),
    ).toBeDefined();
  });

  it("sin autorizar solo ofrece el XML firmado, y reservada no ofrece documentos", async () => {
    render({
      "GET /api/v1/documents/inv-1": ok(
        summary("RECEIVED", { ride: "NOT_APPLICABLE", authorizedXml: false, signedXml: true }),
      ),
    });
    expect(
      await screen.findByText("El RIDE estará disponible cuando el SRI autorice la factura."),
    ).toBeDefined();
    const section = screen.getByRole("region", { name: "Documentos" });
    expect(
      within(section)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["XML firmado"]);
  });

  it("reservada no ofrece ningún documento", async () => {
    render({
      "GET /api/v1/documents/inv-1": ok(
        summary("RESERVED", { ride: "NOT_APPLICABLE", authorizedXml: false, signedXml: false }),
      ),
    });
    expect(
      await screen.findByText("Los documentos estarán disponibles cuando la factura se firme."),
    ).toBeDefined();
    expect(
      within(screen.getByRole("region", { name: "Documentos" })).queryAllByRole("button"),
    ).toEqual([]);
  });

  it("muestra el historial de entregas al desplegarlo, sin datos técnicos", async () => {
    render({
      "GET /api/v1/documents/inv-1": ok(AVAILABLE),
      "GET /api/v1/documents/inv-1/deliveries": ok({
        items: [
          {
            id: "d-2",
            event: "PRINT_REQUESTED",
            artifactKind: "RIDE_PDF",
            actorName: "Óscar Operador",
            occurredAt: "2026-10-04T15:05:00.000Z",
          },
          {
            id: "d-1",
            event: "DOWNLOAD",
            artifactKind: "SIGNED_XML",
            actorName: "Ana Admin",
            occurredAt: "2026-10-04T15:00:00.000Z",
          },
        ],
        total: 2,
      }),
    });
    await userEvent.setup().click(await screen.findByText("Historial de entregas"));
    const list = await screen.findByRole("list", { name: "Historial de entregas" });
    expect(within(list).getByText("Solicitud de impresión · RIDE")).toBeDefined();
    expect(within(list).getByText("Descarga · XML firmado")).toBeDefined();
    expect(list.textContent).not.toMatch(/PRINT_REQUESTED|SIGNED_XML|sha/);
  });

  it("si la API niega el acceso, lo explica sin acciones", async () => {
    render(
      { "GET /api/v1/documents/inv-1": () => ({ status: 403, body: errorBody("FORBIDDEN", "x") }) },
      ADMIN_ME,
    );
    expect(
      await screen.findByText(/No tienes acceso a los documentos de esta factura/),
    ).toBeDefined();
    expect(
      within(screen.getByRole("region", { name: "Documentos" })).queryAllByRole("button"),
    ).toEqual([]);
  });
});
