// Secciones compartidas con la nota de débito (add-debit-notes, tarea 10.1, design D19): Documentos y
// Transmisión reciben la nota como cualquier comprobante, con sus textos; el RIDE solo de una nota
// autorizada, el XML autorizado solo si existe y el firmado como un documento distinto; la
// transmisión y la reconciliación van a las rutas de la nota de débito con su permiso. La factura y
// la nota de crédito, sin cambios, las cubren sus propias pruebas.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { SessionGate } from "@/components/session";
import { DocumentsSection } from "@/features/archive/documents-section";
import {
  TransmissionSection,
  type TransmissionDocument,
} from "@/features/archive/transmission-section";
import { debitNoteDetail } from "./debit-note-fixtures";
import {
  ADMIN_ME,
  OPERATOR_ME,
  errorBody,
  mockApi,
  navigation,
  renderApp,
  type Route,
} from "./harness";

const NOTE = { id: "nd-1", documentType: "05", state: "AUTHORIZED" } as const;
const summary = (
  state: string,
  documents: { ride: string; authorizedXml: boolean; signedXml: boolean },
) => ({
  id: "nd-1",
  documentType: "05",
  number: "001-001-000000003",
  issueDate: "2026-10-09",
  buyer: { name: "EL PERNO CIA. LTDA.", identification: "0992877878001" },
  total: "28.00",
  state,
  transmissionStopped: false,
  documents,
  artifacts: [],
  rideGeneration: {
    status: documents.ride,
    reason: null,
    stoppedAt: null,
    retryable: false,
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
  debitNoteDetail(state, transmission) as unknown as TransmissionDocument;
const buttonsIn = (name: string) =>
  within(screen.getByRole("region", { name }))
    .queryAllByRole("button")
    .map((button) => button.textContent);

beforeEach(() => {
  navigation.pathname = "/notas-debito/nd-1";
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

describe("Documentos de la nota de débito", () => {
  it("autorizada: RIDE, imprimir, XML autorizado y XML firmado como documentos distintos", async () => {
    const calls = render(<DocumentsSection document={NOTE} />, {
      "GET /api/v1/documents/nd-1": ok(
        summary("AUTHORIZED", { ride: "AVAILABLE", authorizedXml: true, signedXml: true }),
      ),
      "GET /api/v1/documents/nd-1/signed-xml": () => ({ status: 200, body: "<notaDebito/>" }),
    });
    expect(await screen.findByText("El RIDE está listo para entregarse.")).toBeDefined();
    expect(buttonsIn("Documentos")).toEqual([
      "Descargar RIDE",
      "Imprimir",
      "XML autorizado",
      "XML firmado",
    ]);
    await userEvent.setup().click(screen.getByRole("button", { name: "XML firmado" }));
    expect(await screen.findByText("Descargaste el XML firmado.")).toBeDefined();
    expect(calls.map((call) => call.key)).toContain("GET /api/v1/documents/nd-1/signed-xml");
  });

  it("sin autorizar: sin RIDE ni XML autorizado, solo el firmado, con el texto de la nota de débito", async () => {
    render(<DocumentsSection document={{ ...NOTE, state: "RECEIVED" }} />, {
      "GET /api/v1/documents/nd-1": ok(
        summary("RECEIVED", { ride: "NOT_APPLICABLE", authorizedXml: false, signedXml: true }),
      ),
    });
    expect(
      await screen.findByText(
        "El RIDE estará disponible cuando el SRI autorice la nota de débito.",
      ),
    ).toBeDefined();
    expect(buttonsIn("Documentos")).toEqual(["XML firmado"]);
  });

  it("autorizada sin XML autorizado guardado: no lo ofrece", async () => {
    render(<DocumentsSection document={NOTE} />, {
      "GET /api/v1/documents/nd-1": ok(
        summary("AUTHORIZED", { ride: "AVAILABLE", authorizedXml: false, signedXml: true }),
      ),
    });
    await screen.findByText("El RIDE está listo para entregarse.");
    expect(buttonsIn("Documentos")).toEqual(["Descargar RIDE", "Imprimir", "XML firmado"]);
  });
});

describe("Transmisión de la nota de débito", () => {
  it("explica el estado con el texto de la nota y pide su historial a la ruta de la nota de débito", async () => {
    const calls = render(<TransmissionSection document={transmissionOf("RECEIVED")} />, {
      "GET /api/v1/debit-notes/nd-1/transmission": ok({
        debitNoteId: "nd-1",
        state: "RECEIVED",
        events: [
          {
            kind: "TRANSITION",
            at: "2026-10-09T15:00:02.000Z",
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
        "El SRI recibió la nota de débito y está decidiendo su autorización; puede tardar hasta 24 horas.",
      ),
    ).toBeDefined();
    await userEvent.setup().click(screen.getByText("Historial de la transmisión"));
    const history = await screen.findByRole("list", { name: "Historial de la transmisión" });
    expect(
      within(history).getByText("Pendiente de envío → Pendiente de autorización"),
    ).toBeDefined();
    expect(calls.map((call) => call.key)).toContain("GET /api/v1/debit-notes/nd-1/transmission");
  });

  it("el administrador reconcilia por la ruta de la nota de débito", async () => {
    let requested: unknown;
    const routes: Record<string, Route> = {
      "POST /api/v1/debit-notes/nd-1/reconciliations": (init) => {
        requested = JSON.parse(init.body as string);
        return {
          status: 202,
          body: { data: debitNoteDetail("MANUAL_REVIEW", { inProgress: true }) },
        };
      },
    };
    render(
      <TransmissionSection document={transmissionOf("MANUAL_REVIEW", { reconcilable: true })} />,
      routes,
      ADMIN_ME,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Reconciliar con el SRI" }));
    const dialog = await screen.findByRole("dialog", { name: "Reconciliar con el SRI" });
    expect(
      within(dialog).getByText(/por la clave de la nota de débito 001-001-000000003/),
    ).toBeDefined();
    await user.type(within(dialog).getByRole("textbox", { name: "Motivo" }), "Verificar la clave");
    await user.click(within(dialog).getByRole("button", { name: "Reconciliar" }));
    expect(
      await screen.findByText(
        "Pediste la reconciliación de la nota de débito 001-001-000000003. El estado se actualizará cuando el SRI responda.",
      ),
    ).toBeDefined();
    expect(requested).toEqual({ reason: "Verificar la clave" });
  });

  it("un estado que ya no se reconcilia se explica con el tipo", async () => {
    render(
      <TransmissionSection document={transmissionOf("MANUAL_REVIEW", { reconcilable: true })} />,
      {
        "POST /api/v1/debit-notes/nd-1/reconciliations": () => ({
          status: 409,
          body: errorBody("DEBIT_NOTE_NOT_RECONCILABLE", "x"),
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
        "El estado de la nota de débito cambió y ya no admite una reconciliación. Recarga para ver su estado.",
      ),
    ).toBeDefined();
  });

  it("el operador no ve la reconciliación", async () => {
    render(
      <TransmissionSection document={transmissionOf("MANUAL_REVIEW", { reconcilable: true })} />,
      {},
    );
    await screen.findByText(/un administrador debe reconciliar la nota de débito/);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Reconciliar con el SRI" })).toBeNull(),
    );
  });
});
