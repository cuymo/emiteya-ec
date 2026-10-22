// Borrador de guía de remisión (add-shipping-guides, tarea 12.2, design D25): solo transportistas con
// el rol, los no seleccionables deshabilitados con su motivo y ningún rol asignado sin la acción
// explícita; los campos derivados de solo lectura y nunca enviados; el destino distinto del origen y
// el emisor libre de ser origen, destino u otro; la carga de mercancías que nunca agrega sola una
// línea libre; los problemas junto a su destinatario y su detalle, con la emisión bloqueada; la
// casilla de la declaración exigida solo con excepciones; los límites como defensa del sistema; el
// éxito que lleva al detalle; el doble clic que envía una sola emisión con la misma clave en el
// reintento; los 409 explicados y el foco tras cada acción.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionGate } from "@/components/session";
import { useNewShippingGuide } from "@/features/shipping-guides/new-shipping-guide";
import { ShippingGuideDraftScreen } from "@/features/shipping-guides/shipping-guide-draft-editor";
import {
  ADMIN_ME,
  OPERATOR_ME,
  errorBody,
  mockApi,
  navigation,
  renderApp,
  type Route,
} from "./harness";
import { SHIPPING_OPTIONS, guideDetail, guideDraft } from "./shipping-guide-fixtures";

const ok =
  (data: unknown): Route =>
  () => ({ status: 200, body: { data } });
const page =
  (data: unknown[]): Route =>
  () => ({ status: 200, body: { data, meta: { page: 1, pageSize: 10, total: data.length } } });

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
      {
        id: "est-2",
        code: "002",
        address: "Bodega sur, Quito",
        status: "ACTIVE",
        emissionPoints: [],
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
    "GET /api/v1/shipping-guides/options": ok(SHIPPING_OPTIONS),
    ...routes,
  });
  renderApp(<SessionGate fallback={<p>cargando</p>}>{ui}</SessionGate>);
  return calls;
}
const recipientCard = (position: number) =>
  screen.getByRole("listitem", { name: `Destinatario ${position}` });
const findRecipient = (position: number) =>
  screen.findByRole("listitem", { name: `Destinatario ${position}` });
const detailRow = (position: number, recipient = 1) =>
  screen.getByRole("listitem", { name: `Detalle ${position} del destinatario ${recipient}` });
const openEmission = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole("button", { name: "Emitir guía de remisión" }));
  return screen.findByRole("dialog", { name: "Emitir guía de remisión" });
};
const saveAndCapture = async (
  user: ReturnType<typeof userEvent.setup>,
  saved: () => Record<string, unknown> | undefined,
) => {
  await user.click(screen.getByRole("button", { name: "Guardar borrador" }));
  await waitFor(() => expect(saved()).toBeDefined());
  return saved()!;
};

/** El catálogo de tipos de identificación con el RUC, para el alta de un tercero. */
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
};

const CONSIGNMENT_DRAFT = () => {
  const base = guideDraft();
  return guideDraft({
    recipients: [
      {
        ...base.recipients[0]!,
        support: { kind: "DECLARED_EXCEPTION", case: "CONSIGNMENT" },
      },
    ],
    preview: {
      ...base.preview,
      recipients: [
        {
          ...base.preview.recipients[0]!,
          support: { kind: "DECLARED_EXCEPTION", case: "CONSIGNMENT", label: "Consignación" },
        },
      ],
      exceptionDeclarationRequired: true,
    },
  });
};

beforeEach(() => {
  navigation.pathname = "/guias-remision/borradores/grd-1";
  navigation.search = new URLSearchParams();
  navigation.replace.mockReset();
  navigation.push.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("borrador de guía de remisión", () => {
  it("solo ofrece transportistas con el rol, deshabilita los que no caben con su motivo y no asigna roles", async () => {
    let saved: Record<string, unknown> | undefined;
    render(<ShippingGuideDraftScreen draftId="grd-1" />, {
      "GET /api/v1/shipping-guides/drafts/grd-1": ok(guideDraft({ transporter: null })),
      "GET /api/v1/shipping-guides/carriers": page([
        {
          id: "car-1",
          identificationType: "04",
          identification: "1791111111001",
          legalName: "TRANSPORTES ANDINOS S.A.",
          selectable: true,
          reason: null,
        },
        {
          id: "car-2",
          identificationType: "06",
          identification: "PAS12345678901",
          legalName: "TRANSPORTISTA EXTRANJERO",
          selectable: false,
          reason: "Su identificación tiene 14 caracteres y la guía admite como máximo 13.",
        },
      ]),
      "PUT /api/v1/shipping-guides/drafts/grd-1": (init) => {
        saved = JSON.parse(init.body as string) as Record<string, unknown>;
        return {
          status: 200,
          body: {
            data: guideDraft({
              version: 3,
              transporter: {
                source: "PARTY",
                partyId: "car-1",
                party: {
                  id: "car-1",
                  identificationType: "04",
                  identification: "1791111111001",
                  legalName: "TRANSPORTES ANDINOS S.A.",
                  selectable: true,
                  reason: null,
                },
              },
            }),
          },
        };
      },
      "GET /api/v1/fiscal-catalogs/identification-type/entries": ok(IDENTIFICATION_TYPES),
    });
    await findRecipient(1);
    const user = userEvent.setup();
    const source = screen.getByRole("radiogroup", { name: "¿Quién transporta?" });
    expect(
      within(source)
        .getAllByRole("radio")
        .map((radio) => radio.getAttribute("aria-checked")),
    ).toEqual(["false", "false"]);
    await user.click(within(source).getByRole("radio", { name: "Tercero" }));
    await user.click(screen.getByRole("button", { name: "Elegir transportista" }));
    const picker = await screen.findByRole("dialog", { name: "Elegir transportista" });
    const foreign = await within(picker).findByRole("option", {
      name: "TRANSPORTISTA EXTRANJERO, PAS12345678901, no se puede elegir",
    });
    expect(foreign.getAttribute("aria-disabled")).toBe("true");
    expect(within(picker).getByText(/admite como máximo 13/)).toBeDefined();
    // Uno no seleccionable no se elige: el diálogo sigue abierto.
    await user.click(foreign);
    expect(screen.getByRole("dialog", { name: "Elegir transportista" })).toBeDefined();
    await user.click(within(picker).getByText("TRANSPORTES ANDINOS S.A."));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Elegir transportista" })).toBeNull(),
    );
    expect(screen.getByText("TRANSPORTES ANDINOS S.A.")).toBeDefined();
    const body = await saveAndCapture(user, () => saved);
    expect(body.transporter).toEqual({ source: "PARTY", partyId: "car-1" });
    // "Nuevo transportista" abre el alta con el rol marcado y visible: nunca en silencio.
    await user.click(screen.getByRole("button", { name: "Cambiar transportista" }));
    const again = await screen.findByRole("dialog", { name: "Elegir transportista" });
    await user.click(await within(again).findByText("Nuevo transportista"));
    const form = await screen.findByRole("dialog", { name: "Nuevo tercero" });
    expect(
      within(form).getByRole("button", { name: "Transportista" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("los derivados son de solo lectura y no se envían; el destino excluye el origen y el emisor puede ser cualquiera", async () => {
    let saved: Record<string, unknown> | undefined;
    render(<ShippingGuideDraftScreen draftId="grd-1" />, {
      "GET /api/v1/shipping-guides/drafts/grd-1": ok(guideDraft()),
      "PUT /api/v1/shipping-guides/drafts/grd-1": (init) => {
        saved = JSON.parse(init.body as string) as Record<string, unknown>;
        return { status: 200, body: { data: guideDraft({ version: 3 }) } };
      },
    });
    await findRecipient(1);
    const user = userEvent.setup();
    // El establecimiento propio de destino pide primero el origen.
    const card = recipientCard(1);
    await user.click(
      within(within(card).getByRole("radiogroup", { name: "Destinatario" })).getByRole("radio", {
        name: "Establecimiento propio",
      }),
    );
    const destination = within(card).getByLabelText("Establecimiento de destino");
    expect(destination).toHaveProperty("disabled", true);
    expect(
      within(card).getByText("Elige primero el establecimiento de origen en la partida."),
    ).toBeDefined();
    // El origen no tiene valor por defecto; elegido, la partida es su dirección, de solo lectura.
    await user.click(
      within(screen.getByRole("radiogroup", { name: "Punto de partida" })).getByRole("radio", {
        name: "Establecimiento propio",
      }),
    );
    const origin = screen.getByLabelText("Establecimiento de origen") as HTMLSelectElement;
    expect(origin.value).toBe("");
    await user.selectOptions(origin, "est-2");
    expect(screen.queryByRole("textbox", { name: "Dirección de partida" })).toBeNull();
    expect(screen.getAllByText("Bodega sur, Quito").length).toBeGreaterThan(0);
    // El destino excluye el origen; el del punto de emisión (001) se puede elegir.
    expect(destination).toHaveProperty("disabled", false);
    expect([...(destination as HTMLSelectElement).options].map((option) => option.value)).toEqual([
      "",
      "est-1",
    ]);
    await user.selectOptions(destination, "est-1");
    expect(
      within(card).queryByRole("textbox", { name: "Dirección de destino (punto de llegada)" }),
    ).toBeNull();
    expect(within(card).getByText("Av. 6 de Diciembre, Quito")).toBeDefined();
    expect(
      within(card).getByText(/Traslado entre establecimientos de un mismo contribuyente/),
    ).toBeDefined();
    // Con producto, los códigos son del producto: sin campos para escribirlos.
    expect(within(detailRow(1)).queryByRole("textbox", { name: /Código principal/ })).toBeNull();
    const body = await saveAndCapture(user, () => saved);
    expect(body).toMatchObject({
      emissionPointId: "pto-1",
      originEstablishmentId: "est-2",
      departureAddress: null,
      transporter: { source: "SELF" },
      expectedVersion: 2,
      recipients: [
        {
          recipient: { kind: "OWN_COMPANY", destinationEstablishmentId: "est-1" },
          address: null,
          destinationEstablishmentCode: null,
          support: { kind: "DECLARED_EXCEPTION", case: "OWN_ESTABLISHMENT_TRANSFER" },
          details: [
            {
              productId: "prod-1",
              mainCode: null,
              auxiliaryCode: null,
              description: "Cemento 50 kg en sacos",
              quantity: "10",
            },
          ],
        },
      ],
    });
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Resumen" })),
    );
  });

  it("la carga de mercancías es una sugerencia: nunca agrega sola una línea libre", async () => {
    render(<ShippingGuideDraftScreen draftId="grd-1" />, {
      "GET /api/v1/shipping-guides/drafts/grd-1": ok(guideDraft()),
      "GET /api/v1/shipping-guides/eligible-invoices/inv-1/goods": ok({
        invoiceId: "inv-1",
        documentNumber: "001-001-000000123",
        lines: [
          {
            position: 1,
            suggestion: "PRODUCT",
            productId: "prod-1",
            mainCode: "CEM-50",
            auxiliaryCode: null,
            description: "Cemento 50 kg",
            quantity: "10",
          },
          {
            position: 2,
            suggestion: "FREE_LINE",
            productId: null,
            mainCode: "SRV-1",
            auxiliaryCode: null,
            description: "Instalación en obra",
            quantity: "1",
          },
        ],
      }),
    });
    await findRecipient(1);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Cargar mercancías de la factura" }));
    let dialog = await screen.findByRole("dialog", { name: "Cargar mercancías de la factura" });
    expect(within(dialog).getByText(/Es una sugerencia/)).toBeDefined();
    const product = await within(dialog).findByRole("checkbox", { name: /Cemento 50 kg/ });
    const free = within(dialog).getByRole("checkbox", {
      name: /Agregar como línea libre: Instalación en obra/,
    });
    expect([product, free].map((box) => (box as HTMLInputElement).checked)).toEqual([true, false]);
    expect(dialog.textContent).not.toMatch(/servicio|no trasladable/i);
    await user.click(within(dialog).getByRole("button", { name: "Agregar 1 mercancía" }));
    expect(
      within(detailRow(2)).getByRole("textbox", {
        name: "Descripción (incluye unidad y características)",
      }),
    ).toHaveProperty("value", "Cemento 50 kg");
    expect(screen.queryByRole("listitem", { name: "Detalle 3 del destinatario 1" })).toBeNull();
    // La línea libre se agrega solo si el usuario la marca, con sus datos editables.
    await user.click(screen.getByRole("button", { name: "Cargar mercancías de la factura" }));
    dialog = await screen.findByRole("dialog", { name: "Cargar mercancías de la factura" });
    await user.click(await within(dialog).findByRole("checkbox", { name: /Cemento 50 kg/ }));
    await user.click(within(dialog).getByRole("checkbox", { name: /Instalación en obra/ }));
    await user.click(within(dialog).getByRole("button", { name: "Agregar 1 mercancía" }));
    const added = detailRow(3);
    expect(
      within(within(added).getByRole("radiogroup", { name: "Detalle 3" }))
        .getByRole("radio", { name: "Línea libre" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      within(added).getByRole("textbox", { name: "Código principal (opcional)" }),
    ).toHaveProperty("value", "SRV-1");
    expect(
      within(added).getByRole("textbox", {
        name: "Descripción (incluye unidad y características)",
      }),
    ).toHaveProperty("value", "Instalación en obra");
    expect(within(added).getByRole("textbox", { name: "Cantidad" })).toHaveProperty("value", "1");
  });

  it("los problemas aparecen junto a su destinatario y su detalle, y bloquean la emisión", async () => {
    const base = guideDraft();
    render(<ShippingGuideDraftScreen draftId="grd-1" />, {
      "GET /api/v1/shipping-guides/drafts/grd-1": ok(
        guideDraft({
          preview: {
            ...base.preview,
            issues: [
              {
                code: "SHIPPING_GUIDE_CARRIER_REQUIRED",
                message: "Elige el transportista.",
                field: "transporter",
                recipient: null,
                detail: null,
              },
              {
                code: "SHIPPING_GUIDE_MOTIVE_REQUIRED",
                message: "Escribe el motivo del traslado del destinatario 1.",
                field: null,
                recipient: 1,
                detail: null,
              },
              {
                code: "SHIPPING_GUIDE_QUANTITY_INVALID",
                message: "La cantidad del detalle 1 debe ser mayor que cero.",
                field: null,
                recipient: 1,
                detail: 1,
              },
            ],
          },
        }),
      ),
    });
    await findRecipient(1);
    expect(
      within(detailRow(1)).getByText("La cantidad del detalle 1 debe ser mayor que cero."),
    ).toBeDefined();
    expect(
      within(recipientCard(1)).getByText("Escribe el motivo del traslado del destinatario 1."),
    ).toBeDefined();
    const summary = screen.getByRole("complementary", { name: "Resumen" });
    expect(within(summary).getByText("Elige el transportista.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Emitir guía de remisión" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByText("Resuelve los problemas antes de emitir.")).toBeDefined();
  });

  it("elegir el punto propone la partida con la dirección de su establecimiento, sin reemplazar una escrita", async () => {
    render(<ShippingGuideDraftScreen draftId="grd-1" />, {
      "GET /api/v1/shipping-guides/drafts/grd-1": ok(
        guideDraft({ emissionPoint: null, departureAddress: null }),
      ),
      "GET /api/v1/me/default-emission-point": () => ({
        status: 404,
        body: errorBody("DEFAULT_EMISSION_POINT_NOT_FOUND", "x"),
      }),
    });
    await findRecipient(1);
    const user = userEvent.setup();
    const departure = screen.getByRole("textbox", { name: "Dirección de partida" });
    expect(departure).toHaveProperty("value", "");
    await screen.findByRole("option", { name: /^001-001 · / });
    await user.selectOptions(screen.getByRole("combobox", { name: "Punto de emisión" }), "pto-1");
    expect(departure).toHaveProperty("value", "Av. 6 de Diciembre, Quito");
    await user.clear(departure);
    await user.type(departure, "Bodega norte");
    await user.selectOptions(screen.getByRole("combobox", { name: "Punto de emisión" }), "");
    await user.selectOptions(screen.getByRole("combobox", { name: "Punto de emisión" }), "pto-1");
    expect(departure).toHaveProperty("value", "Bodega norte");
  });

  it("presenta los límites como defensa del sistema", async () => {
    render(<ShippingGuideDraftScreen draftId="grd-1" />, {
      "GET /api/v1/shipping-guides/drafts/grd-1": ok(guideDraft()),
      "GET /api/v1/shipping-guides/options": ok({
        ...SHIPPING_OPTIONS,
        limits: { recipients: 1, detailsPerRecipient: 1, details: 1 },
      }),
    });
    await findRecipient(1);
    expect(screen.getByRole("button", { name: "Agregar destinatario" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(
      screen.getByText(
        "Llegaste al máximo de 1 destinatarios por guía, un límite del sistema (no del SRI).",
      ),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Agregar detalle" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByText(/1 detalles por destinatario, un límite del sistema/)).toBeDefined();
  });

  it("sin excepciones emite sin declaración y abre la guía", async () => {
    let body: unknown;
    render(<ShippingGuideDraftScreen draftId="grd-1" />, {
      "GET /api/v1/shipping-guides/drafts/grd-1": ok(guideDraft()),
      "POST /api/v1/shipping-guides": (init) => {
        body = JSON.parse(init.body as string);
        return { status: 201, body: { data: guideDetail("SIGNED") } };
      },
    });
    const user = userEvent.setup();
    const dialog = await openEmission(user);
    expect(within(dialog).getByText("EMPRESA DE PRUEBA S.A.")).toBeDefined();
    expect(within(dialog).getByText("PAA-1234")).toBeDefined();
    expect(
      within(dialog).getByText(/EL PERNO CIA. LTDA. · Factura 001-001-000000123/),
    ).toBeDefined();
    expect(within(dialog).queryByRole("checkbox")).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Emitir guía de remisión" }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/guias-remision/gr-1"));
    expect(body).toEqual({ draftId: "grd-1", expectedVersion: 2, exceptionDeclaration: null });
    expect(await screen.findByText("Emitiste la guía 001-001-000000005.")).toBeDefined();
  });

  it("con una excepción exige la casilla de la declaración y la envía con su versión", async () => {
    let body: unknown;
    render(<ShippingGuideDraftScreen draftId="grd-1" />, {
      "GET /api/v1/shipping-guides/drafts/grd-1": ok(CONSIGNMENT_DRAFT()),
      "POST /api/v1/shipping-guides": (init) => {
        body = JSON.parse(init.body as string);
        return { status: 201, body: { data: guideDetail("SIGNED") } };
      },
    });
    const user = userEvent.setup();
    const dialog = await openEmission(user);
    expect(within(dialog).getByText(/Destinatario 1: Consignación \(literal c\)/)).toBeDefined();
    const confirm = within(dialog).getByRole("button", { name: "Emitir guía de remisión" });
    expect(confirm).toHaveProperty("disabled", true);
    await user.click(
      within(dialog).getByRole("checkbox", {
        name: /Declaro que los traslados sin factura corresponden a los casos indicados/,
      }),
    );
    expect(confirm).toHaveProperty("disabled", false);
    await user.click(confirm);
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/guias-remision/gr-1"));
    expect(body).toEqual({
      draftId: "grd-1",
      expectedVersion: 2,
      exceptionDeclaration: { policyVersion: 1 },
    });
  });

  it("el doble clic envía una sola emisión y el reintento repite la misma clave", async () => {
    const keys: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    render(<ShippingGuideDraftScreen draftId="grd-1" />, {
      "GET /api/v1/shipping-guides/drafts/grd-1": ok(guideDraft()),
      "POST /api/v1/shipping-guides": (init) => {
        keys.push(new Headers(init.headers).get("Idempotency-Key") ?? "");
        return keys.length === 1
          ? { status: 503, body: errorBody("CRYPTO_UNAVAILABLE", "No disponible.") }
          : { status: 201, body: { data: guideDetail("SIGNED") } };
      },
    });
    const fetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        if (input === "/api/v1/shipping-guides" && init?.method === "POST") await gate;
        return fetch(input, init);
      }),
    );
    const user = userEvent.setup();
    let dialog = await openEmission(user);
    await user.dblClick(within(dialog).getByRole("button", { name: "Emitir guía de remisión" }));
    release();
    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(document.activeElement).toBe(alert));
    expect(keys).toHaveLength(1);
    dialog = await openEmission(user);
    await user.click(within(dialog).getByRole("button", { name: "Emitir guía de remisión" }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/guias-remision/gr-1"));
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^[!-~]{1,100}$/);
    expect(keys[1]).toBe(keys[0]);
  });

  it("un rechazo de la emisión se explica con el foco y vuelve a pedir la vista previa", async () => {
    let draftReads = 0;
    render(<ShippingGuideDraftScreen draftId="grd-1" />, {
      "GET /api/v1/shipping-guides/drafts/grd-1": () => {
        draftReads += 1;
        return { status: 200, body: { data: guideDraft() } };
      },
      "POST /api/v1/shipping-guides": () => ({
        status: 409,
        body: errorBody("SHIPPING_GUIDE_START_BEFORE_ISSUE", "x"),
      }),
    });
    const user = userEvent.setup();
    const dialog = await openEmission(user);
    await user.click(within(dialog).getByRole("button", { name: "Emitir guía de remisión" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "La fecha de inicio del transporte es anterior a la de emisión, que es la de hoy. Corrige la fecha de inicio.",
    );
    await waitFor(() => expect(document.activeElement).toBe(alert));
    await waitFor(() => expect(draftReads).toBeGreaterThanOrEqual(2));
  });

  it("un borrador cambiado por otra persona se explica y se recarga", async () => {
    let version = 2;
    render(<ShippingGuideDraftScreen draftId="grd-1" />, {
      "GET /api/v1/shipping-guides/drafts/grd-1": () => ({
        status: 200,
        body: { data: guideDraft({ version }) },
      }),
      "POST /api/v1/shipping-guides": () => {
        version = 3;
        return {
          status: 409,
          body: errorBody("SHIPPING_GUIDE_DRAFT_CHANGED", "El borrador cambió."),
        };
      },
    });
    const user = userEvent.setup();
    const dialog = await openEmission(user);
    await user.click(within(dialog).getByRole("button", { name: "Emitir guía de remisión" }));
    expect(
      await screen.findByText(
        "Alguien cambió este borrador mientras lo revisabas. Recárgalo para ver la versión vigente.",
      ),
    ).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Recargar borrador" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("un borrador ya emitido lo explica con el enlace a las guías", async () => {
    render(<ShippingGuideDraftScreen draftId="grd-1" />, {
      "GET /api/v1/shipping-guides/drafts/grd-1": () => ({
        status: 409,
        body: errorBody("SHIPPING_GUIDE_DRAFT_ALREADY_EMITTED", "x"),
      }),
    });
    expect(await screen.findByText("Este borrador ya se emitió")).toBeDefined();
    expect(screen.getByRole("link", { name: "Ver guías de remisión" }).getAttribute("href")).toBe(
      "/guias-remision",
    );
  });
});

/** «Nueva guía de remisión» como la ofrece la lista: el botón y la confirmación de `?nueva`. */
function NewShippingGuide() {
  const creation = useNewShippingGuide(true);
  return (
    <>
      <button type="button" disabled={creation.pending} onClick={creation.start}>
        Nueva guía de remisión
      </button>
      {creation.element}
    </>
  );
}

describe("nueva guía de remisión sobre la lista (decisión del propietario, 2026-10-22)", () => {
  const prepared = () => {
    const state: { created?: unknown } = {};
    const route: Route = (init) => {
      state.created = JSON.parse(init.body as string);
      return { status: 201, body: { data: guideDraft({ id: "grd-9" }) } };
    };
    return { state, route };
  };

  it("el botón prepara el borrador con el punto predeterminado y abre su editor, sin página intermedia", async () => {
    navigation.pathname = "/guias-remision";
    const { state, route } = prepared();
    render(<NewShippingGuide />, { "POST /api/v1/shipping-guides/drafts": route });
    const user = userEvent.setup();
    const button = await screen.findByRole("button", { name: "Nueva guía de remisión" });
    await waitFor(() => expect(button).toHaveProperty("disabled", false));
    await user.click(button);
    await waitFor(() =>
      expect(navigation.push).toHaveBeenCalledWith("/guias-remision/borradores/grd-9"),
    );
    expect(state.created).toEqual({ emissionPointId: "pto-1" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("desde la creación rápida (`?nueva`) pide confirmar: cancelar no crea nada", async () => {
    navigation.pathname = "/guias-remision";
    navigation.search = new URLSearchParams("nueva=1");
    const { state, route } = prepared();
    const calls = render(<NewShippingGuide />, { "POST /api/v1/shipping-guides/drafts": route });
    const user = userEvent.setup();
    const dialog = await screen.findByRole("dialog", { name: "Nueva guía de remisión" });
    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith("/guias-remision", { scroll: false }),
    );
    expect(calls.some((call) => call.key.startsWith("POST "))).toBe(false);
    expect(state.created).toBeUndefined();
  });

  it("desde la creación rápida, «Preparar borrador» lo crea y abre su editor", async () => {
    navigation.pathname = "/guias-remision";
    navigation.search = new URLSearchParams("nueva=1");
    const { state, route } = prepared();
    render(<NewShippingGuide />, { "POST /api/v1/shipping-guides/drafts": route });
    const user = userEvent.setup();
    const dialog = await screen.findByRole("dialog", { name: "Nueva guía de remisión" });
    // Mientras llega el punto predeterminado, el botón está pendiente.
    await user.click(await within(dialog).findByRole("button", { name: "Preparar borrador" }));
    await waitFor(() =>
      expect(navigation.push).toHaveBeenCalledWith("/guias-remision/borradores/grd-9"),
    );
    expect(state.created).toEqual({ emissionPointId: "pto-1" });
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
    ["TEST", "Pruebas · esta guía de remisión no tendrá validez tributaria."],
    ["PRODUCTION", null],
    ["UNKNOWN", /^No pudimos confirmar el ambiente/],
  ] as const) {
    it(`${environment}: junto a «Emitir» y en la confirmación, con texto e icono`, async () => {
      render(<ShippingGuideDraftScreen draftId="grd-1" />, {
        "GET /api/v1/shipping-guides/drafts/grd-1": ok(guideDraft()),
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
