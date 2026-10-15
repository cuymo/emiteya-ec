// Transmisión al SRI en Facturas y en el detalle (add-sri-transmission, tareas 13.1 y 13.2, design
// D20): estados con icono y texto del glosario, filtro "Requiere atención" en la URL, transmisión
// detenida, sección de la transmisión en cada estado, mensajes del SRI, autorización, historial y
// la reconciliación solo del administrador con su motivo obligatorio.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionGate } from "@/components/session";
import { InvoiceDetailScreen } from "@/features/invoices/invoice-detail";
import { InvoicesScreen } from "@/features/invoices/invoices-screen";
import {
  ADMIN_ME,
  OPERATOR_ME,
  errorBody,
  mockApi,
  navigation,
  renderApp,
  type Route,
} from "./harness";

const KEY = "0410202601179001234500110010010000000011234567813";
const summary = (overrides: Record<string, unknown> = {}) => ({
  id: "inv-1",
  documentNumber: "001-001-000000001",
  environment: "TEST",
  issueDate: "2026-10-04",
  buyerIdentification: "0992877878001",
  buyerName: "EL PERNO CIA. LTDA.",
  total: "28.75",
  state: "SIGNED",
  diagnosticCode: null,
  transmissionStopped: false,
  createdAt: "2026-10-04T15:00:00.000Z",
  ...overrides,
});
const TRANSMISSION = {
  inProgress: false,
  stopped: null,
  reconcilable: false,
  authorization: null,
  lastResult: null,
};
const detail = (state: string, transmission: Record<string, unknown> = {}) => ({
  id: "inv-1",
  documentType: "01",
  environment: "TEST",
  documentNumber: "001-001-000000001",
  accessKey: KEY,
  issueDate: "2026-10-04",
  state,
  issuer: {
    ruc: "1790012345001",
    legalName: "EMPRESA DE PRUEBA S.A.",
    tradeName: null,
    headOfficeAddress: "Quito",
    establishmentAddress: "Quito",
    accountingRequired: true,
    specialTaxpayerNumber: null,
    withholdingAgentResolution: null,
    rimpeCategory: null,
  },
  buyer: {
    identificationType: "04",
    identification: "0992877878001",
    legalName: "EL PERNO CIA. LTDA.",
    address: null,
    consumerFinal: false,
  },
  lines: [],
  payments: [{ code: "01", amount: "28.75" }],
  totals: { withoutTaxes: "25.00", discount: "0.00", taxes: [], total: "28.75" },
  diagnostic: null,
  artifact: { sha256: "a".repeat(64), sizeBytes: 4096 },
  authorizedArtifact: null,
  transmission: { ...TRANSMISSION, ...transmission },
  createdAt: "2026-10-04T15:00:00.000Z",
  signedAt: "2026-10-04T15:00:01.000Z",
});
const paged =
  (data: unknown[]): Route =>
  () => ({ status: 200, body: { data, meta: { page: 1, pageSize: 25, total: data.length } } });
const ok =
  (data: unknown): Route =>
  () => ({ status: 200, body: { data } });

function render(
  ui: React.ReactNode,
  routes: Record<string, Route>,
  me: typeof ADMIN_ME | typeof OPERATOR_ME = ADMIN_ME,
) {
  const calls = mockApi({
    "GET /api/v1/me": () => ({ status: 200, body: { data: me } }),
    "GET /api/v1/fiscal-catalogs/payment-method/entries": () => ({
      status: 500,
      body: errorBody("INTERNAL_ERROR", "Error"),
    }),
    ...routes,
  });
  renderApp(<SessionGate fallback={<p>cargando</p>}>{ui}</SessionGate>);
  return calls;
}

beforeEach(() => {
  navigation.pathname = "/facturas";
  navigation.search = new URLSearchParams();
  navigation.replace.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Facturas con los estados de la transmisión (tarea 13.1)", () => {
  it("cada estado lleva su icono y el texto del glosario, y la transmisión detenida se ve", async () => {
    const states = [
      ["SEND_UNKNOWN", "Verificando con el SRI"],
      ["RECEIVED", "Pendiente de autorización"],
      ["RETURNED", "Devuelto"],
      ["AUTHORIZED", "Autorizado"],
      ["NOT_AUTHORIZED", "No autorizado"],
      ["MANUAL_REVIEW", "Requiere revisión"],
    ] as const;
    render(<InvoicesScreen />, {
      "GET /api/v1/invoices": paged([
        ...states.map(([state], index) =>
          summary({ id: `inv-${index}`, documentNumber: `001-001-00000000${index}`, state }),
        ),
        summary({ id: "inv-9", documentNumber: "001-001-000000009", transmissionStopped: true }),
      ]),
    });
    const table = await screen.findByRole("table", { name: "Facturas emitidas" });
    await within(table).findByText("001-001-000000009");
    for (const [index, [, label]] of states.entries()) {
      const row = within(table)
        .getAllByRole("row")
        .find(
          (candidate) => within(candidate).queryAllByText(`001-001-00000000${index}`).length > 0,
        )!;
      // Dos copias por fila (distribución amplia y compacta): jsdom no aplica las container queries.
      const [badge] = within(row).getAllByText(label);
      expect(badge).toBeDefined();
      expect(badge!.parentElement?.querySelector("svg")).not.toBeNull();
    }
    const stopped = within(table)
      .getAllByRole("row")
      .find((candidate) => within(candidate).queryAllByText("001-001-000000009").length > 0)!;
    expect(within(stopped).getAllByText("Pendiente de envío").length).toBeGreaterThan(0);
    expect(within(stopped).getAllByText("Transmisión detenida").length).toBeGreaterThan(0);
  });

  it("muestra la carga mientras llegan las facturas", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    render(<InvoicesScreen />, { "GET /api/v1/invoices": paged([summary()]) });
    const fetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        if (input.startsWith("/api/v1/invoices")) await gate;
        return fetch(input, init);
      }),
    );
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).not.toBeNull());
    release();
    expect(await screen.findByRole("table", { name: "Facturas emitidas" })).toBeDefined();
  });

  it('"Requiere atención" y los estados del SRI se filtran desde la URL', async () => {
    // Los siete chips «Estado» pasan a la vista «Requiere atención» y al filtro «Estado» (D6);
    // `estado=atencion` sigue abriendo la vista y se reescribe como `vista=atencion`.
    navigation.search = new URLSearchParams("estado=atencion");
    const calls = render(<InvoicesScreen />, { "GET /api/v1/invoices": paged([]) });
    await screen.findAllByText("No hay facturas con estos filtros");
    const listCall = calls.find((call) => call.key.startsWith("GET /api/v1/invoices?page="))!;
    expect(listCall.key).toContain("attention=true");
    expect(listCall.key).not.toContain("state=");
    const views = screen.getByRole("radiogroup", { name: "Vista" });
    expect(
      within(views)
        .getByRole("radio", { name: /Requiere atención/ })
        .getAttribute("aria-checked"),
    ).toBe("true");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Estado" }));
    await user.click(screen.getByRole("menuitemradio", { name: "Autorizado" }));
    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith(
        expect.stringContaining("estado=autorizadas"),
        expect.anything(),
      ),
    );
  });

  it("los estados devuelto y no autorizado también se filtran", async () => {
    for (const [param, state] of [
      ["devueltas", "RETURNED"],
      ["no-autorizadas", "NOT_AUTHORIZED"],
    ] as const) {
      navigation.search = new URLSearchParams(`estado=${param}`);
      const calls = render(<InvoicesScreen />, { "GET /api/v1/invoices": paged([]) });
      await screen.findAllByText("No hay facturas con estos filtros");
      expect(calls.some((call) => call.key.includes(`state=${state}`))).toBe(true);
      vi.unstubAllGlobals();
      document.body.innerHTML = "";
    }
  });
});

describe("sección de la transmisión en el detalle (tarea 13.2)", () => {
  it("la autorizada muestra el número, la fecha y el ambiente, sin acción", async () => {
    render(<InvoiceDetailScreen invoiceId="inv-1" />, {
      "GET /api/v1/invoices/inv-1": ok(
        detail("AUTHORIZED", {
          authorization: {
            number: KEY,
            authorizedAt: "2026-10-04T15:15:30.000Z",
            environment: "TEST",
          },
          lastResult: {
            operation: "AUTHORIZATION",
            outcome: "AUTHORIZED",
            at: "2026-10-04T15:15:31.000Z",
            messages: [
              {
                identifier: "60",
                message: "AMBIENTE DE PRUEBAS",
                additionalInformation: null,
                type: "ADVERTENCIA",
              },
            ],
          },
        }),
      ),
    });
    const section = await screen.findByRole("region", { name: "Transmisión al SRI" });
    expect(within(section).getByText(/está lista para entregarse/)).toBeDefined();
    expect(within(section).getByText("Número de autorización")).toBeDefined();
    expect(within(section).getAllByText(KEY).length).toBeGreaterThan(0);
    expect(within(section).getByText(/^04\/10\/2026, 10:15/)).toBeDefined();
    expect(within(section).getByText("Pruebas")).toBeDefined();
    expect(within(section).getByText(/AMBIENTE DE PRUEBAS/)).toBeDefined();
    expect(within(section).queryByRole("button", { name: "Reconciliar con el SRI" })).toBeNull();
  });

  it("devuelta, no autorizada, incierta, recibida y en revisión explican su estado y sus mensajes", async () => {
    const cases = [
      ["RETURNED", /devolvió la factura/],
      ["NOT_AUTHORIZED", /no autorizó la factura/],
      ["SEND_UNKNOWN", /misma clave antes de cualquier reenvío/],
      ["RECEIVED", /hasta 24 horas/],
      ["MANUAL_REVIEW", /no se pudo resolver automáticamente/],
    ] as const;
    for (const [state, text] of cases) {
      render(<InvoiceDetailScreen invoiceId="inv-1" />, {
        "GET /api/v1/invoices/inv-1": ok(
          detail(state, {
            lastResult: {
              operation: "RECEPTION",
              outcome: "RETURNED",
              at: "2026-10-04T15:00:02.000Z",
              messages: [
                {
                  identifier: "35",
                  message: "DOCUMENTO INVÁLIDO",
                  additionalInformation: "Detalle del error",
                  type: "ERROR",
                },
                { identifier: "999", message: "OTRO", additionalInformation: null, type: null },
              ],
            },
          }),
        ),
      });
      const section = await screen.findByRole("region", { name: "Transmisión al SRI" });
      expect(within(section).getByText(text)).toBeDefined();
      const list = within(section).getByRole("list", { name: "Mensajes del SRI" });
      const [first, second] = within(list).getAllByRole("listitem");
      expect(within(list).getAllByRole("listitem")).toHaveLength(2);
      // Código, texto, tipo e información adicional, en el orden del SRI.
      expect(first!.textContent).toContain("Código 35 · DOCUMENTO INVÁLIDO · ERROR");
      expect(within(first!).getByText("Detalle del error")).toBeDefined();
      expect(second!.textContent).toBe("Código 999 · OTRO");
      vi.unstubAllGlobals();
      document.body.innerHTML = "";
    }
  });

  it("la transmisión detenida muestra su motivo y el operador no tiene la acción", async () => {
    render(
      <InvoiceDetailScreen invoiceId="inv-1" />,
      {
        "GET /api/v1/invoices/inv-1": ok(
          detail("SIGNED", {
            stopped: {
              code: "SRI_UNAVAILABLE",
              message: "El SRI no respondió durante los reintentos.",
              at: "2026-10-04T16:00:00.000Z",
            },
            reconcilable: true,
          }),
        ),
      },
      OPERATOR_ME,
    );
    const section = await screen.findByRole("region", { name: "Transmisión al SRI" });
    const notice = within(section).getByRole("status");
    expect(notice.textContent).toContain("La transmisión está detenida.");
    expect(notice.textContent).toContain("El SRI no respondió durante los reintentos.");
    expect(notice.textContent).toContain("Un administrador puede reconciliarla");
    expect(screen.queryByRole("button", { name: "Reconciliar con el SRI" })).toBeNull();
  });

  it("el historial plegable se pide al abrirlo y no muestra datos técnicos", async () => {
    const calls = render(<InvoiceDetailScreen invoiceId="inv-1" />, {
      "GET /api/v1/invoices/inv-1": ok(detail("RECEIVED")),
      "GET /api/v1/invoices/inv-1/transmission": ok({
        invoiceId: "inv-1",
        state: "RECEIVED",
        total: 3,
        events: [
          {
            kind: "TRANSITION",
            at: "2026-10-04T15:00:03.000Z",
            fromState: "SIGNED",
            toState: "RECEIVED",
            cause: "TRANSMISSION",
            actor: "SYSTEM",
            actorName: null,
          },
          {
            kind: "ATTEMPT",
            at: "2026-10-04T15:00:02.000Z",
            operation: "RECEPTION",
            origin: "AUTOMATIC",
            outcome: "RECEIVED",
            messages: [],
          },
          {
            kind: "TRANSITION",
            at: "2026-10-04T15:00:01.000Z",
            fromState: "RESERVED",
            toState: "SIGNED",
            cause: "SIGNING",
            actor: "USER",
            actorName: "Operadora",
          },
        ],
      }),
    });
    const summaryElement = await screen.findByText("Historial de la transmisión");
    expect(calls.some((call) => call.key.endsWith("/transmission"))).toBe(false);
    await userEvent.setup().click(summaryElement);
    const history = await screen.findByRole("list", { name: "Historial de la transmisión" });
    expect(
      within(history).getByText("Pendiente de envío → Pendiente de autorización"),
    ).toBeDefined();
    expect(within(history).getByText("Envío al SRI: Recibida")).toBeDefined();
    expect(within(history).getByText(/Firma · Operadora/)).toBeDefined();
  });

  it("el administrador reconcilia con un motivo obligatorio que recibe el foco", async () => {
    let requested: unknown;
    const calls = render(<InvoiceDetailScreen invoiceId="inv-1" />, {
      "GET /api/v1/invoices/inv-1": ok(detail("MANUAL_REVIEW", { reconcilable: true })),
      "POST /api/v1/invoices/inv-1/reconciliations": (init) => {
        requested = JSON.parse(init.body as string);
        return { status: 202, body: { data: detail("MANUAL_REVIEW", { inProgress: true }) } };
      },
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Reconciliar con el SRI" }));
    const dialog = await screen.findByRole("dialog", { name: "Reconciliar con el SRI" });
    const reason = within(dialog).getByRole("textbox", { name: "Motivo" });
    await waitFor(() => expect(document.activeElement).toBe(reason));
    await user.click(within(dialog).getByRole("button", { name: "Reconciliar" }));
    expect(within(dialog).getByText("Indica el motivo de la reconciliación.")).toBeDefined();
    expect(reason.getAttribute("aria-invalid")).toBe("true");
    expect(calls.some((call) => call.key.endsWith("/reconciliations"))).toBe(false);
    await user.type(reason, "  El SRI confirmó la clave por teléfono  ");
    await user.click(within(dialog).getByRole("button", { name: "Reconciliar" }));
    expect(
      await screen.findByText(
        "Pediste la reconciliación de la factura 001-001-000000001. El estado se actualizará cuando el SRI responda.",
      ),
    ).toBeDefined();
    expect(requested).toEqual({ reason: "El SRI confirmó la clave por teléfono" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("un 409 explica que ya hay una interacción en curso", async () => {
    render(<InvoiceDetailScreen invoiceId="inv-1" />, {
      "GET /api/v1/invoices/inv-1": ok(detail("SEND_UNKNOWN", { reconcilable: true })),
      "POST /api/v1/invoices/inv-1/reconciliations": () => ({
        status: 409,
        body: errorBody("SRI_INTERACTION_IN_PROGRESS", "En curso."),
      }),
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Reconciliar con el SRI" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("textbox", { name: "Motivo" }), "Verificar");
    await user.click(within(dialog).getByRole("button", { name: "Reconciliar" }));
    expect(
      await screen.findByText(
        "La factura ya tiene una interacción con el SRI en curso. Espera a que termine y vuelve a intentarlo.",
      ),
    ).toBeDefined();
  });

  it("sin un estado admitido no se ofrece la acción, ni siquiera al administrador", async () => {
    render(<InvoiceDetailScreen invoiceId="inv-1" />, {
      "GET /api/v1/invoices/inv-1": ok(detail("RETURNED", { reconcilable: false })),
    });
    await screen.findByRole("region", { name: "Transmisión al SRI" });
    expect(screen.queryByRole("button", { name: "Reconciliar con el SRI" })).toBeNull();
  });
});

describe("revisión de la interfaz (tarea 13.3)", () => {
  it("con la reconciliación pedida, la revisión manual explica que está en curso", async () => {
    render(<InvoiceDetailScreen invoiceId="inv-1" />, {
      "GET /api/v1/invoices/inv-1": ok(detail("MANUAL_REVIEW", { inProgress: true })),
    });
    const section = await screen.findByRole("region", { name: "Transmisión al SRI" });
    expect(within(section).getByText(/La reconciliación está en curso/)).toBeDefined();
    expect(within(section).queryByText(/un administrador debe reconciliar/)).toBeNull();
    expect(within(section).queryByText(/interacción con el SRI en curso/)).toBeNull();
  });

  it("el aviso de transmisión detenida no repite la puntuación de la hora", async () => {
    render(<InvoiceDetailScreen invoiceId="inv-1" />, {
      "GET /api/v1/invoices/inv-1": ok(
        detail("RECEIVED", {
          stopped: {
            code: "SRI_UNAVAILABLE",
            message: "El SRI no respondió.",
            at: "2026-10-04T05:22:00.000Z",
          },
          reconcilable: true,
        }),
      ),
    });
    const notice = await screen.findByRole("status");
    expect(notice.textContent).not.toMatch(/\.\./);
    expect(notice.textContent).toContain("Reconcilia con el SRI para continuar.");
  });
});
