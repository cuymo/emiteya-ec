// Borrador de nota de débito (add-debit-notes, tarea 11.2, design D23): los tratamientos ofrecidos
// son los de la factura y nunca una tarifa ajena; la forma de pago sale del catálogo utilizable; los
// problemas aparecen junto a su concepto y bloquean la emisión; la emisión es imposible sin la
// declaración; el éxito lleva al detalle; el doble clic envía una sola emisión y el reintento repite la
// misma clave; los 409 se explican; el foco tras cada acción; y la factura elegida crea el borrador.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionGate } from "@/components/session";
import {
  DebitNoteDraftScreen,
  NewDebitNoteDraftScreen,
} from "@/features/debit-notes/debit-note-draft-editor";
import {
  PAYMENT_METHOD_ENTRIES,
  authorizedInvoice,
  debitNoteDetail,
  debitNoteDraft,
} from "./debit-note-fixtures";
import {
  ADMIN_ME,
  OPERATOR_ME,
  errorBody,
  mockApi,
  navigation,
  renderApp,
  type Route,
} from "./harness";

const ok =
  (data: unknown): Route =>
  () => ({ status: 200, body: { data } });
const DECLARATION =
  "Declaro que esta factura no es una factura comercial negociable que haya sido efectivamente negociada.";

function render(
  ui: React.ReactNode,
  routes: Record<string, Route>,
  me: typeof ADMIN_ME | typeof OPERATOR_ME = OPERATOR_ME,
) {
  const calls = mockApi({
    "GET /api/v1/me": () => ({ status: 200, body: { data: me } }),
    "GET /api/v1/company/status": ok({
      environment: "TEST",
      displayName: "COMERCIAL ANDINA S.A.",
      readiness: { ready: true, checks: [] },
    }),
    "GET /api/v1/establishments": ok([
      {
        id: "est-1",
        code: "001",
        address: "Av. Amazonas, Quito",
        status: "ACTIVE",
        emissionPoints: [{ id: "ep-1", code: "001", status: "ACTIVE", available: true }],
      },
    ]),
    "GET /api/v1/me/default-emission-point": ok({
      establishment: { id: "est-1", code: "001", address: "Av. Amazonas, Quito", status: "ACTIVE" },
      emissionPoint: { id: "ep-1", code: "001", status: "ACTIVE" },
      available: true,
    }),
    "GET /api/v1/fiscal-catalogs/payment-method/entries": ok(PAYMENT_METHOD_ENTRIES),
    ...routes,
  });
  renderApp(<SessionGate fallback={<p>cargando</p>}>{ui}</SessionGate>);
  return calls;
}
const concept = (position: number) =>
  screen.getByRole("listitem", { name: `Concepto ${position}` });
const findConcept = (position: number) =>
  screen.findByRole("listitem", { name: `Concepto ${position}` });
const openEmission = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole("button", { name: "Emitir nota de débito" }));
  return screen.findByRole("dialog", { name: "Emitir nota de débito" });
};
const declare = (user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) =>
  user.click(within(dialog).getByRole("checkbox", { name: DECLARATION }));

beforeEach(() => {
  navigation.pathname = "/notas-debito/borradores/ndd-1";
  navigation.search = new URLSearchParams();
  navigation.replace.mockReset();
  navigation.push.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("borrador de nota de débito", () => {
  it("ofrece solo los tratamientos de la factura y las formas de pago utilizables", async () => {
    render(<DebitNoteDraftScreen draftId="ndd-1" />, {
      "GET /api/v1/debit-notes/drafts/ndd-1": ok(debitNoteDraft()),
    });
    const first = await findConcept(1);
    expect(
      within(first)
        .getAllByRole("radio")
        .map((radio) => radio.textContent),
    ).toEqual([
      "Intereses de mora",
      "Costos o gastos posteriores a la factura",
      "IVA 0 %",
      "IVA 15 %",
    ]);
    expect(
      within(first).getByRole("radio", { name: "IVA 15 %" }).getAttribute("aria-checked"),
    ).toBe("true");
    // Ninguna tarifa vigente que la factura no tenía.
    expect(screen.queryByRole("radio", { name: /IVA 5 %|IVA 12 %|IVA 13 %/ })).toBeNull();
    const method = screen.getByRole("combobox", { name: "Forma de pago" });
    await waitFor(() =>
      expect(
        within(method)
          .getAllByRole("option")
          .map((option) => option.textContent),
      ).toEqual([
        "Elige la forma de pago",
        "SIN UTILIZACIÓN DEL SISTEMA FINANCIERO (01)",
        "OTROS CON UTILIZACIÓN DEL SISTEMA FINANCIERO (20)",
      ]),
    );
    expect(method).toHaveProperty("value", "20");
    const summary = screen.getByRole("complementary", { name: "Resumen" });
    expect(within(summary).getByText("Base IVA 15 %")).toBeDefined();
    expect(within(summary).getByText("USD 3,00")).toBeDefined();
    // El valor total y el total de la única forma de pago son el mismo valor exacto.
    expect(within(summary).getAllByText("USD 28,00")).toHaveLength(2);
    expect(
      within(summary).getByText(/Forma de pago: OTROS CON UTILIZACIÓN DEL SISTEMA FINANCIERO/),
    ).toBeDefined();
  });

  it("desde seis tratamientos los ofrece en una lista, igual a la de la factura", async () => {
    // Las denominaciones oficiales del catálogo: un porcentaje se nombra "IVA n %"; las demás, igual.
    const treatments = [
      ["0", "0", "0%"],
      ["5", "5", "5%"],
      ["2", "12", "12%"],
      ["4", "15", "15%"],
      ["7", "0", "Exento de IVA"],
      ["6", "0", "No Objeto de Impuesto"],
    ].map(([rateCode, percentage, label]) => ({
      key: `2:${rateCode}`,
      taxCode: "2",
      rateCode: rateCode!,
      percentage: percentage!,
      label: label!,
    }));
    render(<DebitNoteDraftScreen draftId="ndd-1" />, {
      "GET /api/v1/debit-notes/drafts/ndd-1": ok(
        debitNoteDraft({
          concepts: [],
          preview: { ...debitNoteDraft().preview, taxTreatments: treatments, totals: null },
        }),
      ),
    });
    const first = await findConcept(1);
    const select = within(first).getByRole("combobox", { name: "Tratamiento de IVA" });
    expect(
      within(select)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual([
      "Elige un tratamiento",
      "IVA 0 %",
      "IVA 5 %",
      "IVA 12 %",
      "IVA 15 %",
      "Exento de IVA",
      "No Objeto de Impuesto",
    ]);
  });

  it("los problemas aparecen junto a su concepto y bloquean la emisión", async () => {
    render(<DebitNoteDraftScreen draftId="ndd-1" />, {
      "GET /api/v1/debit-notes/drafts/ndd-1": ok(
        debitNoteDraft({
          preview: {
            ...debitNoteDraft().preview,
            totals: null,
            payment: null,
            issues: [
              {
                code: "DEBIT_NOTE_TAX_TREATMENT_NOT_IN_INVOICE",
                message:
                  "El tratamiento de IVA no está en la factura: elige uno de los tratamientos de la factura.",
                concept: 2,
              },
              {
                code: "DEBIT_NOTE_PAYMENT_METHOD_NOT_USABLE",
                message:
                  "La forma de pago 20 no está vigente o no está habilitada para tu empresa en la fecha de emisión.",
                concept: null,
              },
            ],
          },
        }),
      ),
    });
    const second = await findConcept(2);
    expect(second.getAttribute("aria-invalid")).toBe("true");
    expect(within(second).getByText(/El tratamiento de IVA no está en la factura/)).toBeDefined();
    expect(concept(1).getAttribute("aria-invalid")).toBeNull();
    const summary = screen.getByRole("complementary", { name: "Resumen" });
    expect(within(summary).getByText(/La forma de pago 20 no está vigente/)).toBeDefined();
    expect(screen.getByRole("button", { name: "Emitir nota de débito" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByText("Resuelve los problemas antes de emitir.")).toBeDefined();
  });

  it("guarda los conceptos en orden, valida el importe y lleva el foco al resumen", async () => {
    let saved: unknown;
    render(<DebitNoteDraftScreen draftId="ndd-1" />, {
      "GET /api/v1/debit-notes/drafts/ndd-1": ok(debitNoteDraft()),
      "PUT /api/v1/debit-notes/drafts/ndd-1": (init) => {
        saved = JSON.parse(init.body as string);
        return { status: 200, body: { data: debitNoteDraft({ version: 2 }) } };
      },
    });
    const user = userEvent.setup();
    await findConcept(2);
    await user.click(screen.getByRole("button", { name: "Agregar concepto" }));
    const third = concept(3);
    // El foco va a la descripción del concepto nuevo.
    expect(document.activeElement).toBe(
      within(third).getByRole("textbox", { name: "Descripción" }),
    );
    await user.click(within(third).getByRole("radio", { name: "Intereses de mora" }));
    await user.type(within(third).getByRole("textbox", { name: "Descripción" }), " Mora extra ");
    await user.type(within(third).getByRole("textbox", { name: "Importe" }), "1.234");
    await user.click(within(third).getByRole("radio", { name: "IVA 15 %" }));
    await user.click(screen.getByRole("button", { name: "Guardar borrador" }));
    expect(await within(third).findByText(/hasta dos decimales|decimales/)).toBeDefined();
    expect(saved).toBeUndefined();
    await user.clear(within(third).getByRole("textbox", { name: "Importe" }));
    await user.type(within(third).getByRole("textbox", { name: "Importe" }), "1.23");
    // Quitar el segundo concepto deja el foco en "Agregar concepto".
    await user.click(screen.getByRole("button", { name: "Quitar el concepto 2" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Agregar concepto" }));
    await user.click(screen.getByRole("button", { name: "Guardar borrador" }));
    await waitFor(() =>
      expect(saved).toEqual({
        emissionPointId: "ep-1",
        paymentMethod: "20",
        concepts: [
          {
            cause: "LATE_PAYMENT_INTEREST",
            description: "Intereses por 30 días de mora",
            amount: "20.00",
            taxTreatment: "2:4",
          },
          {
            cause: "LATE_PAYMENT_INTEREST",
            description: "Mora extra",
            amount: "1.23",
            taxTreatment: "2:4",
          },
        ],
        expectedVersion: 1,
      }),
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Resumen" })),
    );
  });

  it("sin la declaración no se puede emitir; con ella viaja con su versión y abre la nota", async () => {
    let body: unknown;
    render(<DebitNoteDraftScreen draftId="ndd-1" />, {
      "GET /api/v1/debit-notes/drafts/ndd-1": ok(debitNoteDraft()),
      "POST /api/v1/debit-notes": (init) => {
        body = JSON.parse(init.body as string);
        return { status: 201, body: { data: debitNoteDetail("SIGNED") } };
      },
    });
    const user = userEvent.setup();
    const dialog = await openEmission(user);
    expect(
      within(dialog).getByText(/Es una declaración tuya: el sistema no puede comprobarla/),
    ).toBeDefined();
    expect(within(dialog).getByText(/Reglamento de Comprobantes de Venta/)).toBeDefined();
    expect(within(dialog).getByText(/título valor/)).toBeDefined();
    expect(within(dialog).getByText("USD 28,00")).toBeDefined();
    expect(within(dialog).getByText("OTROS CON UTILIZACIÓN DEL SISTEMA FINANCIERO")).toBeDefined();
    const confirm = within(dialog).getByRole("button", { name: "Emitir nota de débito" });
    expect(confirm).toHaveProperty("disabled", true);
    expect(within(dialog).getByText("Marca la declaración para emitir.")).toBeDefined();
    await declare(user, dialog);
    expect(confirm).toHaveProperty("disabled", false);
    await user.click(confirm);
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/notas-debito/nd-1"));
    expect(body).toEqual({
      draftId: "ndd-1",
      expectedVersion: 1,
      declarations: { version: 1, statements: ["NOT_EFFECTIVELY_NEGOTIATED_COMMERCIAL_INVOICE"] },
    });
    expect(await screen.findByText("Emitiste la nota de débito 001-001-000000003.")).toBeDefined();
  });

  it("el doble clic envía una sola emisión y el reintento repite la misma clave", async () => {
    const keys: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    render(<DebitNoteDraftScreen draftId="ndd-1" />, {
      "GET /api/v1/debit-notes/drafts/ndd-1": ok(debitNoteDraft()),
      "POST /api/v1/debit-notes": (init) => {
        keys.push(new Headers(init.headers).get("Idempotency-Key") ?? "");
        return keys.length === 1
          ? { status: 503, body: errorBody("CRYPTO_UNAVAILABLE", "No disponible.") }
          : { status: 201, body: { data: debitNoteDetail("SIGNED") } };
      },
    });
    const fetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        if (input === "/api/v1/debit-notes" && init?.method === "POST") await gate;
        return fetch(input, init);
      }),
    );
    const user = userEvent.setup();
    let dialog = await openEmission(user);
    await declare(user, dialog);
    await user.dblClick(within(dialog).getByRole("button", { name: "Emitir nota de débito" }));
    release();
    // El primer intento falla: el aviso queda en el editor con el foco.
    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(document.activeElement).toBe(alert));
    expect(keys).toHaveLength(1);
    dialog = await openEmission(user);
    // La declaración se vuelve a marcar en cada confirmación.
    expect(within(dialog).getByRole("checkbox", { name: DECLARATION })).toHaveProperty(
      "checked",
      false,
    );
    await declare(user, dialog);
    await user.click(within(dialog).getByRole("button", { name: "Emitir nota de débito" }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/notas-debito/nd-1"));
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^[!-~]{1,100}$/);
    expect(keys[1]).toBe(keys[0]);
  });

  it("una forma de pago que dejó de ser utilizable se explica con el foco y vuelve a pedir la vista previa", async () => {
    let draftReads = 0;
    render(<DebitNoteDraftScreen draftId="ndd-1" />, {
      "GET /api/v1/debit-notes/drafts/ndd-1": () => {
        draftReads += 1;
        return { status: 200, body: { data: debitNoteDraft() } };
      },
      "POST /api/v1/debit-notes": () => ({
        status: 409,
        body: errorBody("DEBIT_NOTE_PAYMENT_METHOD_NOT_USABLE", "No utilizable."),
      }),
    });
    const user = userEvent.setup();
    const dialog = await openEmission(user);
    await declare(user, dialog);
    await user.click(within(dialog).getByRole("button", { name: "Emitir nota de débito" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "La forma de pago ya no está vigente o habilitada. Elige otra con la vista previa actualizada.",
    );
    await waitFor(() => expect(document.activeElement).toBe(alert));
    await waitFor(() => expect(draftReads).toBeGreaterThanOrEqual(2));
  });

  it("un borrador cambiado por otra persona se explica y se recarga", async () => {
    let version = 1;
    render(<DebitNoteDraftScreen draftId="ndd-1" />, {
      "GET /api/v1/debit-notes/drafts/ndd-1": () => ({
        status: 200,
        body: { data: debitNoteDraft({ version }) },
      }),
      "POST /api/v1/debit-notes": () => {
        version = 2;
        return { status: 409, body: errorBody("DEBIT_NOTE_DRAFT_CHANGED", "El borrador cambió.") };
      },
    });
    const user = userEvent.setup();
    const dialog = await openEmission(user);
    await declare(user, dialog);
    await user.click(within(dialog).getByRole("button", { name: "Emitir nota de débito" }));
    expect(
      await screen.findByText(
        "Alguien cambió este borrador mientras lo revisabas. Recárgalo para ver la versión vigente.",
      ),
    ).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Recargar borrador" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("un borrador ya emitido lo explica con el enlace a las notas", async () => {
    render(<DebitNoteDraftScreen draftId="ndd-1" />, {
      "GET /api/v1/debit-notes/drafts/ndd-1": () => ({
        status: 409,
        body: errorBody("DEBIT_NOTE_DRAFT_ALREADY_EMITTED", "x"),
      }),
    });
    expect(await screen.findByText("Este borrador ya se emitió")).toBeDefined();
    expect(screen.getByRole("link", { name: "Ver notas de débito" }).getAttribute("href")).toBe(
      "/notas-debito",
    );
  });
});

describe("nueva nota de débito", () => {
  it("la factura que llega desde su detalle se confirma y crea el borrador", async () => {
    let created: unknown;
    navigation.pathname = "/notas-debito/borradores/nueva";
    render(<NewDebitNoteDraftScreen invoiceId="inv-1" />, {
      "GET /api/v1/invoices/inv-1": ok(authorizedInvoice()),
      "POST /api/v1/debit-notes/drafts": (init) => {
        created = JSON.parse(init.body as string);
        return { status: 201, body: { data: debitNoteDraft({ id: "ndd-9" }) } };
      },
    });
    expect(await screen.findByText("Factura 001-001-000000001")).toBeDefined();
    await userEvent.setup().click(screen.getByRole("button", { name: "Preparar nota de débito" }));
    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith("/notas-debito/borradores/ndd-9"),
    );
    expect(created).toEqual({ invoiceId: "inv-1" });
  });

  it("«Nueva nota de débito» abre el selector de entrada; cerrarlo sin elegir vuelve a la lista", async () => {
    navigation.pathname = "/notas-debito/borradores/nueva";
    render(<NewDebitNoteDraftScreen />, {
      "GET /api/v1/debit-notes/eligible-invoices": () => ({
        status: 200,
        body: { data: [], meta: { page: 1, pageSize: 10, total: 0 } },
      }),
    });
    await screen.findByRole("dialog", { name: "Elegir factura" });
    await userEvent.setup().keyboard("{Escape}");
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/notas-debito"));
  });

  it("sin factura elegida, elegirla en el selector crea el borrador", async () => {
    let created: unknown;
    navigation.pathname = "/notas-debito/borradores/nueva";
    render(<NewDebitNoteDraftScreen />, {
      "GET /api/v1/debit-notes/eligible-invoices": () => ({
        status: 200,
        body: {
          data: [
            {
              id: "inv-1",
              documentNumber: "001-001-000000001",
              issueDate: "2026-10-01",
              buyerIdentification: "0992877878001",
              buyerName: "EL PERNO CIA. LTDA.",
              total: "66.00",
            },
          ],
          meta: { page: 1, pageSize: 10, total: 1 },
        },
      }),
      "POST /api/v1/debit-notes/drafts": (init) => {
        created = JSON.parse(init.body as string);
        return { status: 201, body: { data: debitNoteDraft({ id: "ndd-9" }) } };
      },
    });
    const user = userEvent.setup();
    // El selector se abre de entrada, sin la página intermedia.
    const dialog = await screen.findByRole("dialog", { name: "Elegir factura" });
    await user.click(await within(dialog).findByText("001-001-000000001"));
    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith("/notas-debito/borradores/ndd-9"),
    );
    // Elegir cierra el selector, pero no es cancelarlo: no vuelve a la lista.
    expect(navigation.replace).not.toHaveBeenCalledWith("/notas-debito");
    expect(created).toEqual({ invoiceId: "inv-1" });
  });

  it("una factura que ya no es elegible se explica con el foco en el aviso", async () => {
    render(<NewDebitNoteDraftScreen invoiceId="inv-1" />, {
      "GET /api/v1/invoices/inv-1": ok(authorizedInvoice()),
      "POST /api/v1/debit-notes/drafts": () => ({
        status: 409,
        body: errorBody("DEBIT_NOTE_INVOICE_NOT_ELIGIBLE", "x"),
      }),
    });
    await screen.findByText("Factura 001-001-000000001");
    await userEvent.setup().click(screen.getByRole("button", { name: "Preparar nota de débito" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("La factura ya no admite una nota de débito");
    await waitFor(() => expect(document.activeElement).toBe(alert));
  });
});

describe("aviso de Pruebas al emitir (productize-invoice-editor-and-composition-foundation, D21)", () => {
  const companyStatus = (environment: "TEST" | "PRODUCTION" | "UNKNOWN"): Route =>
    environment === "UNKNOWN"
      ? () => ({ status: 503, body: errorBody("UNAVAILABLE", "x") })
      : ok({
          environment,
          displayName: "COMERCIAL ANDINA S.A.",
          readiness: { ready: true, checks: [] },
        });
  const notices = () => document.querySelectorAll("[data-slot=emission-environment-notice]");

  for (const [environment, expected] of [
    ["TEST", "Pruebas · esta nota de débito no tendrá validez tributaria."],
    ["PRODUCTION", null],
    ["UNKNOWN", /^No pudimos confirmar el ambiente/],
  ] as const) {
    it(`${environment}: junto a «Emitir» y en la confirmación, con texto e icono`, async () => {
      render(<DebitNoteDraftScreen draftId="ndd-1" />, {
        "GET /api/v1/debit-notes/drafts/ndd-1": ok(debitNoteDraft()),
        "GET /api/v1/company/status": companyStatus(environment),
      });
      const user = userEvent.setup();
      if (expected !== null) {
        await waitFor(() => expect(notices()).toHaveLength(1), { timeout: 5_000 });
      }
      const dialog = await openEmission(user);
      if (expected === null) {
        expect(notices()).toHaveLength(0);
        expect(within(dialog).getByText("Producción")).toBeDefined();
        return;
      }
      expect(notices()).toHaveLength(2);
      const inDialog = within(dialog)
        .getByText(expected)
        .closest("[data-slot=emission-environment-notice]")!;
      expect(inDialog.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
      expect(within(dialog).queryByText("Producción")).toBeNull();
    });
  }
});
