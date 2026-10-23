// Borrador de nota de crédito (add-credit-notes, tarea 13.2, design D19): la anulación total sin
// selección de líneas y con retorno físico solo en los bienes elegibles; los problemas junto a su
// línea y la emisión bloqueada; la emisión imposible sin las dos declaraciones; el doble clic que
// envía una sola emisión y el reintento con la misma clave; los 409 explicados y el foco tras cada
// acción; y el borrador nuevo desde la factura.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionGate } from "@/components/session";
import { CreditNoteDraftScreen } from "@/features/credit-notes/credit-note-draft-editor";
import { creditNoteDetail, creditNoteDraft, invoiceCredit } from "./credit-note-fixtures";
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
const DECLARATIONS = ["NOT_NEGOTIATED_COMMERCIAL_INVOICE", "NOT_TAX_REFUND_SUPPORT"];
const NEGOTIABLE =
  "Declaro que esta factura no es una factura comercial negociable que haya sido negociada.";
const REFUND = "Declaro que esta factura no sustentó una solicitud de devolución de impuestos.";

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
    "GET /api/v1/credit-notes/invoices/inv-1/credit": ok(invoiceCredit()),
    ...routes,
  });
  renderApp(<SessionGate fallback={<p>cargando</p>}>{ui}</SessionGate>);
  return calls;
}
const lineItem = (position: number, name: string) =>
  screen.getByRole("listitem", { name: `Línea ${position}: ${name}` });
const findLine = (position: number, name: string) =>
  screen.findByRole("listitem", { name: `Línea ${position}: ${name}` });
const openEmission = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole("button", { name: "Emitir nota de crédito" }));
  return screen.findByRole("dialog", { name: "Emitir nota de crédito" });
};
const declareBoth = async (user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) => {
  await user.click(within(dialog).getByRole("checkbox", { name: NEGOTIABLE }));
  await user.click(within(dialog).getByRole("checkbox", { name: REFUND }));
};

beforeEach(() => {
  navigation.pathname = "/notas-credito/borradores/cnd-1";
  navigation.search = new URLSearchParams();
  navigation.replace.mockReset();
  navigation.push.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("borrador de nota de crédito", () => {
  it("anulación total: sin elegir líneas, con retorno físico solo en los bienes que salieron del inventario", async () => {
    let saved: unknown;
    render(<CreditNoteDraftScreen draftId="cnd-1" />, {
      "GET /api/v1/credit-notes/drafts/cnd-1": ok(
        creditNoteDraft({ cause: "TOTAL_ANNULMENT", lines: [] }),
      ),
      "PUT /api/v1/credit-notes/drafts/cnd-1": (init) => {
        saved = JSON.parse(init.body as string);
        return {
          status: 200,
          body: { data: creditNoteDraft({ cause: "TOTAL_ANNULMENT", version: 2 }) },
        };
      },
    });
    const good = await findLine(1, "Perno de acero");
    expect(screen.queryByRole("checkbox", { name: "Devolver esta línea" })).toBeNull();
    const service = lineItem(2, "Instalación");
    expect(within(good).getByText("Se acredita completa: 4.")).toBeDefined();
    expect(within(service).getByText("Se acredita completa: 1.")).toBeDefined();
    expect(within(good).getByRole("textbox", { name: "Retorno físico" })).toHaveProperty(
      "disabled",
      false,
    );
    const blocked = within(service).getByRole("textbox", { name: "Retorno físico" });
    expect(blocked).toHaveProperty("disabled", true);
    expect(within(service).getByText(/la línea no afectaba al inventario/)).toBeDefined();
    expect(blocked.getAttribute("aria-describedby")).toBe("retorno-2-hint");

    const user = userEvent.setup();
    await user.type(within(good).getByRole("textbox", { name: "Retorno físico" }), "2");
    await user.click(screen.getByRole("button", { name: "Guardar borrador" }));
    await waitFor(() =>
      expect(saved).toEqual({
        emissionPointId: "ep-1",
        cause: "TOTAL_ANNULMENT",
        reason: "Devolución de mercadería",
        lines: [{ position: 1, physicalReturn: "2" }],
        expectedVersion: 1,
      }),
    );
    // Tras guardar, el editor se vuelve a montar con la versión nueva y el foco va al resumen.
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Resumen" })),
    );
  });

  it("los problemas aparecen junto a su línea y bloquean la emisión", async () => {
    render(<CreditNoteDraftScreen draftId="cnd-1" />, {
      "GET /api/v1/credit-notes/drafts/cnd-1": ok(
        creditNoteDraft({
          preview: {
            ...creditNoteDraft().preview,
            totals: null,
            issues: [
              {
                code: "CREDIT_NOTE_QUANTITY_EXCEEDED",
                message: "La cantidad supera lo acreditable de la línea: quedan 0.",
                line: 1,
              },
              {
                code: "CREDIT_NOTE_REASON_REQUIRED",
                message: "Indica el motivo de la nota de crédito.",
                line: null,
              },
            ],
          },
        }),
      ),
    });
    const line = await findLine(1, "Perno de acero");
    expect(line.getAttribute("aria-invalid")).toBe("true");
    expect(
      within(line).getByText("La cantidad supera lo acreditable de la línea: quedan 0."),
    ).toBeDefined();
    expect(lineItem(2, "Instalación").getAttribute("aria-invalid")).toBeNull();
    const summary = screen.getByRole("complementary", { name: "Resumen" });
    expect(within(summary).getByText("Indica el motivo de la nota de crédito.")).toBeDefined();
    const emit = screen.getByRole("button", { name: "Emitir nota de crédito" });
    expect(emit).toHaveProperty("disabled", true);
    expect(screen.getByText("Resuelve los problemas antes de emitir.")).toBeDefined();
  });

  it("sin las dos declaraciones no se puede emitir; con ambas viajan con su versión", async () => {
    let body: unknown;
    render(<CreditNoteDraftScreen draftId="cnd-1" />, {
      "GET /api/v1/credit-notes/drafts/cnd-1": ok(creditNoteDraft()),
      "POST /api/v1/credit-notes": (init) => {
        body = JSON.parse(init.body as string);
        return { status: 201, body: { data: creditNoteDetail("SIGNED") } };
      },
    });
    const user = userEvent.setup();
    const dialog = await openEmission(user);
    expect(within(dialog).getByText(/el sistema no puede comprobarlas/)).toBeDefined();
    expect(
      within(dialog).getByText(/Res. NAC-DGERCGC25-00000014, disposición general segunda/),
    ).toBeDefined();
    const confirm = within(dialog).getByRole("button", { name: "Emitir nota de crédito" });
    expect(confirm).toHaveProperty("disabled", true);
    await user.click(within(dialog).getByRole("checkbox", { name: NEGOTIABLE }));
    expect(confirm).toHaveProperty("disabled", true);
    expect(within(dialog).getByText("Marca las dos declaraciones para emitir.")).toBeDefined();
    await user.click(within(dialog).getByRole("checkbox", { name: REFUND }));
    expect(confirm).toHaveProperty("disabled", false);
    await user.click(confirm);
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/notas-credito/nc-1"));
    expect(body).toEqual({
      draftId: "cnd-1",
      expectedVersion: 1,
      declarations: { version: 1, statements: DECLARATIONS },
    });
    expect(await screen.findByText("Emitiste la nota de crédito 001-001-000000007.")).toBeDefined();
  });

  it("el doble clic envía una sola emisión y el reintento repite la misma clave", async () => {
    const keys: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    render(<CreditNoteDraftScreen draftId="cnd-1" />, {
      "GET /api/v1/credit-notes/drafts/cnd-1": ok(creditNoteDraft()),
      "POST /api/v1/credit-notes": (init) => {
        keys.push(new Headers(init.headers).get("Idempotency-Key") ?? "");
        return keys.length === 1
          ? { status: 503, body: errorBody("CRYPTO_UNAVAILABLE", "No disponible.") }
          : { status: 201, body: { data: creditNoteDetail("SIGNED") } };
      },
    });
    const fetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        if (input === "/api/v1/credit-notes" && init?.method === "POST") await gate;
        return fetch(input, init);
      }),
    );
    const user = userEvent.setup();
    let dialog = await openEmission(user);
    await declareBoth(user, dialog);
    await user.dblClick(within(dialog).getByRole("button", { name: "Emitir nota de crédito" }));
    release();
    // El primer intento falla: el aviso queda en el editor con el foco.
    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(document.activeElement).toBe(alert));
    expect(keys).toHaveLength(1);
    dialog = await openEmission(user);
    // Las declaraciones se vuelven a marcar en cada confirmación.
    expect(within(dialog).getByRole("checkbox", { name: NEGOTIABLE })).toHaveProperty(
      "checked",
      false,
    );
    await declareBoth(user, dialog);
    await user.click(within(dialog).getByRole("button", { name: "Emitir nota de crédito" }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/notas-credito/nc-1"));
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^[!-~]{1,100}$/);
    expect(keys[1]).toBe(keys[0]);
  });

  it("un 409 de capacidad se explica con el foco en el aviso y vuelve a pedir la vista previa", async () => {
    let draftReads = 0;
    let creditReads = 0;
    render(<CreditNoteDraftScreen draftId="cnd-1" />, {
      "GET /api/v1/credit-notes/drafts/cnd-1": () => {
        draftReads += 1;
        return { status: 200, body: { data: creditNoteDraft() } };
      },
      "GET /api/v1/credit-notes/invoices/inv-1/credit": () => {
        creditReads += 1;
        return { status: 200, body: { data: invoiceCredit() } };
      },
      "POST /api/v1/credit-notes": () => ({
        status: 409,
        body: errorBody("CREDIT_NOTE_QUANTITY_EXCEEDED", "La cantidad supera lo acreditable."),
      }),
    });
    const user = userEvent.setup();
    const dialog = await openEmission(user);
    await declareBoth(user, dialog);
    await user.click(within(dialog).getByRole("button", { name: "Emitir nota de crédito" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "Otra nota tomó parte de lo acreditable de la factura. Revisa las cantidades con la vista previa actualizada.",
    );
    await waitFor(() => expect(document.activeElement).toBe(alert));
    await waitFor(() => expect(draftReads).toBeGreaterThanOrEqual(2));
    expect(creditReads).toBeGreaterThanOrEqual(2);
  });

  it("un borrador cambiado por otra persona se explica y se recarga", async () => {
    let version = 1;
    render(<CreditNoteDraftScreen draftId="cnd-1" />, {
      "GET /api/v1/credit-notes/drafts/cnd-1": () => ({
        status: 200,
        body: { data: creditNoteDraft({ version }) },
      }),
      "POST /api/v1/credit-notes": () => {
        version = 2;
        return {
          status: 409,
          body: errorBody("CREDIT_NOTE_DRAFT_CHANGED", "El borrador cambió."),
        };
      },
    });
    const user = userEvent.setup();
    const dialog = await openEmission(user);
    await declareBoth(user, dialog);
    await user.click(within(dialog).getByRole("button", { name: "Emitir nota de crédito" }));
    expect(
      await screen.findByText(
        "Alguien cambió este borrador mientras lo revisabas. Recárgalo para ver la versión vigente.",
      ),
    ).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Recargar borrador" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("una nota nueva empieza en devolución, a todo el ancho, que exige cantidad en la línea elegida", async () => {
    render(<CreditNoteDraftScreen draftId={null} invoiceId="inv-1" />, {});
    await screen.findByRole("heading", { name: "Nueva nota de crédito" });
    expect(screen.getByText("Factura 001-001-000000001")).toBeDefined();
    const user = userEvent.setup();
    // La devolución, la opción de la izquierda, viene elegida (decisión del propietario, 2026-10-22).
    const returnCause = screen.getByRole("radio", { name: "Devolución" });
    expect(returnCause.getAttribute("aria-checked")).toBe("true");
    expect(returnCause.parentElement!.className).toContain("w-full");
    expect(
      screen.getByRole("button", { name: "Cambiar factura" }).getAttribute("data-variant"),
    ).toBe("primary");
    const good = lineItem(1, "Perno de acero");
    await user.click(within(good).getByRole("checkbox", { name: "Devolver esta línea" }));
    await user.click(screen.getByRole("button", { name: "Guardar borrador" }));
    expect(
      await within(good).findByText("Indica la cantidad acreditada de la línea."),
    ).toBeDefined();
    // El servicio no admite retorno físico: se explica junto al campo deshabilitado.
    const service = lineItem(2, "Instalación");
    await user.click(within(service).getByRole("checkbox", { name: "Devolver esta línea" }));
    expect(within(service).getByRole("textbox", { name: "Retorno físico" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("el borrador nuevo desde la factura se guarda con la factura y abre su página", async () => {
    let created: unknown;
    render(<CreditNoteDraftScreen draftId={null} invoiceId="inv-1" />, {
      "POST /api/v1/credit-notes/drafts": (init) => {
        created = JSON.parse(init.body as string);
        return { status: 201, body: { data: creditNoteDraft({ id: "cnd-9" }) } };
      },
    });
    await screen.findByRole("heading", { name: "Nueva nota de crédito" });
    const user = userEvent.setup();
    const good = lineItem(1, "Perno de acero");
    await user.click(within(good).getByRole("checkbox", { name: "Devolver esta línea" }));
    await user.type(within(good).getByRole("textbox", { name: "Cantidad acreditada" }), "1");
    await user.type(within(good).getByRole("textbox", { name: "Retorno físico" }), "1");
    await user.type(screen.getByRole("textbox", { name: "Motivo" }), "  Devolución de mercadería ");
    // Con un solo punto en la empresa, el punto predeterminado se muestra como dato.
    expect(await screen.findByText("001-001")).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Guardar borrador" }));
    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith("/notas-credito/borradores/cnd-9"),
    );
    expect(created).toEqual({
      invoiceId: "inv-1",
      emissionPointId: "ep-1",
      cause: "RETURN",
      reason: "Devolución de mercadería",
      lines: [{ position: 1, quantity: "1", physicalReturn: "1" }],
    });
  });

  it("sin factura elegida no hay página intermedia: lleva a la lista con su creación abierta", async () => {
    render(<CreditNoteDraftScreen draftId={null} />, {});
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/notas-credito?nueva=1"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("«Cambiar factura» abre el selector sobre el editor: cancelarlo conserva la factura y elegir otra la cambia", async () => {
    const eligible = (id: string, number: string, buyer: string) => ({
      id,
      documentNumber: number,
      issueDate: "2026-10-01",
      buyerIdentification: "0992877878001",
      buyerName: buyer,
      total: "66.00",
      available: "66.00",
    });
    render(<CreditNoteDraftScreen draftId={null} invoiceId="inv-1" />, {
      "GET /api/v1/credit-notes/eligible-invoices": () => ({
        status: 200,
        body: {
          data: [
            eligible("inv-1", "001-001-000000001", "EL PERNO CIA. LTDA."),
            eligible("inv-2", "001-001-000000002", "FERRETERÍA LA LLAVE"),
          ],
          meta: { page: 1, pageSize: 10, total: 2 },
        },
      }),
      "GET /api/v1/credit-notes/invoices/inv-2/credit": ok(
        invoiceCredit({ invoiceId: "inv-2", documentNumber: "001-001-000000002" }),
      ),
    });
    const user = userEvent.setup();
    expect(await screen.findByText("Factura 001-001-000000001")).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Cambiar factura" }));
    await screen.findByRole("dialog", { name: "Elegir factura" });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("Factura 001-001-000000001")).toBeDefined();
    expect(navigation.replace).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Cambiar factura" }));
    const dialog = await screen.findByRole("dialog", { name: "Elegir factura" });
    await user.click(await within(dialog).findByText("001-001-000000002"));
    expect(await screen.findByText("Factura 001-001-000000002")).toBeDefined();
    expect(navigation.replace).toHaveBeenCalledWith(
      "/notas-credito/borradores/nueva?factura=inv-2",
    );
  });

  it("un borrador ya emitido lo explica con el enlace a las notas", async () => {
    render(<CreditNoteDraftScreen draftId="cnd-1" />, {
      "GET /api/v1/credit-notes/drafts/cnd-1": () => ({
        status: 409,
        body: errorBody("CREDIT_NOTE_DRAFT_ALREADY_EMITTED", "x"),
      }),
    });
    expect(await screen.findByText("Este borrador ya se emitió")).toBeDefined();
    expect(screen.getByRole("link", { name: "Ver notas de crédito" }).getAttribute("href")).toBe(
      "/notas-credito",
    );
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
    ["TEST", "Pruebas · esta nota de crédito no tendrá validez tributaria."],
    ["PRODUCTION", null],
    ["UNKNOWN", /^No pudimos confirmar el ambiente/],
  ] as const) {
    it(`${environment}: junto a «Emitir» y en la confirmación, con texto e icono`, async () => {
      render(<CreditNoteDraftScreen draftId="cnd-1" />, {
        "GET /api/v1/credit-notes/drafts/cnd-1": ok(creditNoteDraft()),
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
