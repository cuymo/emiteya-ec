// Secciones compartidas con la nota de crédito (add-credit-notes, tarea 12.1, design D15): Documentos
// y Transmisión reciben el comprobante y su tipo, con textos por tipo; el RIDE solo de una nota
// autorizada, el XML autorizado solo si existe y el firmado como un documento distinto; la
// transmisión y la reconciliación van a las rutas de la nota con su permiso. La factura, sin
// cambios, la cubren `documents-section.test.tsx` e `invoice-transmission.test.tsx`.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState, type ReactNode } from "react";
import { SessionGate } from "@/components/session";
import { DocumentsSection } from "@/features/archive/documents-section";
import {
  TransmissionSection,
  type TransmissionDocument,
} from "@/features/archive/transmission-section";
import { creditNoteDetail } from "./credit-note-fixtures";
import {
  ADMIN_ME,
  OPERATOR_ME,
  errorBody,
  mockApi,
  navigation,
  renderApp,
  type Route,
} from "./harness";

const NOTE = { id: "nc-1", documentType: "04", state: "AUTHORIZED" } as const;
const summary = (
  state: string,
  documents: { ride: string; authorizedXml: boolean; signedXml: boolean },
  rideGeneration: Record<string, unknown> = {},
) => ({
  id: "nc-1",
  documentType: "04",
  number: "001-001-000000007",
  issueDate: "2026-10-04",
  buyer: { name: "EL PERNO CIA. LTDA.", identification: "0992877878001" },
  total: "11.50",
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
const ok =
  (data: unknown): Route =>
  () => ({ status: 200, body: { data } });

function render(
  ui: ReactNode,
  routes: Record<string, Route>,
  me: typeof ADMIN_ME | typeof OPERATOR_ME = OPERATOR_ME,
) {
  const calls = mockApi({
    "GET /api/v1/me": () => ({ status: 200, body: { data: me } }),
    ...routes,
  });
  renderApp(<SessionGate fallback={<p>cargando</p>}>{ui}</SessionGate>);
  return calls;
}
const transmissionOf = (state: string, transmission: Record<string, unknown> = {}) =>
  creditNoteDetail(state, transmission) as unknown as TransmissionDocument;
const buttonsIn = (name: string) =>
  within(screen.getByRole("region", { name }))
    .queryAllByRole("button")
    .map((button) => button.textContent);

beforeEach(() => {
  navigation.pathname = "/notas-credito/nc-1";
  navigation.search = new URLSearchParams();
  vi.stubGlobal(
    "URL",
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:ride"), revokeObjectURL: vi.fn() }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Documentos de la nota de crédito", () => {
  it("autorizada: RIDE, imprimir, XML autorizado y XML firmado como documentos distintos", async () => {
    const calls = render(<DocumentsSection document={NOTE} />, {
      "GET /api/v1/documents/nc-1": ok(
        summary("AUTHORIZED", { ride: "AVAILABLE", authorizedXml: true, signedXml: true }),
      ),
      "GET /api/v1/documents/nc-1/authorized-xml": () => ({ status: 200, body: "<autorizacion/>" }),
      "GET /api/v1/documents/nc-1/signed-xml": () => ({ status: 200, body: "<notaCredito/>" }),
    });
    expect(await screen.findByText("El RIDE está listo para entregarse.")).toBeDefined();
    expect(buttonsIn("Documentos")).toEqual([
      "Descargar RIDE",
      "Imprimir",
      "XML autorizado",
      "XML firmado",
    ]);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "XML autorizado" }));
    expect(await screen.findByText("Descargaste el XML autorizado.")).toBeDefined();
    await user.click(screen.getByRole("button", { name: "XML firmado" }));
    expect(await screen.findByText("Descargaste el XML firmado.")).toBeDefined();
    const keys = calls.map((call) => call.key);
    expect(keys).toContain("GET /api/v1/documents/nc-1/authorized-xml");
    expect(keys).toContain("GET /api/v1/documents/nc-1/signed-xml");
  });

  it("sin autorizar: sin RIDE ni XML autorizado, solo el firmado, con el texto de la nota", async () => {
    render(<DocumentsSection document={NOTE} />, {
      "GET /api/v1/documents/nc-1": ok(
        summary("RECEIVED", { ride: "NOT_APPLICABLE", authorizedXml: false, signedXml: true }),
      ),
    });
    expect(
      await screen.findByText(
        "El RIDE estará disponible cuando el SRI autorice la nota de crédito.",
      ),
    ).toBeDefined();
    expect(buttonsIn("Documentos")).toEqual(["XML firmado"]);
  });

  it("reservada: sin documentos, con el texto de la nota", async () => {
    render(<DocumentsSection document={NOTE} />, {
      "GET /api/v1/documents/nc-1": ok(
        summary("RESERVED", { ride: "NOT_APPLICABLE", authorizedXml: false, signedXml: false }),
      ),
    });
    expect(
      await screen.findByText(
        "Los documentos estarán disponibles cuando la nota de crédito se firme.",
      ),
    ).toBeDefined();
    expect(buttonsIn("Documentos")).toEqual([]);
  });

  it("autorizada sin XML autorizado guardado: no lo ofrece", async () => {
    render(<DocumentsSection document={NOTE} />, {
      "GET /api/v1/documents/nc-1": ok(
        summary(
          "AUTHORIZED",
          { ride: "STOPPED", authorizedXml: false, signedXml: true },
          { reason: "RIDE_SOURCE_UNSUPPORTED", stoppedAt: "2026-10-04T15:00:00.000Z" },
        ),
      ),
    });
    expect(await screen.findByText("La preparación del RIDE se detuvo.")).toBeDefined();
    expect(screen.getByText(/La nota de crédito sigue autorizada/)).toBeDefined();
    expect(buttonsIn("Documentos")).toEqual(["XML firmado"]);
  });

  it("si la API niega el acceso, lo explica con el tipo", async () => {
    render(
      <DocumentsSection document={NOTE} />,
      {
        "GET /api/v1/documents/nc-1": () => ({ status: 403, body: errorBody("FORBIDDEN", "x") }),
      },
      ADMIN_ME,
    );
    expect(
      await screen.findByText(/No tienes acceso a los documentos de esta nota de crédito/),
    ).toBeDefined();
  });

  it("vuelve a pedir los documentos cuando el comprobante cambia de estado", async () => {
    let server = "SIGNED";
    function Changing() {
      const [state, setState] = useState<"SIGNED" | "AUTHORIZED">("SIGNED");
      return (
        <>
          <button
            onClick={() => {
              server = "AUTHORIZED";
              setState("AUTHORIZED");
            }}
          >
            Autorizar
          </button>
          <DocumentsSection document={{ ...NOTE, state }} />
        </>
      );
    }
    render(<Changing />, {
      "GET /api/v1/documents/nc-1": () => ({
        status: 200,
        body: {
          data:
            server === "SIGNED"
              ? summary("SIGNED", { ride: "NOT_APPLICABLE", authorizedXml: false, signedXml: true })
              : summary("AUTHORIZED", { ride: "AVAILABLE", authorizedXml: true, signedXml: true }),
        },
      }),
    });
    expect(
      await screen.findByText(
        "El RIDE estará disponible cuando el SRI autorice la nota de crédito.",
      ),
    ).toBeDefined();
    await userEvent.setup().click(screen.getByRole("button", { name: "Autorizar" }));
    expect(await screen.findByText("El RIDE está listo para entregarse.")).toBeDefined();
  });

  it("un tipo que el sistema no emite no muestra la sección", async () => {
    const calls = render(
      <>
        <p>detalle</p>
        <DocumentsSection document={{ id: "x-1", documentType: "06", state: "AUTHORIZED" }} />
      </>,
      {},
    );
    expect(await screen.findByText("detalle")).toBeDefined();
    expect(screen.queryByRole("region", { name: "Documentos" })).toBeNull();
    expect(calls.some((call) => call.key.startsWith("GET /api/v1/documents"))).toBe(false);
  });
});

describe("Transmisión de la nota de crédito", () => {
  it("explica el estado con el texto de la nota y pide su historial a la ruta de la nota", async () => {
    const calls = render(<TransmissionSection document={transmissionOf("RECEIVED")} />, {
      "GET /api/v1/credit-notes/nc-1/transmission": ok({
        creditNoteId: "nc-1",
        state: "RECEIVED",
        events: [
          {
            kind: "TRANSITION",
            at: "2026-10-04T15:00:02.000Z",
            fromState: "SIGNED",
            toState: "RECEIVED",
            cause: "SRI_RECEIVED",
            actor: "SYSTEM",
            actorName: null,
          },
        ],
        total: 1,
      }),
    });
    expect(
      await screen.findByText(
        "El SRI recibió la nota de crédito y está decidiendo su autorización; puede tardar hasta 24 horas.",
      ),
    ).toBeDefined();
    await userEvent.setup().click(screen.getByText("Historial de la transmisión"));
    const history = await screen.findByRole("list", { name: "Historial de la transmisión" });
    expect(
      within(history).getByText("Pendiente de envío → Pendiente de autorización"),
    ).toBeDefined();
    expect(calls.map((call) => call.key)).toContain("GET /api/v1/credit-notes/nc-1/transmission");
  });

  it("el administrador reconcilia por la ruta de la nota", async () => {
    let requested: unknown;
    const routes: Record<string, Route> = {
      "POST /api/v1/credit-notes/nc-1/reconciliations": (init) => {
        requested = JSON.parse(init.body as string);
        return {
          status: 202,
          body: { data: creditNoteDetail("MANUAL_REVIEW", { inProgress: true }) },
        };
      },
    };
    const document = transmissionOf("MANUAL_REVIEW", { reconcilable: true });
    render(<TransmissionSection document={document} />, routes, ADMIN_ME);
    expect(
      await screen.findByText(
        "El resultado del SRI no se pudo resolver automáticamente: un administrador debe reconciliar la nota de crédito.",
      ),
    ).toBeDefined();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Reconciliar con el SRI" }));
    const dialog = await screen.findByRole("dialog", { name: "Reconciliar con el SRI" });
    expect(
      within(dialog).getByText(/por la clave de la nota de crédito 001-001-000000007/),
    ).toBeDefined();
    await user.type(within(dialog).getByRole("textbox", { name: "Motivo" }), "Verificar la clave");
    await user.click(within(dialog).getByRole("button", { name: "Reconciliar" }));
    expect(
      await screen.findByText(
        "Pediste la reconciliación de la nota de crédito 001-001-000000007. El estado se actualizará cuando el SRI responda.",
      ),
    ).toBeDefined();
    expect(requested).toEqual({ reason: "Verificar la clave" });
  });

  it("un estado que ya no se reconcilia se explica con el tipo", async () => {
    render(
      <TransmissionSection document={transmissionOf("MANUAL_REVIEW", { reconcilable: true })} />,
      {
        "POST /api/v1/credit-notes/nc-1/reconciliations": () => ({
          status: 409,
          body: errorBody("CREDIT_NOTE_NOT_RECONCILABLE", "x"),
        }),
      },
      ADMIN_ME,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Reconciliar con el SRI" }));
    const dialog = await screen.findByRole("dialog", { name: "Reconciliar con el SRI" });
    await user.type(within(dialog).getByRole("textbox", { name: "Motivo" }), "Verificar");
    await user.click(within(dialog).getByRole("button", { name: "Reconciliar" }));
    expect(
      await screen.findByText(
        "El estado de la nota de crédito cambió y ya no admite una reconciliación. Recarga para ver su estado.",
      ),
    ).toBeDefined();
  });

  it("el operador no ve la reconciliación", async () => {
    render(
      <TransmissionSection document={transmissionOf("MANUAL_REVIEW", { reconcilable: true })} />,
      {},
    );
    await screen.findByText(/un administrador debe reconciliar la nota de crédito/);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Reconciliar con el SRI" })).toBeNull(),
    );
  });
});
