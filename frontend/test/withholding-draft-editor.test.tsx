// Borrador de retención (add-withholding-receipts, tarea 12.2, design D24): el porcentaje y el valor
// retenido nunca son editables y son los del servidor; solo conceptos y códigos utilizables; los
// problemas junto a su documento y su retención bloquean la emisión; la parte relacionada empieza
// sin selección; el aviso y la confirmación de un período distinto del mes de emisión; el éxito lleva
// al detalle; el doble clic envía una sola emisión y el reintento repite la misma clave; los 409 se
// explican; el foco tras cada acción; y el proveedor elegido o registrado crea el borrador.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionGate } from "@/components/session";
import { useNewWithholding } from "@/features/withholding-receipts/new-withholding";
import { WithholdingDraftScreen } from "@/features/withholding-receipts/withholding-draft-editor";
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
  WITHHOLDING_OPTIONS,
  WITHHOLDING_PREVIEW,
  withholdingDetail,
  withholdingDraft,
} from "./withholding-fixtures";

const ok =
  (data: unknown): Route =>
  () => ({ status: 200, body: { data } });

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
    "GET /api/v1/withholding-receipts/options": ok(WITHHOLDING_OPTIONS),
    ...routes,
  });
  renderApp(<SessionGate fallback={<p>cargando</p>}>{ui}</SessionGate>);
  return calls;
}
const support = (position: number) =>
  screen.getByRole("listitem", { name: `Documento sustento ${position}` });
const findSupport = (position: number) =>
  screen.findByRole("listitem", { name: `Documento sustento ${position}` });
const item = (position: number, document = 1) =>
  screen.getByRole("listitem", { name: `Retención ${position} del documento ${document}` });
const openEmission = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole("button", { name: "Emitir retención" }));
  return screen.findByRole("dialog", { name: "Emitir retención" });
};

beforeEach(() => {
  navigation.pathname = "/retenciones/borradores/retd-1";
  navigation.search = new URLSearchParams();
  navigation.replace.mockReset();
  navigation.push.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("borrador de retención", () => {
  it("el porcentaje y el valor retenido son los del servidor y nunca se editan", async () => {
    render(<WithholdingDraftScreen draftId="retd-1" />, {
      "GET /api/v1/withholding-receipts/drafts/retd-1": ok(withholdingDraft()),
    });
    await findSupport(1);
    const income = item(1);
    expect(
      within(income).getByLabelText("Cálculo de la retención 1 del documento 1").textContent,
    ).toBe("1,75 % · valor retenido $1,75");
    expect(
      within(item(2)).getByLabelText("Cálculo de la retención 2 del documento 1").textContent,
    ).toBe("10 % · valor retenido $1,50");
    // Solo la base es un campo: ni el porcentaje ni el valor se escriben.
    expect(
      within(income)
        .getAllByRole("textbox")
        .map((box) => box.getAttribute("id")),
    ).toHaveLength(1);
    expect(within(income).getByRole("textbox", { name: "Base imponible" })).toHaveProperty(
      "value",
      "100.00",
    );
    expect(within(income).queryByRole("textbox", { name: /Porcentaje|Valor retenido/ })).toBeNull();
    const summary = screen.getByRole("complementary", { name: "Resumen" });
    expect(within(summary).getByText("$3,25")).toBeDefined();
    // Al editar, el cálculo anterior deja de mostrarse hasta guardar.
    const user = userEvent.setup();
    await user.clear(within(income).getByRole("textbox", { name: "Base imponible" }));
    await user.type(within(income).getByRole("textbox", { name: "Base imponible" }), "200.00");
    expect(within(income).queryByLabelText("Cálculo de la retención 1 del documento 1")).toBeNull();
    // El aviso de guardar va centrado debajo de «Guardar borrador» (decisión del propietario,
    // 2026-10-22); el de emitir, centrado debajo de «Emitir retención».
    const notice = screen.getByText("Guarda el borrador para ver el porcentaje y el valor.");
    expect(notice.className).toContain("text-center");
    const save = screen.getByRole("button", { name: "Guardar borrador" });
    expect(save.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const emitHint = screen.getByText("Guarda los cambios antes de emitir.");
    expect(emitHint.className).toContain("text-center");
    expect(emitHint.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("ofrece solo los conceptos de renta y los códigos de IVA utilizables, con la nota del código 7", async () => {
    render(<WithholdingDraftScreen draftId="retd-1" />, {
      "GET /api/v1/withholding-receipts/drafts/retd-1": ok(withholdingDraft()),
    });
    await findSupport(1);
    const iva = within(item(2)).getByRole("combobox", { name: "Código de retención del IVA" });
    expect(
      within(iva)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual([
      "Elige el código",
      "9 · RETENCIÓN DEL IVA 10%",
      "1 · RETENCIÓN DEL IVA 30%",
      "7 · Retención en cero 0.00%",
    ]);
    const user = userEvent.setup();
    await user.selectOptions(iva, "7");
    expect(within(item(2)).getByText(/NAC-DGERCGC15-00000284/)).toBeDefined();
    // El concepto de renta se elige en un combobox con búsqueda sobre los utilizables.
    await user.click(within(item(1)).getByRole("button", { name: /Concepto de renta/ }));
    const dialog = await screen.findByRole("dialog", { name: "Elegir el concepto de renta" });
    const options = await within(dialog).findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "303 · Honorarios profesionales y demás pagos por servicios relacionados con el título profesional · 10 %",
      "312 · Transferencia de bienes muebles de naturaleza corporal · 1,75 %",
    ]);
    await user.type(within(dialog).getByRole("combobox"), "honorarios");
    await waitFor(() => expect(within(dialog).getAllByRole("option")).toHaveLength(1));
    await user.click(within(dialog).getByRole("option"));
    expect(
      within(item(1)).getByRole("button", { name: /Concepto de renta/ }).textContent,
    ).toContain("303 · Honorarios");
  });

  it("los problemas aparecen junto a su documento y su retención y bloquean la emisión", async () => {
    render(<WithholdingDraftScreen draftId="retd-1" />, {
      "GET /api/v1/withholding-receipts/drafts/retd-1": ok(
        withholdingDraft({
          preview: {
            ...WITHHOLDING_PREVIEW,
            totals: null,
            supports: [
              { position: 1, withholdings: [WITHHOLDING_PREVIEW.supports[0]!.withholdings[0]] },
            ],
            issues: [
              {
                code: "WITHHOLDING_IVA_CODE_NOT_SUPPORTED",
                message:
                  "El código de retención del IVA 8 no se puede elegir: la fuente no define su representación en el comprobante.",
                support: 1,
                tax: null,
                payment: null,
                withholding: 2,
              },
              {
                code: "WITHHOLDING_SUPPORT_DATE_AFTER_ISSUE",
                message: "La fecha del documento sustento es posterior a la fecha de emisión.",
                support: 1,
                tax: null,
                payment: null,
                withholding: null,
              },
              {
                code: "WITHHOLDING_RELATED_PARTY_REQUIRED",
                message: "Indica si el proveedor es parte relacionada.",
                support: null,
                tax: null,
                payment: null,
                withholding: null,
              },
            ],
          },
        }),
      ),
    });
    const first = await findSupport(1);
    expect(first.getAttribute("aria-invalid")).toBe("true");
    expect(item(2).getAttribute("aria-invalid")).toBe("true");
    expect(
      within(item(2)).getByText(/El código de retención del IVA 8 no se puede elegir/),
    ).toBeDefined();
    expect(item(1).getAttribute("aria-invalid")).toBeNull();
    expect(within(first).getByText(/posterior a la fecha de emisión/)).toBeDefined();
    const summary = screen.getByRole("complementary", { name: "Resumen" });
    expect(within(summary).getByText("Indica si el proveedor es parte relacionada.")).toBeDefined();
    expect(within(summary).getByText("Sin calcular")).toBeDefined();
    expect(screen.getByRole("button", { name: "Emitir retención" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByText("Resuelve los problemas antes de emitir.")).toBeDefined();
  });

  it("un código de IVA guardado que no es utilizable se muestra como no disponible", async () => {
    const base = withholdingDraft();
    render(<WithholdingDraftScreen draftId="retd-1" />, {
      "GET /api/v1/withholding-receipts/drafts/retd-1": ok(
        withholdingDraft({
          supports: [
            {
              ...base.supports[0]!,
              withholdings: [{ tax: "2", entryKey: "8", base: "15.00" }],
            },
          ],
        }),
      ),
    });
    await findSupport(1);
    const iva = within(item(1)).getByRole("combobox", { name: "Código de retención del IVA" });
    expect(iva).toHaveProperty("value", "8");
    expect((iva as HTMLSelectElement).selectedOptions[0]!.textContent).toBe(
      "Código 8 (no disponible)",
    );
  });

  it("la parte relacionada empieza sin selección y se guarda declarada, con el foco en el resumen", async () => {
    let saved: Record<string, unknown> | undefined;
    render(<WithholdingDraftScreen draftId="retd-1" />, {
      "GET /api/v1/withholding-receipts/drafts/retd-1": ok(
        withholdingDraft({ relatedParty: null }),
      ),
      "PUT /api/v1/withholding-receipts/drafts/retd-1": (init) => {
        saved = JSON.parse(init.body as string) as Record<string, unknown>;
        return { status: 200, body: { data: withholdingDraft({ version: 2 }) } };
      },
    });
    await findSupport(1);
    const related = screen.getByRole("radiogroup", { name: "¿El proveedor es parte relacionada?" });
    expect(
      within(related)
        .getAllByRole("radio")
        .map((radio) => radio.getAttribute("aria-checked")),
    ).toEqual(["false", "false"]);
    const user = userEvent.setup();
    await user.click(within(related).getByRole("radio", { name: "Sí" }));
    await user.click(screen.getByRole("button", { name: "Guardar borrador" }));
    await waitFor(() => expect(saved).toBeDefined());
    expect(saved).toMatchObject({
      partyId: "prov-1",
      relatedParty: "SI",
      fiscalPeriod: "10/2026",
      emissionPointId: "ep-1",
      expectedVersion: 1,
      supports: [
        {
          documentType: "01",
          supportCode: "01",
          number: "001001000000123",
          issueDate: "2026-10-01",
          authorizationNumber: null,
          totalWithoutTaxes: "100.00",
          importTotal: "115.00",
          taxes: [{ tax: "2", rateEntryKey: "4", rate: null, base: "100.00", amount: "15.00" }],
          payments: [{ paymentMethod: "20", total: "115.00" }],
          withholdings: [
            { tax: "1", entryKey: "312", base: "100.00" },
            { tax: "2", entryKey: "9", base: "15.00" },
          ],
        },
      ],
    });
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Resumen" })),
    );
  });

  it("el número lleva su máscara, valida lo escrito y mueve el foco al agregar y quitar", async () => {
    let saved: Record<string, unknown> | undefined;
    render(<WithholdingDraftScreen draftId="retd-1" />, {
      "GET /api/v1/withholding-receipts/drafts/retd-1": ok(withholdingDraft()),
      "PUT /api/v1/withholding-receipts/drafts/retd-1": (init) => {
        saved = JSON.parse(init.body as string) as Record<string, unknown>;
        return { status: 200, body: { data: withholdingDraft({ version: 2 }) } };
      },
    });
    const first = await findSupport(1);
    expect(within(first).getByRole("textbox", { name: "Número" })).toHaveProperty(
      "value",
      "001-001-000000123",
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Agregar documento sustento" }));
    const second = support(2);
    expect(document.activeElement).toBe(
      within(second).getByRole("textbox", { name: "Autorización (opcional)" }),
    );
    await user.type(within(second).getByRole("textbox", { name: "Número" }), "0020051234");
    expect(within(second).getByRole("textbox", { name: "Número" })).toHaveProperty(
      "value",
      "002-005-1234",
    );
    await user.click(within(second).getByRole("button", { name: "Agregar retención" }));
    expect(document.activeElement).toBe(
      within(screen.getByRole("listitem", { name: "Retención 2 del documento 2" })).getByRole(
        "textbox",
        { name: "Base imponible" },
      ),
    );
    await user.click(screen.getByRole("button", { name: "Guardar borrador" }));
    expect(await within(second).findByText(/15 dígitos/)).toBeDefined();
    expect(saved).toBeUndefined();
    await user.click(screen.getByRole("button", { name: "Quitar el documento sustento 2" }));
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Agregar documento sustento" }),
    );
    await user.click(screen.getByRole("button", { name: "Guardar borrador" }));
    await waitFor(() => expect(saved).toBeDefined());
  });

  it("un período distinto del mes de emisión se avisa y se confirma al emitir", async () => {
    render(<WithholdingDraftScreen draftId="retd-1" />, {
      "GET /api/v1/withholding-receipts/drafts/retd-1": ok(
        withholdingDraft({
          fiscalPeriod: "09/2026",
          preview: { ...WITHHOLDING_PREVIEW, periodDiffersFromIssueMonth: true },
        }),
      ),
      "POST /api/v1/withholding-receipts": () => ({
        status: 201,
        body: { data: withholdingDetail("SIGNED") },
      }),
    });
    await findSupport(1);
    expect(
      screen.getByText(/El período \(Septiembre de 2026\) es distinto del mes de emisión/),
    ).toBeDefined();
    const user = userEvent.setup();
    const dialog = await openEmission(user);
    expect(within(dialog).getByText("Septiembre de 2026")).toBeDefined();
    const confirm = within(dialog).getByRole("button", { name: "Emitir retención" });
    expect(confirm).toHaveProperty("disabled", true);
    await user.click(
      within(dialog).getByRole("checkbox", {
        name: "Confirmo el período Septiembre de 2026, distinto del mes de emisión (Octubre de 2026).",
      }),
    );
    expect(confirm).toHaveProperty("disabled", false);
    await user.click(confirm);
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/retenciones/ret-1"));
  });

  it("emitir muestra el resumen, envía el borrador y su versión, y abre la retención", async () => {
    let body: unknown;
    render(<WithholdingDraftScreen draftId="retd-1" />, {
      "GET /api/v1/withholding-receipts/drafts/retd-1": ok(withholdingDraft()),
      "POST /api/v1/withholding-receipts": (init) => {
        body = JSON.parse(init.body as string);
        return { status: 201, body: { data: withholdingDetail("SIGNED") } };
      },
    });
    const user = userEvent.setup();
    const dialog = await openEmission(user);
    expect(within(dialog).getByText("PROVEEDORA DEL SUR S.A.")).toBeDefined();
    expect(within(dialog).getByText("Octubre de 2026")).toBeDefined();
    expect(within(dialog).getByText("001-001-000000123")).toBeDefined();
    expect(within(dialog).getByText("$3,25")).toBeDefined();
    expect(within(dialog).queryByRole("checkbox")).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Emitir retención" }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/retenciones/ret-1"));
    expect(body).toEqual({ draftId: "retd-1", expectedVersion: 1 });
    expect(await screen.findByText("Emitiste la retención 001-001-000000004.")).toBeDefined();
  });

  it("el doble clic envía una sola emisión y el reintento repite la misma clave", async () => {
    const keys: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    render(<WithholdingDraftScreen draftId="retd-1" />, {
      "GET /api/v1/withholding-receipts/drafts/retd-1": ok(withholdingDraft()),
      "POST /api/v1/withholding-receipts": (init) => {
        keys.push(new Headers(init.headers).get("Idempotency-Key") ?? "");
        return keys.length === 1
          ? { status: 503, body: errorBody("CRYPTO_UNAVAILABLE", "No disponible.") }
          : { status: 201, body: { data: withholdingDetail("SIGNED") } };
      },
    });
    const fetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        if (input === "/api/v1/withholding-receipts" && init?.method === "POST") await gate;
        return fetch(input, init);
      }),
    );
    const user = userEvent.setup();
    let dialog = await openEmission(user);
    await user.dblClick(within(dialog).getByRole("button", { name: "Emitir retención" }));
    release();
    // El primer intento falla: el aviso queda en el editor con el foco.
    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(document.activeElement).toBe(alert));
    expect(keys).toHaveLength(1);
    dialog = await openEmission(user);
    await user.click(within(dialog).getByRole("button", { name: "Emitir retención" }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/retenciones/ret-1"));
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^[!-~]{1,100}$/);
    expect(keys[1]).toBe(keys[0]);
  });

  it("un concepto que dejó de ser utilizable se explica con el foco y vuelve a pedir la vista previa", async () => {
    let draftReads = 0;
    render(<WithholdingDraftScreen draftId="retd-1" />, {
      "GET /api/v1/withholding-receipts/drafts/retd-1": () => {
        draftReads += 1;
        return { status: 200, body: { data: withholdingDraft() } };
      },
      "POST /api/v1/withholding-receipts": () => ({
        status: 409,
        body: errorBody("WITHHOLDING_ENTRY_NOT_USABLE", "No utilizable."),
      }),
    });
    const user = userEvent.setup();
    const dialog = await openEmission(user);
    await user.click(within(dialog).getByRole("button", { name: "Emitir retención" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "Un concepto o código ya no está vigente o habilitado. Elige otro con la vista previa actualizada.",
    );
    await waitFor(() => expect(document.activeElement).toBe(alert));
    await waitFor(() => expect(draftReads).toBeGreaterThanOrEqual(2));
  });

  it("un borrador cambiado por otra persona se explica y se recarga; uno emitido enlaza a la lista", async () => {
    let version = 1;
    render(<WithholdingDraftScreen draftId="retd-1" />, {
      "GET /api/v1/withholding-receipts/drafts/retd-1": () => ({
        status: 200,
        body: { data: withholdingDraft({ version }) },
      }),
      "POST /api/v1/withholding-receipts": () => {
        version = 2;
        return {
          status: 409,
          body: errorBody("WITHHOLDING_DRAFT_CHANGED", "El borrador cambió."),
        };
      },
    });
    const user = userEvent.setup();
    const dialog = await openEmission(user);
    await user.click(within(dialog).getByRole("button", { name: "Emitir retención" }));
    expect(
      await screen.findByText(
        "Alguien cambió este borrador mientras lo revisabas. Recárgalo para ver la versión vigente.",
      ),
    ).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Recargar borrador" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("un borrador ya emitido lo explica con el enlace a las retenciones", async () => {
    render(<WithholdingDraftScreen draftId="retd-1" />, {
      "GET /api/v1/withholding-receipts/drafts/retd-1": () => ({
        status: 409,
        body: errorBody("WITHHOLDING_DRAFT_ALREADY_EMITTED", "x"),
      }),
    });
    expect(await screen.findByText("Este borrador ya se emitió")).toBeDefined();
    expect(screen.getByRole("link", { name: "Ver retenciones" }).getAttribute("href")).toBe(
      "/retenciones",
    );
  });
});

/** El tipo RUC del catálogo de identificación, para el alta del proveedor. */
const RUC_VERSION = {
  id: "id-04",
  officialLabel: "RUC",
  effectiveFrom: "2026-07-27",
  effectiveFromBasis: "PROJECT_BASELINE",
  effectiveTo: null,
  normativeStatus: "OFFICIAL",
  sourceRef: "Tabla 6",
  datasetVersion: 1,
  rate: null,
  taxKind: null,
  identificationRule: {
    pattern: null,
    description: "13 dígitos terminados en 001",
    reservedFor: null,
  },
  withholding: null,
};

/** «Nueva retención» como la ofrece la lista: el botón y el selector sobre ella. */
function NewWithholding() {
  const creation = useNewWithholding(true);
  return (
    <>
      <button type="button" onClick={creation.start}>
        Nueva retención
      </button>
      {creation.element}
    </>
  );
}

describe("nueva retención sobre la lista (decisión del propietario, 2026-10-22)", () => {
  const SUPPLIERS: Route = () => ({
    status: 200,
    body: {
      data: [
        {
          id: "prov-1",
          identificationType: "04",
          identification: "1791234567001",
          legalName: "PROVEEDORA DEL SUR S.A.",
        },
      ],
      meta: { page: 1, pageSize: 10, total: 1 },
    },
  });

  it("con `?nueva` el selector se abre sobre la lista; cerrarlo sin elegir quita el parámetro", async () => {
    navigation.pathname = "/retenciones";
    navigation.search = new URLSearchParams("nueva=1");
    render(<NewWithholding />, {
      "GET /api/v1/withholding-receipts/suppliers": SUPPLIERS,
    });
    await screen.findByRole("dialog", { name: "Elegir proveedor" });
    await userEvent.setup().keyboard("{Escape}");
    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith("/retenciones", { scroll: false }),
    );
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it("elegir el proveedor crea el borrador y abre su ruta", async () => {
    let created: unknown;
    navigation.pathname = "/retenciones";
    render(<NewWithholding />, {
      "GET /api/v1/withholding-receipts/suppliers": SUPPLIERS,
      "POST /api/v1/withholding-receipts/drafts": (init) => {
        created = JSON.parse(init.body as string);
        return { status: 201, body: { data: withholdingDraft({ id: "retd-9" }) } };
      },
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Nueva retención" }));
    const dialog = await screen.findByRole("dialog", { name: "Elegir proveedor" });
    await user.click(await within(dialog).findByText("PROVEEDORA DEL SUR S.A."));
    await waitFor(() =>
      expect(navigation.push).toHaveBeenCalledWith("/retenciones/borradores/retd-9"),
    );
    // Elegir o registrar el proveedor cierra el selector sin tocar la lista.
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(created).toEqual({ partyId: "prov-1" });
  });

  it("Nuevo proveedor registra el tercero con el rol de proveedor y lo elige", async () => {
    let party: unknown;
    let created: unknown;
    navigation.pathname = "/retenciones";
    render(<NewWithholding />, {
      "GET /api/v1/withholding-receipts/suppliers": SUPPLIERS,
      "GET /api/v1/fiscal-catalogs/identification-type/entries": ok({
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
        at: "2026-10-06",
        entries: [
          {
            entryKey: "04",
            code: "04",
            versions: [RUC_VERSION],
            applicable: RUC_VERSION,
            enablement: { enabled: true, source: "NOT_ENABLEABLE" },
            usable: true,
          },
        ],
      }),
      "POST /api/v1/parties": (init) => {
        party = JSON.parse(init.body as string);
        return {
          status: 201,
          body: {
            data: {
              id: "prov-2",
              identificationType: "04",
              identificationTypeLabel: "RUC",
              identification: "1792345678001",
              legalName: "SERVICIOS ANDINOS S.A.",
              address: null,
              email: null,
              phone: null,
              roles: ["SUPPLIER"],
              status: "ACTIVE",
              systemRecord: null,
              version: 1,
              createdAt: "2026-10-06T15:00:00.000Z",
              updatedAt: "2026-10-06T15:00:00.000Z",
            },
          },
        };
      },
      "POST /api/v1/withholding-receipts/drafts": (init) => {
        created = JSON.parse(init.body as string);
        return { status: 201, body: { data: withholdingDraft({ id: "retd-9" }) } };
      },
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Nueva retención" }));
    const picker = await screen.findByRole("dialog", { name: "Elegir proveedor" });
    await user.click(await within(picker).findByText("Nuevo proveedor"));
    const form = await screen.findByRole("dialog", { name: "Tercero Nuevo" });
    expect(
      within(form).getByRole("button", { name: "Proveedor" }).getAttribute("aria-pressed"),
    ).toBe("true");
    await user.type(within(form).getByLabelText("Identificación"), "1792345678001");
    await user.type(
      within(form).getByLabelText("Razón social o nombres"),
      "SERVICIOS ANDINOS S.A.",
    );
    await user.click(within(form).getByRole("button", { name: "Registrar tercero" }));
    await waitFor(() =>
      expect(navigation.push).toHaveBeenCalledWith("/retenciones/borradores/retd-9"),
    );
    // Elegir o registrar el proveedor cierra el selector sin tocar la lista.
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(party).toMatchObject({ roles: ["SUPPLIER"], identification: "1792345678001" });
    expect(created).toEqual({ partyId: "prov-2" });
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
    ["TEST", "Pruebas · esta retención no tendrá validez tributaria."],
    ["PRODUCTION", null],
    ["UNKNOWN", /^No pudimos confirmar el ambiente/],
  ] as const) {
    it(`${environment}: junto a «Emitir» y en la confirmación, con texto e icono`, async () => {
      render(<WithholdingDraftScreen draftId="retd-1" />, {
        "GET /api/v1/withholding-receipts/drafts/retd-1": ok(withholdingDraft()),
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

describe("pedidos del propietario sobre la retención (2026-10-22)", () => {
  it("títulos más discretos, el documento con su número en la franja y Factura por defecto", async () => {
    render(<WithholdingDraftScreen draftId="retd-1" />, {
      "GET /api/v1/withholding-receipts/drafts/retd-1": ok(withholdingDraft()),
    });
    const first = await findSupport(1);
    expect(screen.getByRole("heading", { level: 2, name: "Proveedor" }).className).toContain(
      "text-sm",
    );
    for (const name of [
      "Establecimiento y punto de emisión",
      "Parte relacionada",
      "Período fiscal",
    ]) {
      expect(screen.getByRole("heading", { level: 2, name }).className, name).toContain("sr-only");
    }
    expect(screen.getByRole("button", { name: "Ayuda: Documentos sustento" })).toBeDefined();
    // El documento, 10 % y 90 %, con «Documento sustento 1» en su franja.
    expect(first.className).toContain("sm:grid-cols-[minmax(0,10fr)_minmax(0,90fr)]");
    const number = first.querySelector("[data-slot=item-number]") as HTMLElement;
    expect(within(number).getByRole("heading", { level: 3 }).textContent).toBe(
      "Documento sustento 1",
    );
    for (const name of ["Formas de pago", "Retenciones"]) {
      expect(within(first).getByRole("heading", { level: 4, name }).className, name).toContain(
        "sr-only",
      );
    }
    // Un documento nuevo empieza como factura.
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Agregar documento sustento" }));
    const type = within(support(2)).getByRole("radiogroup", { name: "Tipo de documento" });
    expect(within(type).getByRole("radio", { name: "Factura" }).getAttribute("aria-checked")).toBe(
      "true",
    );
  });

  it("el proveedor es una ficha con «Cambiar proveedor» en azul, y el punto va antes de la parte relacionada", async () => {
    render(<WithholdingDraftScreen draftId="retd-1" />, {
      "GET /api/v1/withholding-receipts/drafts/retd-1": ok(withholdingDraft()),
    });
    const change = await screen.findByRole("button", { name: "Cambiar proveedor" });
    expect(change.getAttribute("data-variant")).toBe("primary");
    // El título con su estado va dentro del formulario, encima de sus campos.
    expect(screen.getByRole("heading", { level: 1 }).closest("form")).not.toBeNull();
    expect(
      screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent),
    ).toEqual([
      "Proveedor",
      "Establecimiento y punto de emisión",
      "Parte relacionada",
      "Período fiscal",
      "Documentos sustento",
      "Resumen",
    ]);
    // Con un solo punto en la empresa, el establecimiento y el punto se muestran como datos.
    expect(await screen.findByText("001-001")).toBeDefined();
    expect(
      screen.getByRole("radiogroup", { name: "¿El proveedor es parte relacionada?" }).className,
    ).toContain("w-full");
    for (const name of [
      "Agregar impuesto",
      "Agregar forma de pago",
      "Agregar retención",
      "Agregar documento sustento",
    ]) {
      const button = screen.getAllByRole("button", { name })[0]!;
      expect(button.className, name).toContain("w-full");
      expect(button.className, name).toContain("border-dashed");
    }
  });

  it("un documento nuevo empieza con IVA en el impuesto y Renta en la retención, a todo el ancho", async () => {
    render(<WithholdingDraftScreen draftId="retd-1" />, {
      "GET /api/v1/withholding-receipts/drafts/retd-1": ok(withholdingDraft()),
    });
    await findSupport(1);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Agregar documento sustento" }));
    const fresh = support(2);
    const chosen = (group: HTMLElement) =>
      within(group)
        .getAllByRole("radio")
        .filter((radio) => radio.getAttribute("aria-checked") === "true")
        .map((radio) => radio.textContent);
    const tax = within(fresh).getByRole("radiogroup", { name: "Impuesto" });
    expect(chosen(tax)).toEqual(["IVA"]);
    expect(tax.className).toContain("w-full");
    const withheld = within(fresh).getByRole("radiogroup", { name: "Impuesto a retener" });
    expect(chosen(withheld)).toEqual(["Renta"]);
    expect(withheld.className).toContain("w-full");
    expect(
      within(fresh).getByRole("radiogroup", { name: "Tipo de documento" }).className,
    ).toContain("w-full");
    // El concepto de renta y la base, en la misma fila.
    const item = within(fresh).getByRole("listitem", { name: "Retención 1 del documento 2" });
    const row = within(item).getByRole("textbox", { name: "Base imponible" }).closest(".grid");
    expect(row?.className).toContain("sm:grid-cols-2");
    expect(within(row as HTMLElement).getByText("Concepto de renta")).toBeDefined();
  });

  it("quitar un documento, un impuesto, un pago o una retención va en rojo", async () => {
    render(<WithholdingDraftScreen draftId="retd-1" />, {
      "GET /api/v1/withholding-receipts/drafts/retd-1": ok(withholdingDraft()),
    });
    await findSupport(1);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Agregar impuesto" }));
    const remove = screen.getByRole("button", { name: "Quitar el impuesto 1 del documento 1" });
    expect(remove.className).toContain("text-danger");
    expect(
      screen.getByRole("button", { name: "Quitar la retención 1 del documento 1" }).className,
    ).toContain("text-danger");
  });
});
