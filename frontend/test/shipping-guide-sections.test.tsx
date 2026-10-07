// Secciones compartidas con la guía de remisión (add-shipping-guides, tarea 11.1, design D21):
// Documentos y Transmisión reciben la guía como cualquier comprobante, con sus textos en femenino ("la
// guía", "autorizada"); el RIDE solo de una guía autorizada, el XML autorizado solo si existe y el
// firmado como un documento distinto; la transmisión y la reconciliación van a las rutas de la guía
// con su permiso. Los demás tipos, sin cambios, los cubren sus propias pruebas.
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
import { guideDetail } from "./shipping-guide-fixtures";
import {
  ADMIN_ME,
  OPERATOR_ME,
  errorBody,
  mockApi,
  navigation,
  renderApp,
  type Route,
} from "./harness";

const GUIDE = { id: "gr-1", documentType: "06", state: "AUTHORIZED" } as const;
const summary = (
  state: string,
  documents: { ride: string; authorizedXml: boolean; signedXml: boolean },
) => ({
  id: "gr-1",
  documentType: "06",
  number: "001-001-000000005",
  issueDate: "2026-10-06",
  buyer: null,
  total: null,
  recipients: { count: 2, name: null },
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
  guideDetail(state, transmission) as unknown as TransmissionDocument;
const buttonsIn = (name: string) =>
  within(screen.getByRole("region", { name }))
    .queryAllByRole("button")
    .map((button) => button.textContent);

beforeEach(() => {
  navigation.pathname = "/guias-remision/gr-1";
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

describe("Documentos de la guía", () => {
  it("autorizada: RIDE, imprimir, XML autorizado y XML firmado como documentos distintos", async () => {
    const calls = render(<DocumentsSection document={GUIDE} />, {
      "GET /api/v1/documents/gr-1": ok(
        summary("AUTHORIZED", { ride: "AVAILABLE", authorizedXml: true, signedXml: true }),
      ),
      "GET /api/v1/documents/gr-1/signed-xml": () => ({ status: 200, body: "<guiaRemision/>" }),
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
    expect(calls.map((call) => call.key)).toContain("GET /api/v1/documents/gr-1/signed-xml");
  });

  it("sin autorizar: sin RIDE ni XML autorizado, solo el firmado, con el texto de la guía", async () => {
    render(<DocumentsSection document={{ ...GUIDE, state: "RECEIVED" }} />, {
      "GET /api/v1/documents/gr-1": ok(
        summary("RECEIVED", { ride: "NOT_APPLICABLE", authorizedXml: false, signedXml: true }),
      ),
    });
    expect(
      await screen.findByText("El RIDE estará disponible cuando el SRI autorice la guía."),
    ).toBeDefined();
    expect(buttonsIn("Documentos")).toEqual(["XML firmado"]);
  });

  it("reservada no ofrece documentos", async () => {
    render(<DocumentsSection document={{ ...GUIDE, state: "RESERVED" }} />, {
      "GET /api/v1/documents/gr-1": ok(
        summary("RESERVED", { ride: "NOT_APPLICABLE", authorizedXml: false, signedXml: false }),
      ),
    });
    await waitFor(() => expect(buttonsIn("Documentos")).toEqual([]));
  });
});

describe("Transmisión de la guía", () => {
  it("explica el estado con el texto de la guía y pide su historial a su ruta", async () => {
    const calls = render(<TransmissionSection document={transmissionOf("RECEIVED")} />, {
      "GET /api/v1/shipping-guides/gr-1/transmission": ok({
        shippingGuideId: "gr-1",
        state: "RECEIVED",
        events: [
          {
            kind: "TRANSITION",
            at: "2026-10-06T15:00:02.000Z",
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
        "El SRI recibió la guía y está decidiendo su autorización; puede tardar hasta 24 horas.",
      ),
    ).toBeDefined();
    await userEvent.setup().click(screen.getByText("Historial de la transmisión"));
    const history = await screen.findByRole("list", { name: "Historial de la transmisión" });
    expect(
      within(history).getByText("Pendiente de envío → Pendiente de autorización"),
    ).toBeDefined();
    expect(calls.map((call) => call.key)).toContain(
      "GET /api/v1/shipping-guides/gr-1/transmission",
    );
  });

  it("el administrador reconcilia por la ruta de la guía con shippingGuides.reconcile", async () => {
    let requested: unknown;
    const routes: Record<string, Route> = {
      "POST /api/v1/shipping-guides/gr-1/reconciliations": (init) => {
        requested = JSON.parse(init.body as string);
        return {
          status: 202,
          body: { data: guideDetail("MANUAL_REVIEW", { inProgress: true }) },
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
    expect(within(dialog).getByText(/por la clave de la guía 001-001-000000005/)).toBeDefined();
    await user.type(within(dialog).getByRole("textbox", { name: "Motivo" }), "Verificar la clave");
    await user.click(within(dialog).getByRole("button", { name: "Reconciliar" }));
    expect(
      await screen.findByText(
        "Pediste la reconciliación de la guía 001-001-000000005. El estado se actualizará cuando el SRI responda.",
      ),
    ).toBeDefined();
    expect(requested).toEqual({ reason: "Verificar la clave" });
  });

  it("un estado que ya no se reconcilia se explica con el tipo", async () => {
    render(
      <TransmissionSection document={transmissionOf("MANUAL_REVIEW", { reconcilable: true })} />,
      {
        "POST /api/v1/shipping-guides/gr-1/reconciliations": () => ({
          status: 409,
          body: errorBody("SHIPPING_GUIDE_NOT_RECONCILABLE", "x"),
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
        "El estado de la guía cambió y ya no admite una reconciliación. Recarga para ver su estado.",
      ),
    ).toBeDefined();
  });

  it("el operador no ve la reconciliación", async () => {
    render(
      <TransmissionSection document={transmissionOf("MANUAL_REVIEW", { reconcilable: true })} />,
      {},
    );
    await screen.findByText(/un administrador debe reconciliar la guía/);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Reconciliar con el SRI" })).toBeNull(),
    );
  });
});
