// Borrador de liquidación de compra (add-purchase-settlements, tarea 12.2, design D24): el punto
// predeterminado; solo proveedores con el rol, los no seleccionables deshabilitados con su motivo, la
// dirección propuesta desde el tercero y el rol de proveedor marcado solo en el alta explícita; el
// producto que propone el código y la descripción pero nunca el precio; ninguna forma de pago, plazo
// ni unidad de tiempo precargada; ningún total ni dato derivado enviado; los problemas junto a su
// línea o su pago, con la emisión bloqueada; la vista previa con el aviso de la retención; las
// cuatro declaraciones con su propia casilla y sin casilla genérica; el éxito que lleva al detalle;
// el doble clic que envía una sola emisión con la misma clave en el reintento; los 409 explicados.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PURCHASE_SETTLEMENT_STATEMENTS } from "@facturador/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionGate } from "@/components/session";
import { useNewPurchaseSettlement } from "@/features/purchase-settlements/new-purchase-settlement";
import { PurchaseSettlementDraftScreen } from "@/features/purchase-settlements/purchase-settlement-draft-editor";
import {
  ADMIN_ME,
  OPERATOR_ME,
  errorBody,
  mockApi,
  navigation,
  renderApp,
  type Route,
} from "./harness";
import {
  SETTLEMENT_OPTIONS,
  SUPPLIER_VIEW,
  emptySettlementDraft,
  settlementDetail,
  settlementDraft,
} from "./purchase-settlement-fixtures";

// La política vigente da los permisos de la liquidación a los dos roles: se retiran para probarlos.
const permissions = vi.hoisted(() => ({ deny: new Set<string>() }));
vi.mock("@/lib/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/permissions")>();
  return {
    ...actual,
    canSee: (...args: Parameters<typeof actual.canSee>) =>
      !permissions.deny.has(args[1]) && actual.canSee(...args),
  };
});

const ok =
  (data: unknown): Route =>
  () => ({ status: 200, body: { data } });
const page =
  (data: unknown[]): Route =>
  () => ({ status: 200, body: { data, meta: { page: 1, pageSize: 10, total: data.length } } });

const STATEMENT_TEXTS = [
  "El proveedor es una persona natural no obligada a llevar contabilidad.",
  "El proveedor no está inscrito en el RUC o tiene su RUC suspendido a la fecha de la transacción.",
  "Por su nivel cultural o rusticidad, el proveedor no puede emitir comprobantes de venta.",
  "La operación corresponde a la adquisición de bienes muebles o servicios.",
];

function render(
  ui: React.ReactNode,
  routes: Record<string, Route>,
  me: typeof ADMIN_ME | typeof OPERATOR_ME = OPERATOR_ME,
) {
  const calls = mockApi({
    "GET /api/v1/me": () => ({ status: 200, body: { data: me } }),
    "GET /api/v1/company/status": ok({
      environment: "TEST",
      displayName: "EMPRESA DE PRUEBA S.A.",
      readiness: { ready: true, checks: [] },
    }),
    "GET /api/v1/establishments": ok([
      {
        id: "est-1",
        code: "001",
        address: "Av. 6 de Diciembre, Quito",
        status: "ACTIVE",
        emissionPoints: [{ id: "pto-1", code: "001", status: "ACTIVE", available: true }],
      },
    ]),
    "GET /api/v1/me/default-emission-point": ok({
      establishment: {
        id: "est-1",
        code: "001",
        address: "Av. 6 de Diciembre, Quito",
        status: "ACTIVE",
      },
      emissionPoint: { id: "pto-1", code: "001", status: "ACTIVE" },
      available: true,
    }),
    "GET /api/v1/purchase-settlements/options": ok(SETTLEMENT_OPTIONS),
    ...routes,
  });
  renderApp(<SessionGate fallback={<p>cargando</p>}>{ui}</SessionGate>);
  return calls;
}
const lineCard = (position: number) => screen.getByRole("listitem", { name: `Línea ${position}` });
const paymentRow = (position: number) => screen.getByRole("listitem", { name: `Pago ${position}` });
const openEmission = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole("button", { name: "Emitir liquidación de compra" }));
  return screen.findByRole("dialog", { name: "Emitir liquidación de compra" });
};
const declareAll = async (user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) => {
  for (const text of STATEMENT_TEXTS) {
    await user.click(within(dialog).getByRole("checkbox", { name: text }));
  }
};
const saveAndCapture = async (
  user: ReturnType<typeof userEvent.setup>,
  saved: () => Record<string, unknown> | undefined,
) => {
  await user.click(screen.getByRole("button", { name: "Guardar borrador" }));
  await waitFor(() => expect(saved()).toBeDefined());
  return saved()!;
};

/** El catálogo de tipos de identificación con la cédula, para el alta de un proveedor. */
const CEDULA_VERSION = {
  id: "id-05",
  officialLabel: "CEDULA",
  effectiveFrom: "2026-07-27",
  effectiveFromBasis: "PROJECT_BASELINE",
  effectiveTo: null,
  normativeStatus: "OFFICIAL",
  sourceRef: "Tabla 6",
  datasetVersion: 1,
  rate: null,
  taxKind: null,
  identificationRule: { pattern: null, description: "10 dígitos", reservedFor: null },
  withholding: null,
};
const IDENTIFICATION_TYPES = {
  catalog: {
    catalogType: "identification-type",
    datasetVersion: 1,
    source: {
      document: "Ficha técnica",
      version: "2.34",
      publishedOn: "2026-07-27",
      url: "https://www.sri.gob.ec",
      sha256: "a".repeat(64),
    },
    enablementPolicy: "NOT_ENABLEABLE",
  },
  at: "2026-10-07",
  entries: [
    {
      entryKey: "05",
      code: "05",
      versions: [CEDULA_VERSION],
      applicable: CEDULA_VERSION,
      enablement: { enabled: true, source: "NOT_ENABLEABLE" },
      usable: true,
    },
  ],
};

beforeEach(() => {
  permissions.deny.clear();
  navigation.pathname = "/liquidaciones-compra/borradores/lcd-1";
  navigation.search = new URLSearchParams();
  navigation.replace.mockReset();
  navigation.push.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("borrador de liquidación de compra", () => {
  it("un borrador nuevo no precarga forma de pago, plazo, unidad de tiempo ni tarifa, y toma el punto predeterminado", async () => {
    render(<PurchaseSettlementDraftScreen draftId="lcd-1" />, {
      "GET /api/v1/purchase-settlements/drafts/lcd-1": ok(emptySettlementDraft()),
    });
    await screen.findByRole("listitem", { name: "Pago 1" });
    const payment = paymentRow(1);
    expect((within(payment).getByLabelText("Forma de pago") as HTMLSelectElement).value).toBe("");
    expect((within(payment).getByLabelText("Total (USD)") as HTMLInputElement).value).toBe("");
    expect((within(payment).getByLabelText("Plazo") as HTMLInputElement).value).toBe("");
    expect((within(payment).getByLabelText("Unidad de tiempo") as HTMLInputElement).value).toBe("");
    expect((within(lineCard(1)).getByLabelText("IVA") as HTMLSelectElement).value).toBe("");
    // Con un solo punto en la empresa, el punto predeterminado se muestra como dato.
    expect(await screen.findByText("001-001")).toBeDefined();
    // La vista previa informa lo que falta, y la emisión queda bloqueada hasta guardar.
    expect(screen.getByRole("button", { name: "Emitir liquidación de compra" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("solo ofrece proveedores con el rol, deshabilita los que no caben con su motivo y propone su dirección", async () => {
    let saved: Record<string, unknown> | undefined;
    const calls = render(<PurchaseSettlementDraftScreen draftId="lcd-1" />, {
      "GET /api/v1/purchase-settlements/drafts/lcd-1": ok(emptySettlementDraft()),
      "GET /api/v1/purchase-settlements/suppliers": page([
        SUPPLIER_VIEW,
        {
          id: "prov-2",
          identificationType: "04",
          identification: "1792345678001",
          legalName: "SERVICIOS ANDINOS S.A.",
          address: null,
          selectable: false,
          reason:
            "La liquidación del sistema admite cédula o pasaporte: es una restricción del MVP para el caso c).",
        },
      ]),
      "PUT /api/v1/purchase-settlements/drafts/lcd-1": (init) => {
        saved = JSON.parse(init.body as string) as Record<string, unknown>;
        return { status: 200, body: { data: settlementDraft({ version: 2 }) } };
      },
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Elegir proveedor" }));
    const picker = await screen.findByRole("dialog", { name: "Elegir proveedor" });
    const ruc = await within(picker).findByRole("option", {
      name: "SERVICIOS ANDINOS S.A., 1792345678001, no se puede elegir",
    });
    expect(ruc.getAttribute("aria-disabled")).toBe("true");
    expect(within(picker).getByText(/restricción del MVP para el caso c\)/)).toBeDefined();
    await user.click(ruc);
    expect(screen.getByRole("dialog", { name: "Elegir proveedor" })).toBeDefined();
    await user.click(within(picker).getByText("María Quishpe"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Elegir proveedor" })).toBeNull(),
    );
    expect((screen.getByLabelText("Dirección del proveedor") as HTMLInputElement).value).toBe(
      "Comunidad San Pablo, Cayambe",
    );
    const body = await saveAndCapture(user, () => saved);
    expect(body).toMatchObject({
      supplierPartyId: "prov-1",
      supplierAddress: "Comunidad San Pablo, Cayambe",
      expectedVersion: 1,
    });
    // Elegir un proveedor nunca toca el tercero: no hay escrituras de Terceros.
    expect(calls.some((call) => call.key.includes("/api/v1/parties"))).toBe(false);
  });

  it("'Nuevo proveedor' registra el tercero con el rol marcado a la vista y lo deja elegido", async () => {
    let party: Record<string, unknown> | undefined;
    render(<PurchaseSettlementDraftScreen draftId="lcd-1" />, {
      "GET /api/v1/purchase-settlements/drafts/lcd-1": ok(emptySettlementDraft()),
      "GET /api/v1/purchase-settlements/suppliers": page([]),
      "GET /api/v1/fiscal-catalogs/identification-type/entries": ok(IDENTIFICATION_TYPES),
      "POST /api/v1/parties": (init) => {
        party = JSON.parse(init.body as string) as Record<string, unknown>;
        return {
          status: 201,
          body: {
            data: {
              id: "prov-9",
              identificationType: "05",
              identificationTypeLabel: "CEDULA",
              identification: "1710034065",
              legalName: "Rosa Chicaiza",
              address: "Recinto El Paraíso, Quinindé",
              email: null,
              phone: null,
              roles: ["SUPPLIER"],
              status: "ACTIVE",
              systemRecord: null,
              version: 1,
              createdAt: "2026-10-07T15:00:00.000Z",
              updatedAt: "2026-10-07T15:00:00.000Z",
            },
          },
        };
      },
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Elegir proveedor" }));
    const picker = await screen.findByRole("dialog", { name: "Elegir proveedor" });
    await user.click(await within(picker).findByText("Nuevo proveedor"));
    const form = await screen.findByRole("dialog", { name: "Tercero Nuevo" });
    expect(
      within(form).getByRole("button", { name: "Proveedor" }).getAttribute("aria-pressed"),
    ).toBe("true");
    await user.type(within(form).getByLabelText("Identificación"), "1710034065");
    await user.type(within(form).getByLabelText("Razón social o nombres"), "Rosa Chicaiza");
    await user.type(
      within(form).getByLabelText("Dirección (opcional)"),
      "Recinto El Paraíso, Quinindé",
    );
    await user.click(within(form).getByRole("button", { name: "Registrar tercero" }));
    await waitFor(() => expect(screen.getByText("Rosa Chicaiza")).toBeDefined());
    expect(party).toMatchObject({ roles: ["SUPPLIER"], identification: "1710034065" });
    expect((screen.getByLabelText("Dirección del proveedor") as HTMLInputElement).value).toBe(
      "Recinto El Paraíso, Quinindé",
    );
  });

  it("el producto propone el código y la descripción, nunca el precio, y no se envían totales ni derivados", async () => {
    let saved: Record<string, unknown> | undefined;
    render(<PurchaseSettlementDraftScreen draftId="lcd-1" />, {
      "GET /api/v1/purchase-settlements/drafts/lcd-1": ok(emptySettlementDraft()),
      "GET /api/v1/products": page([
        {
          id: "prod-7",
          kind: "SERVICE",
          mainCode: "COS-01",
          auxiliaryCode: "AUX-7",
          name: "Servicio de cosecha",
          description: null,
          unitPrice: "99.99",
          stockTracked: false,
          status: "ACTIVE",
          version: 1,
          taxes: [],
          taxConfiguration: { status: "READY", reasons: [], evaluatedOn: "2026-10-01" },
          createdAt: "2026-10-01T15:00:00.000Z",
          updatedAt: "2026-10-01T15:00:00.000Z",
        },
      ]),
      "PUT /api/v1/purchase-settlements/drafts/lcd-1": (init) => {
        saved = JSON.parse(init.body as string) as Record<string, unknown>;
        return { status: 200, body: { data: settlementDraft({ version: 2 }) } };
      },
    });
    const user = userEvent.setup();
    await screen.findByRole("listitem", { name: "Línea 1" });
    await user.click(
      within(lineCard(1)).getByRole("button", {
        name: "Elegir un producto para la línea 1 (opcional)",
      }),
    );
    const picker = await screen.findByRole("dialog", { name: "Elegir producto" });
    await user.click(await within(picker).findByText("Servicio de cosecha"));
    const line = lineCard(1);
    expect((within(line).getByLabelText("Código principal") as HTMLInputElement).value).toBe(
      "COS-01",
    );
    expect((within(line).getByLabelText("Descripción") as HTMLInputElement).value).toBe(
      "Servicio de cosecha",
    );
    // El precio del producto nunca se propone: es el de esta compra.
    expect((within(line).getByLabelText("Precio unitario (USD)") as HTMLInputElement).value).toBe(
      "",
    );
    await user.type(within(line).getByLabelText("Cantidad"), "3");
    await user.type(within(line).getByLabelText("Precio unitario (USD)"), "20");
    await user.selectOptions(within(line).getByLabelText("IVA"), "0");
    const payment = paymentRow(1);
    await user.selectOptions(within(payment).getByLabelText("Forma de pago"), "01");
    await user.type(within(payment).getByLabelText("Total (USD)"), "60.00");
    await user.type(within(payment).getByLabelText("Plazo"), "0");
    await user.type(within(payment).getByLabelText("Unidad de tiempo"), "días");
    const body = await saveAndCapture(user, () => saved);
    expect(body).toEqual({
      emissionPointId: "pto-1",
      supplierPartyId: null,
      supplierAddress: null,
      lines: [
        {
          productId: "prod-7",
          mainCode: "COS-01",
          auxiliaryCode: "AUX-7",
          description: "Servicio de cosecha",
          unit: null,
          quantity: "3",
          unitPrice: "20",
          discount: null,
          ivaRate: "0",
        },
      ],
      payments: [{ paymentMethod: "01", total: "60.00", term: "0", timeUnit: "días" }],
      expectedVersion: 1,
    });
    expect(JSON.stringify(body)).not.toMatch(/taxableBase|subtotal|withoutTaxes|totals|amount/);
  });

  it("un formato inválido se explica en su campo y no guarda", async () => {
    const calls = render(<PurchaseSettlementDraftScreen draftId="lcd-1" />, {
      "GET /api/v1/purchase-settlements/drafts/lcd-1": ok(emptySettlementDraft()),
    });
    const user = userEvent.setup();
    await screen.findByRole("listitem", { name: "Línea 1" });
    await user.type(within(lineCard(1)).getByLabelText("Cantidad"), "1.1234567");
    await user.type(within(paymentRow(1)).getByLabelText("Unidad de tiempo"), "quincenas largas");
    await user.click(screen.getByRole("button", { name: "Guardar borrador" }));
    expect(await within(lineCard(1)).findByText(/decimales/)).toBeDefined();
    expect(
      within(paymentRow(1)).getByText("La unidad de tiempo admite como máximo 10 caracteres."),
    ).toBeDefined();
    expect(calls.some((call) => call.key.startsWith("PUT "))).toBe(false);
  });

  it("los problemas van junto a su línea o su pago, y la emisión queda bloqueada", async () => {
    const base = settlementDraft();
    render(<PurchaseSettlementDraftScreen draftId="lcd-1" />, {
      "GET /api/v1/purchase-settlements/drafts/lcd-1": ok(
        settlementDraft({
          preview: {
            ...base.preview,
            paymentsTotal: "100.00",
            issues: [
              {
                code: "PURCHASE_SETTLEMENT_DESCRIPTION_INVALID",
                message: "Línea 2: escribe la descripción.",
                field: "description",
                line: 2,
                payment: null,
              },
              {
                code: "PURCHASE_SETTLEMENT_PAYMENTS_MISMATCH",
                message: "Los pagos suman 100.00 y el importe total es 106.00: faltan 6.00.",
                field: "payments",
                line: null,
                payment: null,
              },
              {
                code: "PURCHASE_SETTLEMENT_PAYMENT_TERM_REQUIRED",
                message: "Pago 2: escribe el plazo.",
                field: "term",
                line: null,
                payment: 2,
              },
            ],
          },
        }),
      ),
    });
    await screen.findByRole("listitem", { name: "Línea 2" });
    expect(within(lineCard(2)).getByText("Línea 2: escribe la descripción.")).toBeDefined();
    expect(lineCard(2).getAttribute("aria-invalid")).toBe("true");
    expect(within(lineCard(1)).queryByText(/escribe/)).toBeNull();
    expect(within(paymentRow(2)).getByText("Pago 2: escribe el plazo.")).toBeDefined();
    const summary = screen.getByRole("complementary", { name: "Resumen" });
    expect(within(summary).getByText(/faltan 6\.00/)).toBeDefined();
    expect(screen.getByText("Pagos $100,00 de un importe total de $106,00.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Emitir liquidación de compra" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByText("Resuelve los problemas antes de emitir.")).toBeDefined();
  });

  it("la vista previa muestra los importes del servidor, el aviso de la retención y las declaraciones que se confirmarán", async () => {
    render(<PurchaseSettlementDraftScreen draftId="lcd-1" />, {
      "GET /api/v1/purchase-settlements/drafts/lcd-1": ok(settlementDraft()),
    });
    const summary = await screen.findByRole("complementary", { name: "Resumen" });
    await within(summary).findByText("$106,00");
    expect(within(summary).getByText("Subtotal 15%")).toBeDefined();
    expect(within(summary).getByText("IVA 15 %")).toBeDefined();
    expect(within(summary).getByText("$6,00")).toBeDefined();
    expect(
      within(summary).getByText(
        "Esta operación requiere la retención correspondiente conforme a la normativa aplicable.",
      ),
    ).toBeDefined();
    // El aviso no presenta la retención como emitida.
    expect(within(summary).queryByText(/retención (emitida|asociada|registrada)/i)).toBeNull();
    for (const text of STATEMENT_TEXTS) expect(within(summary).getByText(text)).toBeDefined();
    expect(within(lineCard(1)).getByText(/Base imponible \$40,00 · IVA 15 % \$6,00/)).toBeDefined();
  });

  it("emitir pide las cuatro declaraciones por separado, sin casilla genérica, y lleva al detalle", async () => {
    let emitted: Record<string, unknown> | undefined;
    render(<PurchaseSettlementDraftScreen draftId="lcd-1" />, {
      "GET /api/v1/purchase-settlements/drafts/lcd-1": ok(settlementDraft()),
      "POST /api/v1/purchase-settlements": (init) => {
        emitted = JSON.parse(init.body as string) as Record<string, unknown>;
        return { status: 201, body: { data: settlementDetail("SIGNED") } };
      },
    });
    const user = userEvent.setup();
    const dialog = await openEmission(user);
    const checkboxes = within(dialog).getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(4);
    expect(checkboxes.map((box) => box.closest("label")?.textContent)).toEqual(STATEMENT_TEXTS);
    expect(within(dialog).getByText(/el sistema no puede comprobarlas/)).toBeDefined();
    const confirm = within(dialog).getByRole("button", { name: "Emitir liquidación de compra" });
    expect(confirm).toHaveProperty("disabled", true);
    // Tres de cuatro no bastan.
    for (const text of STATEMENT_TEXTS.slice(0, 3)) {
      await user.click(within(dialog).getByRole("checkbox", { name: text }));
    }
    expect(confirm).toHaveProperty("disabled", true);
    await user.click(within(dialog).getByRole("checkbox", { name: STATEMENT_TEXTS[3]! }));
    expect(confirm).toHaveProperty("disabled", false);
    await user.click(confirm);
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/liquidaciones-compra/lc-1"));
    expect(emitted).toEqual({
      draftId: "lcd-1",
      expectedVersion: 3,
      declarations: { policyVersion: 1, statements: [...PURCHASE_SETTLEMENT_STATEMENTS] },
    });
  });

  it("el doble clic envía una sola emisión y el reintento repite la misma clave", async () => {
    const keys: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    render(<PurchaseSettlementDraftScreen draftId="lcd-1" />, {
      "GET /api/v1/purchase-settlements/drafts/lcd-1": ok(settlementDraft()),
      "POST /api/v1/purchase-settlements": (init) => {
        keys.push(new Headers(init.headers).get("Idempotency-Key") ?? "");
        return keys.length === 1
          ? { status: 503, body: errorBody("CRYPTO_UNAVAILABLE", "No disponible.") }
          : { status: 201, body: { data: settlementDetail("SIGNED") } };
      },
    });
    const fetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        if (input === "/api/v1/purchase-settlements" && init?.method === "POST") await gate;
        return fetch(input, init);
      }),
    );
    const user = userEvent.setup();
    let dialog = await openEmission(user);
    await declareAll(user, dialog);
    await user.dblClick(
      within(dialog).getByRole("button", { name: "Emitir liquidación de compra" }),
    );
    release();
    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(document.activeElement).toBe(alert));
    expect(keys).toHaveLength(1);
    // Las declaraciones se confirman otra vez en cada intento.
    dialog = await openEmission(user);
    expect(
      within(dialog)
        .getAllByRole("checkbox")
        .every((box) => !(box as HTMLInputElement).checked),
    ).toBe(true);
    await declareAll(user, dialog);
    await user.click(within(dialog).getByRole("button", { name: "Emitir liquidación de compra" }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/liquidaciones-compra/lc-1"));
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^[!-~]{1,100}$/);
    expect(keys[1]).toBe(keys[0]);
  });

  it("un rechazo de la emisión se explica con el foco y vuelve a pedir la vista previa", async () => {
    let draftReads = 0;
    render(<PurchaseSettlementDraftScreen draftId="lcd-1" />, {
      "GET /api/v1/purchase-settlements/drafts/lcd-1": () => {
        draftReads += 1;
        return { status: 200, body: { data: settlementDraft() } };
      },
      "POST /api/v1/purchase-settlements": () => ({
        status: 409,
        body: errorBody("PURCHASE_SETTLEMENT_DECLARATION_VERSION_MISMATCH", "x"),
      }),
    });
    const user = userEvent.setup();
    const dialog = await openEmission(user);
    await declareAll(user, dialog);
    await user.click(within(dialog).getByRole("button", { name: "Emitir liquidación de compra" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "La política de procedencia cambió. Recarga el borrador y confirma las declaraciones otra vez.",
    );
    await waitFor(() => expect(document.activeElement).toBe(alert));
    await waitFor(() => expect(draftReads).toBeGreaterThanOrEqual(2));
  });

  it("un borrador cambiado por otro se recarga a pedido; uno ya emitido lleva a la lista", async () => {
    let draftReads = 0;
    render(<PurchaseSettlementDraftScreen draftId="lcd-1" />, {
      "GET /api/v1/purchase-settlements/drafts/lcd-1": () => {
        draftReads += 1;
        return { status: 200, body: { data: settlementDraft() } };
      },
      "POST /api/v1/purchase-settlements": () => ({
        status: 409,
        body: errorBody("PURCHASE_SETTLEMENT_DRAFT_CHANGED", "x"),
      }),
    });
    const user = userEvent.setup();
    const dialog = await openEmission(user);
    await declareAll(user, dialog);
    await user.click(within(dialog).getByRole("button", { name: "Emitir liquidación de compra" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Alguien cambió este borrador mientras lo revisabas.");
    const reads = draftReads;
    await user.click(within(alert).getByRole("button", { name: "Recargar borrador" }));
    await waitFor(() => expect(draftReads).toBeGreaterThan(reads));
  });

  it("sin purchaseSettlements.emit se guarda pero no se ofrece emitir", async () => {
    permissions.deny.add("purchaseSettlements.emit");
    render(<PurchaseSettlementDraftScreen draftId="lcd-1" />, {
      "GET /api/v1/purchase-settlements/drafts/lcd-1": ok(settlementDraft()),
    });
    expect(await screen.findByRole("button", { name: "Guardar borrador" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Emitir liquidación de compra" })).toBeNull();
  });

  it("sin purchaseSettlements.draft explica el acceso y no consulta el borrador", async () => {
    permissions.deny.add("purchaseSettlements.draft");
    const calls = render(<PurchaseSettlementDraftScreen draftId="lcd-1" />, {});
    expect(
      await screen.findByText("No tienes acceso a los borradores de liquidaciones de compra"),
    ).toBeDefined();
    expect(calls.some((call) => call.key.includes("/purchase-settlements/drafts"))).toBe(false);
  });

  it("un borrador emitido o inexistente se explica con el camino a la lista", async () => {
    render(<PurchaseSettlementDraftScreen draftId="lcd-1" />, {
      "GET /api/v1/purchase-settlements/drafts/lcd-1": () => ({
        status: 409,
        body: errorBody("PURCHASE_SETTLEMENT_DRAFT_ALREADY_EMITTED", "x"),
      }),
    });
    expect(await screen.findByText("Este borrador ya se emitió")).toBeDefined();
    expect(
      screen.getByRole("link", { name: "Ver liquidaciones de compra" }).getAttribute("href"),
    ).toBe("/liquidaciones-compra");
  });
});

/** «Nueva liquidación de compra» como la ofrece la lista: el botón y la confirmación de `?nueva`. */
function NewPurchaseSettlement() {
  const creation = useNewPurchaseSettlement(true);
  return (
    <>
      <button type="button" disabled={creation.pending} onClick={creation.start}>
        Nueva liquidación de compra
      </button>
      {creation.element}
    </>
  );
}

describe("pedidos del propietario sobre la liquidación (2026-10-22)", () => {
  it("el proveedor es una ficha con «Cambiar proveedor» en azul, y las líneas siguen el diseño de los otros editores", async () => {
    render(<PurchaseSettlementDraftScreen draftId="lcd-1" />, {
      "GET /api/v1/purchase-settlements/drafts/lcd-1": ok(settlementDraft()),
    });
    const change = await screen.findByRole("button", { name: "Cambiar proveedor" });
    expect(change.getAttribute("data-variant")).toBe("primary");
    // Con producto, «Quitar producto» ocupa el cuarto de la fila; la descripción es un área de texto.
    const line = lineCard(1);
    expect(within(line).getByRole("button", { name: /Quitar el producto/ }).className).toContain(
      "text-danger",
    );
    expect(within(line).getByRole("textbox", { name: "Descripción" }).tagName).toBe("TEXTAREA");
    for (const name of ["Agregar línea", "Agregar pago"]) {
      const button = screen.getByRole("button", { name });
      expect(button.className, name).toContain("w-full");
      expect(button.className, name).toContain("border-dashed");
    }
  });
});

describe("nueva liquidación de compra sobre la lista (decisión del propietario, 2026-10-22)", () => {
  it("el botón prepara el borrador con el punto predeterminado y abre su editor", async () => {
    let created: unknown;
    navigation.pathname = "/liquidaciones-compra";
    render(<NewPurchaseSettlement />, {
      "POST /api/v1/purchase-settlements/drafts": (init) => {
        created = JSON.parse(init.body as string);
        return { status: 201, body: { data: emptySettlementDraft() } };
      },
    });
    const user = userEvent.setup();
    const button = await screen.findByRole("button", { name: "Nueva liquidación de compra" });
    await waitFor(() => expect(button).toHaveProperty("disabled", false));
    await user.click(button);
    await waitFor(() =>
      expect(navigation.push).toHaveBeenCalledWith("/liquidaciones-compra/borradores/lcd-1"),
    );
    expect(created).toEqual({ emissionPointId: "pto-1" });
  });

  it("desde la creación rápida (`?nueva`) pide confirmar antes de preparar el borrador", async () => {
    navigation.pathname = "/liquidaciones-compra";
    navigation.search = new URLSearchParams("nueva=1");
    const calls = render(<NewPurchaseSettlement />, {
      "POST /api/v1/purchase-settlements/drafts": () => ({
        status: 201,
        body: { data: emptySettlementDraft() },
      }),
    });
    const dialog = await screen.findByRole("dialog", { name: "Nueva liquidación de compra" });
    expect(
      within(dialog).getByText(/persona natural no obligada a llevar contabilidad/),
    ).toBeDefined();
    expect(calls.some((call) => call.key.startsWith("POST "))).toBe(false);
  });
});

describe("aviso de Pruebas al emitir (productize-invoice-editor-and-composition-foundation, D21)", () => {
  const companyStatus = (environment: "TEST" | "PRODUCTION" | "UNKNOWN"): Route =>
    environment === "UNKNOWN"
      ? () => ({ status: 503, body: errorBody("UNAVAILABLE", "x") })
      : ok({
          environment,
          displayName: "EMPRESA DE PRUEBA S.A.",
          readiness: { ready: true, checks: [] },
        });
  const notices = () => document.querySelectorAll("[data-slot=emission-environment-notice]");

  for (const [environment, expected] of [
    ["TEST", "Pruebas · esta liquidación de compra no tendrá validez tributaria."],
    ["PRODUCTION", null],
    ["UNKNOWN", /^No pudimos confirmar el ambiente/],
  ] as const) {
    it(`${environment}: junto a «Emitir» y en la confirmación, con texto e icono`, async () => {
      render(<PurchaseSettlementDraftScreen draftId="lcd-1" />, {
        "GET /api/v1/purchase-settlements/drafts/lcd-1": ok(settlementDraft()),
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
