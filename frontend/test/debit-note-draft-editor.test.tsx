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
const concepts = () => screen.getAllByRole("listitem", { name: /^Concepto / });
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
    // La causa, entre las dos oficiales; el tratamiento, uno solo entre los de la factura.
    expect(
      within(within(first).getByRole("combobox", { name: "Causa" }))
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Intereses de mora", "Costos o gastos posteriores a la factura"]);
    // Ninguna tarifa vigente que la factura no tenía.
    const treatment = within(first).getByRole("combobox", {
      name: "Tratamiento de IVA",
    }) as HTMLSelectElement;
    expect(
      within(treatment)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Elige un tratamiento", "IVA 0 %", "IVA 15 %"]);
    expect(treatment.selectedOptions[0]?.textContent).toBe("IVA 15 %");
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
    expect(within(summary).getByText("$3,00")).toBeDefined();
    // El valor total y el total de la única forma de pago son el mismo valor exacto.
    expect(within(summary).getAllByText("$28,00")).toHaveLength(2);
    expect(
      within(summary).getByText(/Forma de pago: OTROS CON UTILIZACIÓN DEL SISTEMA FINANCIERO/),
    ).toBeDefined();
  });

  it("con seis tratamientos los ofrece en la misma lista, nombrados como en la factura", async () => {
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
    await user.selectOptions(
      within(third).getByRole("combobox", { name: "Causa" }),
      "LATE_PAYMENT_INTEREST",
    );
    await user.type(within(third).getByRole("textbox", { name: "Descripción" }), " Mora extra ");
    await user.type(within(third).getByRole("textbox", { name: "Importe" }), "1.234");
    await user.selectOptions(
      within(third).getByRole("combobox", { name: "Tratamiento de IVA" }),
      "IVA 15 %",
    );
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
    expect(within(dialog).getByText("$28,00")).toBeDefined();
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

  it("sin factura elegida no hay página intermedia: lleva a la lista con su creación abierta", async () => {
    navigation.pathname = "/notas-debito/borradores/nueva";
    render(<NewDebitNoteDraftScreen />, {});
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/notas-debito?nueva=1"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("«Elegir otra factura» abre el selector, y elegirla crea el borrador de esa factura", async () => {
    let created: unknown;
    navigation.pathname = "/notas-debito/borradores/nueva";
    render(<NewDebitNoteDraftScreen invoiceId="inv-1" />, {
      "GET /api/v1/invoices/inv-1": ok(authorizedInvoice()),
      "GET /api/v1/debit-notes/eligible-invoices": () => ({
        status: 200,
        body: {
          data: [
            {
              id: "inv-2",
              documentNumber: "001-001-000000002",
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
    await screen.findByText("Factura 001-001-000000001");
    await user.click(screen.getByRole("button", { name: "Elegir otra factura" }));
    const dialog = await screen.findByRole("dialog", { name: "Elegir factura" });
    await user.click(await within(dialog).findByText("001-001-000000002"));
    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith("/notas-debito/borradores/ndd-9"),
    );
    expect(created).toEqual({ invoiceId: "inv-2" });
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

  // El destino del correo va en la misma confirmación (add-email-delivery, tarea 10.2).
  it("PRODUCTION: la confirmación dice a dónde irá el correo", async () => {
    const EXPECTED_DESTINATION = "Se enviará por correo a: compras@cliente.ec.";
    render(<DebitNoteDraftScreen draftId="ndd-1" />, {
      "GET /api/v1/debit-notes/drafts/ndd-1": ok(debitNoteDraft()),
      "GET /api/v1/company/status": companyStatus("PRODUCTION"),
      "GET /api/v1/email/availability": ok({
        configured: true,
        deliveryEnabled: true,
        autoSend: true,
        testRecipient: null,
      }),
      "GET /api/v1/documents/inv-1/email-recipients": ok({
        recipients: ["compras@cliente.ec"],
        environment: "PRODUCTION",
        testRedirect: false,
        testRecipient: null,
      }),
    });
    const dialog = await openEmission(userEvent.setup());
    expect(
      (await within(dialog).findByText(EXPECTED_DESTINATION)).closest(
        "[data-slot=email-destination-notice]",
      ),
    ).not.toBeNull();
  });
});

describe("pedidos del propietario sobre la nota de débito (2026-10-22)", () => {
  it("el número del concepto va en una franja azul y los títulos son más discretos", async () => {
    render(<DebitNoteDraftScreen draftId="ndd-1" />, {
      "GET /api/v1/debit-notes/drafts/ndd-1": ok(debitNoteDraft()),
    });
    const first = await findConcept(1);
    // 10 % para el número, vertical en su franja con un degradado azul discreto, y 90 % para los
    // campos.
    expect(first.className).toContain("sm:grid-cols-[minmax(0,10fr)_minmax(0,90fr)]");
    const number = first.querySelector("[data-slot=item-number]") as HTMLElement;
    expect(number.className).toContain("bg-linear-to-b");
    expect(number.className).toContain("text-primary");
    expect(within(number).getByRole("heading", { level: 3 }).textContent).toBe("Concepto 1");
    expect(
      screen.getByRole("heading", { level: 2, name: "Establecimiento y punto de emisión" })
        .className,
    ).toContain("sr-only");
    expect(
      screen.getByRole("heading", { level: 2, name: "Factura que se modifica" }).className,
    ).toContain("text-sm");
    // La nota de los conceptos va en el tooltip de su título.
    expect(screen.getByRole("button", { name: "Ayuda: Conceptos" })).toBeDefined();
    // El importe se escribe desde el inicio; un separador debajo de «Agregar concepto».
    expect(within(first).getByRole("textbox", { name: "Importe" }).className).not.toContain(
      "text-right",
    );
    expect(
      screen
        .getByRole("button", { name: "Agregar concepto" })
        .closest("section")
        ?.nextElementSibling?.getAttribute("data-slot"),
    ).toBe("separator");
    // Con cambios sin guardar, el aviso de emitir va centrado debajo de «Guardar borrador».
    const user = userEvent.setup();
    await user.type(within(first).getByRole("textbox", { name: "Descripción" }), " extra");
    const hint = await screen.findByText("Guarda los cambios antes de emitir.");
    expect(hint.className).toContain("text-center");
    const save = screen.getByRole("button", { name: "Guardar borrador" });
    expect(save.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("el tratamiento es una lista también con un solo tratamiento en la factura", async () => {
    const base = debitNoteDraft();
    const iva15 = { key: "2:4", taxCode: "2", rateCode: "4", percentage: "15", label: "15%" };
    render(<DebitNoteDraftScreen draftId="ndd-1" />, {
      "GET /api/v1/debit-notes/drafts/ndd-1": ok(
        debitNoteDraft({ preview: { ...base.preview, taxTreatments: [iva15] } }),
      ),
    });
    const user = userEvent.setup();
    await findConcept(1);
    await user.click(screen.getByRole("button", { name: "Agregar concepto" }));
    const fresh = concept(concepts().length);
    const select = within(fresh).getByRole("combobox", {
      name: "Tratamiento de IVA",
    }) as HTMLSelectElement;
    expect(
      within(select)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Elige un tratamiento", "IVA 15 %"]);
    expect(select.value).toBe("");
    expect(within(fresh).queryByRole("checkbox")).toBeNull();
    expect(within(fresh).queryByRole("radio")).toBeNull();
    await user.selectOptions(select, "IVA 15 %");
    expect(select.value).toBe("2:4");
  });

  it("el punto de emisión va antes de los conceptos, y la forma de pago al final", async () => {
    render(<DebitNoteDraftScreen draftId="ndd-1" />, {
      "GET /api/v1/debit-notes/drafts/ndd-1": ok(debitNoteDraft()),
    });
    await findConcept(1);
    // Las secciones del editor, nombradas por su título (la zona de avisos usa `aria-label`).
    const sections = screen
      .getAllByRole("region")
      .map((region) => region.getAttribute("aria-labelledby"))
      .filter((id) => id !== null)
      .map((id) => document.getElementById(id)?.textContent);
    expect(sections).toEqual([
      "Nota de débito Borrador",
      "Factura que se modifica",
      "Establecimiento y punto de emisión",
      "Conceptos",
      "Forma de pago",
    ]);
    // La forma de pago no repite su título: la etiqueta del campo ya lo dice.
    expect(screen.getByRole("heading", { level: 2, name: "Forma de pago" }).className).toContain(
      "sr-only",
    );
  });

  it("el establecimiento y luego su punto, en dos selectores dependientes", async () => {
    let saved: { emissionPointId?: string } | undefined;
    render(<DebitNoteDraftScreen draftId="ndd-1" />, {
      "GET /api/v1/debit-notes/drafts/ndd-1": ok(debitNoteDraft()),
      "GET /api/v1/establishments": ok([
        {
          id: "est-1",
          code: "001",
          address: "Av. Amazonas, Quito",
          status: "ACTIVE",
          emissionPoints: [{ id: "ep-1", code: "001", status: "ACTIVE", available: true }],
        },
        {
          id: "est-2",
          code: "002",
          address: "Av. 9 de Octubre, Guayaquil",
          status: "ACTIVE",
          emissionPoints: [
            { id: "ep-2", code: "001", status: "ACTIVE", available: true },
            { id: "ep-3", code: "002", status: "ACTIVE", available: true },
          ],
        },
      ]),
      "PUT /api/v1/debit-notes/drafts/ndd-1": (init) => {
        saved = JSON.parse(init.body as string) as { emissionPointId?: string };
        return { status: 200, body: { data: debitNoteDraft({ version: 2 }) } };
      },
    });
    const user = userEvent.setup();
    const establishment = await screen.findByLabelText("Establecimiento");
    const point = screen.getByLabelText("Punto de emisión") as HTMLSelectElement;
    // Con los establecimientos cargados, el punto guardado queda elegido.
    await waitFor(() => expect(point.value).toBe("ep-1"));
    await user.selectOptions(establishment, "est-2");
    // El punto anterior no es de este establecimiento: hay que elegir uno de los suyos.
    expect(point.value).toBe("");
    expect(
      within(point)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Elige un punto", "002-001", "002-002"]);
    await user.selectOptions(point, "ep-3");
    await user.click(screen.getByRole("button", { name: "Guardar borrador" }));
    await waitFor(() => expect(saved?.emissionPointId).toBe("ep-3"));
  });

  it("un concepto nuevo empieza con su causa elegida, a todo el ancho, y su descripción es un área de una línea", async () => {
    render(<DebitNoteDraftScreen draftId="ndd-1" />, {
      "GET /api/v1/debit-notes/drafts/ndd-1": ok(debitNoteDraft()),
    });
    const user = userEvent.setup();
    await findConcept(1);
    const add = screen.getByRole("button", { name: "Agregar concepto" });
    // «Agregar concepto» ocupa todo el ancho, punteado.
    expect(add.className).toContain("w-full");
    expect(add.className).toContain("border-dashed");
    await user.click(add);
    const fresh = concept(concepts().length);
    const cause = within(fresh).getByRole("combobox", { name: "Causa" }) as HTMLSelectElement;
    expect(cause.value).toBe("LATE_PAYMENT_INTEREST");
    // Causa, importe y tratamiento en una fila de tres columnas cuando el concepto es ancho.
    expect(fresh.querySelector("[data-slot=concept-fields]")?.className).toContain(
      "@xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.3fr)]",
    );
    const description = within(fresh).getByRole("textbox", { name: "Descripción" });
    expect(description.tagName).toBe("TEXTAREA");
    await user.type(description, "Mora{Enter}de 30 días");
    // Enter no parte la línea: el comprobante la lleva en una sola.
    expect((description as HTMLTextAreaElement).value).toBe("Morade 30 días");
    expect(within(fresh).getByText(/14\/300/)).toBeDefined();
    // Quitar un concepto va en rojo.
    expect(screen.getByRole("button", { name: "Quitar el concepto 2" }).className).toContain(
      "text-danger",
    );
  });
});
