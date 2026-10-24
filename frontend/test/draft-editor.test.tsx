// Editor de facturas (rediseño pedido por el propietario, 2026-10-16): recorrido comprador,
// productos, pago, total y emitir; totales del servidor mientras se escribe, sin guardar; «Emitir
// factura» como acción principal que guarda antes si hace falta; formas de pago que dicen cuánto
// falta; el estado del guardado como texto discreto; ambiente junto a la emisión y en la
// confirmación; y los estados de la pantalla. El servidor está simulado: ninguna prueba contacta el
// SRI ni emite de verdad.
import { TOUR_SEGMENTS } from "@/features/onboarding/tour-steps";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DraftEditorScreen } from "@/features/invoices/draft-editor";
import { errorBody, navigation, type Route } from "./harness";
import {
  CONSUMER_FINAL,
  CUSTOMER,
  PRODUCT,
  draft,
  invoice,
  ok,
  paged,
  render,
} from "./invoice-draft-fixtures";

/** Los selectores del recorrido de bienvenida de un tramo (add-onboarding-tour). */
const tourSelectors = (id: string) =>
  TOUR_SEGMENTS.find((segment) => segment.id === id)!.steps.flatMap((step) =>
    step.selector ? [step.selector] : [],
  );

const button = (name: string) => screen.getByRole("button", { name });
const summary = () => screen.getByRole("complementary", { name: "Resumen" });
const line1 = () => screen.findByRole("listitem", { name: "Línea 1: Cemento 50 kg" });
const reasonOf = (element: HTMLElement) =>
  document.getElementById(element.getAttribute("aria-describedby") ?? "")?.textContent;
const saveState = () => document.querySelector("[data-slot=draft-state]")?.textContent;
const preview = (extra: Record<string, unknown> = {}) => ok({ ...draft().preview, ...extra });

/** Retiene la respuesta de una ruta hasta que la prueba la suelta. */
function holdRoute(method: string, path: string) {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const real = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      if (String(input) === path && (init.method ?? "GET").toUpperCase() === method) await gate;
      return real(input, init);
    }),
  );
  return () => release();
}

/** Agrega el cemento desde la tabla de productos: se marca su casilla y se confirma. */
async function addCement(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Agregar producto" }));
  const dialog = await screen.findByRole("dialog", { name: "Agregar productos" });
  await user.click(await within(dialog).findByRole("checkbox", { name: "Elegir Cemento 50 kg" }));
  await user.click(within(dialog).getByRole("button", { name: "Agregar producto" }));
  return line1();
}

/** Elige al cliente desde el selector de compradores. */
async function pickCustomer(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Elegir comprador" }));
  const dialog = await screen.findByRole("dialog", { name: "Elegir comprador" });
  await user.click(await within(dialog).findByRole("option", { name: /EL PERNO/ }));
}

beforeEach(() => {
  navigation.pathname = "/borradores/draft-1";
  navigation.search = new URLSearchParams();
  navigation.replace.mockReset();
  navigation.push.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const emailParty = (id: string, legalName: string, emails: string[]) =>
  ok({
    id,
    identificationType: "04",
    identificationTypeLabel: "RUC",
    identification: "0992877878001",
    legalName,
    address: null,
    emails,
    phone: null,
    roles: [],
    status: "ACTIVE",
    systemRecord: null,
    version: 1,
    createdAt: "2026-10-03T10:00:00.000Z",
    updatedAt: "2026-10-03T10:00:00.000Z",
  });

describe("composición del editor", () => {
  it("el comprador es una ficha con su identificación, y un solo punto se muestra sin selector", async () => {
    render(<DraftEditorScreen draftId="draft-1" />, {
      "GET /api/v1/invoices/drafts/draft-1": ok(draft()),
    });
    const section = await screen.findByRole("region", { name: "Datos de la factura" });
    // El título de la sección no se ve: el de la página ya dice «Factura».
    expect(
      within(section).getByRole("heading", { level: 2, name: "Datos de la factura" }).className,
    ).toContain("sr-only");
    const card = within(section).getByRole("group", { name: "Comprador" });
    expect(card.textContent).toContain(CUSTOMER.legalName);
    expect(within(card).getByText(`RUC ${CUSTOMER.identification}`)).toBeDefined();
    expect(within(card).getByRole("button", { name: "Cambiar comprador" })).toBeDefined();
    // No parece un campo editable.
    expect(within(section).queryByRole("textbox")).toBeNull();
    // Un solo punto: el establecimiento y el punto como datos, lado a lado, sin selectores.
    expect(await within(section).findByText("001 · Av. Amazonas, Quito")).toBeDefined();
    expect(within(section).getByText("001-001")).toBeDefined();
    expect(within(section).queryByRole("combobox", { name: "Punto de emisión" })).toBeNull();
    expect(within(section).queryByRole("combobox", { name: "Establecimiento" })).toBeNull();
    // Las migas son de la barra superior; el editor no repite su propia fila.
    expect(screen.queryAllByRole("navigation", { name: "Ruta de navegación" })).toHaveLength(0);
  });

  it("sin productos invita a agregarlos, y agregar uno deja el foco en su cantidad", async () => {
    navigation.pathname = "/borradores/nuevo";
    render(<DraftEditorScreen draftId={null} />, {
      "GET /api/v1/products": paged([PRODUCT]),
    });
    expect(await screen.findByText("Todavía no hay productos en esta factura.")).toBeDefined();
    // El pago se pide cuando ya hay algo que cobrar.
    expect(screen.queryByRole("region", { name: "Formas de pago" })).toBeNull();
    const line = await addCement(userEvent.setup());
    await waitFor(() =>
      expect(document.activeElement).toBe(within(line).getByLabelText("Cantidad")),
    );
    expect(screen.getByRole("region", { name: "Formas de pago" })).toBeDefined();
  });

  it("cada línea muestra su IVA y su subtotal del servidor, y se recalculan al escribir", async () => {
    const calls = render(<DraftEditorScreen draftId="draft-1" />, {
      "GET /api/v1/invoices/drafts/draft-1": ok(draft()),
      "POST /api/v1/invoices/drafts/preview": (init) => {
        const body = JSON.parse(init.body ?? "{}") as { lines?: { quantity: string }[] };
        const base = body.lines?.[0]?.quantity === "30" ? "261.25" : "25.00";
        return {
          status: 200,
          body: {
            data: {
              ...draft().preview,
              lines: [{ ...draft().preview.lines[0], taxableBase: base }],
            },
          },
        };
      },
    });
    const line = await line1();
    expect(await within(line).findByText("$25,00")).toBeDefined();
    expect(within(line).getAllByText(/15 %/).length).toBeGreaterThan(0);
    await userEvent.setup().type(within(line).getByLabelText("Cantidad"), "0");
    expect(await within(line).findByText("$261,25")).toBeDefined();
    const sent = calls.filter((call) => call.key === "POST /api/v1/invoices/drafts/preview");
    expect(sent.at(-1)?.body).toMatchObject({ lines: [{ productId: "prod-1", quantity: "30" }] });
    // La vista previa no guarda nada.
    expect(calls.some((call) => call.key === "PUT /api/v1/invoices/drafts/draft-1")).toBe(false);
  });

  it("quitar una línea se deshace desde el aviso, sin pedir confirmación", async () => {
    render(<DraftEditorScreen draftId="draft-1" />, {
      "GET /api/v1/invoices/drafts/draft-1": ok(draft()),
    });
    const user = userEvent.setup();
    await user.click(within(await line1()).getByRole("button", { name: "Quitar Cemento 50 kg" }));
    expect(screen.queryByRole("listitem", { name: "Línea 1: Cemento 50 kg" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(await screen.findByRole("button", { name: "Deshacer" }));
    expect(await line1()).toBeDefined();
  });
});

describe("emitir como acción principal", () => {
  it("una factura nueva vacía: emitir es la principal pero dice qué falta, y guardar es secundaria", async () => {
    navigation.pathname = "/borradores/nuevo";
    render(<DraftEditorScreen draftId={null} />, {});
    const emit = await screen.findByRole("button", { name: "Emitir factura" });
    expect(emit.getAttribute("data-variant")).toBe("primary");
    expect(emit).toHaveProperty("disabled", true);
    await waitFor(() => expect(reasonOf(emit)).toBe("Para emitir falta: comprador, productos."));
    expect(button("Guardar borrador").getAttribute("data-variant")).toBe("outline");
    const checklist = within(summary()).getByRole("list");
    expect(checklist.textContent).toContain("Comprador: falta");
    expect(checklist.textContent).toContain("Punto de emisión: listo");
    // Cada paso del tramo «Primera factura» del recorrido encuentra su elemento.
    for (const selector of tourSelectors("factura")) {
      expect(document.querySelector(selector), selector).not.toBeNull();
    }
  });

  it("una factura nueva completa se emite sin guardarla antes: guarda y emite en la confirmación", async () => {
    navigation.pathname = "/borradores/nuevo";
    const calls = render(<DraftEditorScreen draftId={null} />, {
      "GET /api/v1/products": paged([PRODUCT]),
      "GET /api/v1/parties": paged([CUSTOMER]),
      "POST /api/v1/invoices/drafts": () => ({ status: 201, body: { data: draft() } }),
      "POST /api/v1/invoices": () => ({ status: 201, body: { data: invoice() } }),
    });
    const user = userEvent.setup();
    await pickCustomer(user);
    await addCement(user);
    const emit = button("Emitir factura");
    await waitFor(() => expect(emit).toHaveProperty("disabled", false));
    await user.click(emit);
    const dialog = await screen.findByRole("dialog", { name: "Emitir factura" });
    expect(within(dialog).getByText("$28,75")).toBeDefined();
    expect(within(dialog).getByText(CUSTOMER.legalName)).toBeDefined();
    expect(within(dialog).getByText("Efectivo", { exact: false })).toBeDefined();
    await user.click(within(dialog).getByRole("button", { name: "Emitir factura" }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/facturas/inv-1"));
    const keys = calls.map((call) => call.key);
    expect(keys.indexOf("POST /api/v1/invoices/drafts")).toBeLessThan(
      keys.indexOf("POST /api/v1/invoices"),
    );
    expect(calls.find((call) => call.key === "POST /api/v1/invoices")?.body).toEqual({
      draftId: "draft-1",
      expectedVersion: 1,
    });
  });

  it("un borrador incompleto, sin comprador ni líneas, se guarda", async () => {
    navigation.pathname = "/borradores/nuevo";
    const calls = render(<DraftEditorScreen draftId={null} />, {
      "POST /api/v1/invoices/drafts": () => ({
        status: 201,
        body: { data: draft({ buyer: null, lines: [] }) },
      }),
    });
    await screen.findByText("001 · Av. Amazonas, Quito");
    await userEvent.setup().click(button("Guardar borrador"));
    expect(await screen.findByText("Guardaste el borrador.")).toBeDefined();
    expect(calls.find((call) => call.key === "POST /api/v1/invoices/drafts")?.body).toEqual({
      emissionPointId: "ep-1",
      buyerPartyId: null,
      lines: [],
      payments: [{ paymentMethod: "01", amount: null }],
    });
    // El editor pasa a ser el del borrador guardado, sin volver a montarse.
    expect(screen.getByRole("heading", { level: 1, name: "Factura Borrador" })).toBeDefined();
    expect(window.location.pathname).toBe("/borradores/draft-1");
    expect(saveState()).toBe("Guardado");
  });

  it("un problema del servidor va junto al comprador y emitir dice que hay que resolverlo", async () => {
    render(<DraftEditorScreen draftId="draft-1" />, {
      "GET /api/v1/invoices/drafts/draft-1": ok(draft()),
      "POST /api/v1/invoices/drafts/preview": preview({
        issues: [
          {
            code: "BUYER_NOT_CUSTOMER",
            message: "El comprador EL PERNO CIA. LTDA. no tiene el rol de cliente.",
            line: null,
            payment: null,
          },
        ],
      }),
    });
    const section = await screen.findByRole("region", { name: "Datos de la factura" });
    expect(await within(section).findByText(/no tiene el rol de cliente/)).toBeDefined();
    const emit = button("Emitir factura");
    expect(emit).toHaveProperty("disabled", true);
    expect(reasonOf(emit)).toBe("Resuelve lo que se indica en rojo antes de emitir.");
    expect(button("Guardar borrador")).toHaveProperty("disabled", false);
    // No se repite en «Antes de emitir».
    expect(within(summary()).queryByText(/no tiene el rol de cliente/)).toBeNull();
  });

  it("con cambios sin guardar se puede emitir: la confirmación guarda la versión nueva antes", async () => {
    const calls = render(<DraftEditorScreen draftId="draft-1" />, {
      "GET /api/v1/invoices/drafts/draft-1": ok(draft()),
      "PUT /api/v1/invoices/drafts/draft-1": () => ({
        status: 200,
        body: { data: draft({ version: 2 }) },
      }),
      "POST /api/v1/invoices": () => ({ status: 201, body: { data: invoice() } }),
    });
    const user = userEvent.setup();
    await user.type(within(await line1()).getByLabelText("Cantidad"), "0");
    expect(saveState()).toBe("Sin guardar");
    const emit = button("Emitir factura");
    await waitFor(() => expect(emit).toHaveProperty("disabled", false));
    await user.click(emit);
    const dialog = await screen.findByRole("dialog", { name: "Emitir factura" });
    await user.click(within(dialog).getByRole("button", { name: "Emitir factura" }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/facturas/inv-1"));
    expect(calls.find((call) => call.key === "PUT /api/v1/invoices/drafts/draft-1")?.body).toEqual(
      expect.objectContaining({ expectedVersion: 1 }),
    );
    expect(calls.find((call) => call.key === "POST /api/v1/invoices")?.body).toEqual({
      draftId: "draft-1",
      expectedVersion: 2,
    });
  });

  it("guardado en curso: guardar en curso, sin emitir, y el formulario no se puede editar", async () => {
    render(<DraftEditorScreen draftId="draft-1" />, {
      "GET /api/v1/invoices/drafts/draft-1": ok(draft()),
      "PUT /api/v1/invoices/drafts/draft-1": () => ({
        status: 200,
        body: { data: draft({ version: 2 }) },
      }),
    });
    const line = await line1();
    const user = userEvent.setup();
    await user.type(within(line).getByLabelText("Cantidad"), "0");
    const release = holdRoute("PUT", "/api/v1/invoices/drafts/draft-1");
    await user.click(button("Guardar borrador"));
    const pending = await screen.findByRole("button", { name: /Guardando el borrador/ });
    expect(pending.getAttribute("aria-busy")).toBe("true");
    expect(saveState()).toBe("Guardando…");
    expect(button("Emitir factura")).toHaveProperty("disabled", true);
    const quantity = within(line).getByLabelText("Cantidad") as HTMLInputElement;
    expect(quantity.matches(":disabled")).toBe(true);
    expect(button("Cambiar comprador").matches(":disabled")).toBe(true);
    release();
    expect(await screen.findByText("Guardaste el borrador.")).toBeDefined();
    expect(saveState()).toBe("Guardado");
  });

  it("un guardado rechazado por un conflicto conserva lo escrito y recargar trae la versión vigente", async () => {
    let current = draft();
    render(<DraftEditorScreen draftId="draft-1" />, {
      "GET /api/v1/invoices/drafts/draft-1": () => ({ status: 200, body: { data: current } }),
      "PUT /api/v1/invoices/drafts/draft-1": () => ({
        status: 409,
        body: errorBody("INVOICE_DRAFT_CHANGED", "Otro usuario cambió este borrador."),
      }),
    });
    const line = await line1();
    const user = userEvent.setup();
    const quantity = within(line).getByLabelText("Cantidad") as HTMLInputElement;
    await user.clear(quantity);
    await user.type(quantity, "7");
    await user.click(button("Guardar borrador"));
    const alert = await screen.findByRole("alert");
    expect((within(line).getByLabelText("Cantidad") as HTMLInputElement).value).toBe("7");
    expect(saveState()).toBe("Sin guardar");
    current = draft({
      version: 3,
      lines: [{ ...draft().lines[0], quantity: "5" }],
    });
    await user.click(within(alert).getByRole("button", { name: "Recargar borrador" }));
    await waitFor(async () =>
      expect((within(await line1()).getByLabelText("Cantidad") as HTMLInputElement).value).toBe(
        "5",
      ),
    );
    expect(saveState()).toBe("Guardado");
  });

  it("Ctrl + S guarda el borrador", async () => {
    const calls = render(<DraftEditorScreen draftId="draft-1" />, {
      "GET /api/v1/invoices/drafts/draft-1": ok(draft()),
      "PUT /api/v1/invoices/drafts/draft-1": () => ({
        status: 200,
        body: { data: draft({ version: 2 }) },
      }),
    });
    const user = userEvent.setup();
    await user.type(within(await line1()).getByLabelText("Cantidad"), "0");
    await user.keyboard("{Control>}s{/Control}");
    expect(await screen.findByText("Guardaste el borrador.")).toBeDefined();
    expect(calls.some((call) => call.key === "PUT /api/v1/invoices/drafts/draft-1")).toBe(true);
  });
});

describe("resumen con los totales del servidor", () => {
  it("sin productos, el resumen dice dónde aparecerá el total", async () => {
    navigation.pathname = "/borradores/nuevo";
    render(<DraftEditorScreen draftId={null} />, {});
    const panel = await screen.findByRole("complementary", { name: "Resumen" });
    expect(
      within(panel).getByText("El total aparecerá aquí cuando agregues el primer producto."),
    ).toBeDefined();
    expect(within(summary()).queryByText(/\$/)).toBeNull();
  });

  it("una factura nueva muestra subtotal, descuento, IVA y total sin guardarla", async () => {
    navigation.pathname = "/borradores/nuevo";
    const calls = render(<DraftEditorScreen draftId={null} />, {
      "GET /api/v1/products": paged([PRODUCT]),
    });
    await addCement(userEvent.setup());
    expect(await within(summary()).findByText("$28,75")).toBeDefined();
    expect(within(summary()).getByText("Subtotal sin impuestos")).toBeDefined();
    expect(within(summary()).getByText("IVA 15 %")).toBeDefined();
    expect(within(summary()).getByText("1 producto")).toBeDefined();
    expect(within(summary()).queryByText(/Guarda el borrador/)).toBeNull();
    expect(calls.some((call) => call.key === "POST /api/v1/invoices/drafts")).toBe(false);
  });

  it("sin totales calculables lo dice, y los problemas generales van en «Antes de emitir»", async () => {
    render(<DraftEditorScreen draftId="draft-1" />, {
      "GET /api/v1/invoices/drafts/draft-1": ok(draft()),
      "POST /api/v1/invoices/drafts/preview": preview({
        totals: null,
        issues: [
          {
            code: "TAX_REFERENCE_NOT_USABLE",
            message: "Línea 1: la tarifa de IVA ya no está habilitada.",
            line: 1,
            payment: null,
          },
          {
            code: "SIGNING_CERTIFICATE_NOT_USABLE",
            message: "La firma electrónica no es utilizable.",
            line: null,
            payment: null,
          },
        ],
      }),
    });
    await line1();
    expect(
      await within(summary()).findByText(
        "El total aparece cuando todas las líneas se pueden calcular.",
      ),
    ).toBeDefined();
    expect(within(summary()).queryByText(/\$/)).toBeNull();
    expect(within(summary()).getByText("La firma electrónica no es utilizable.")).toBeDefined();
    expect(within(await line1()).getByText(/la tarifa de IVA ya no está habilitada/)).toBeDefined();
  });
});

describe("ambiente junto a la emisión y confirmación", () => {
  const status = (environment: "TEST" | "PRODUCTION") =>
    ok({
      environment,
      displayName: "COMERCIAL ANDINA S.A.",
      readiness: { ready: true, checks: [] },
    });
  const notices = () => document.querySelectorAll("[data-slot=emission-environment-notice]");
  const openConfirmation = async () => {
    const emit = await screen.findByRole("button", { name: "Emitir factura" });
    await waitFor(() => expect(emit).toHaveProperty("disabled", false));
    await userEvent.setup().click(emit);
    return screen.findByRole("dialog", { name: "Emitir factura" });
  };

  it("Pruebas: el aviso junto a emitir y en la confirmación", async () => {
    render(<DraftEditorScreen draftId="draft-1" />, {
      "GET /api/v1/invoices/drafts/draft-1": ok(draft()),
    });
    await waitFor(() => expect(notices()).toHaveLength(1));
    expect(notices()[0]!.textContent).toBe("Pruebas · esta factura no tendrá validez tributaria.");
    const dialog = await openConfirmation();
    expect(
      within(dialog).getByText("Pruebas · esta factura no tendrá validez tributaria."),
    ).toBeDefined();
  });

  // El destino del correo va en la misma confirmación (add-email-delivery, tarea 10.2).
  it("Producción: la confirmación dice a dónde irá el correo del comprador", async () => {
    render(<DraftEditorScreen draftId="draft-1" />, {
      "GET /api/v1/invoices/drafts/draft-1": ok(draft()),
      "GET /api/v1/company/status": status("PRODUCTION"),
      "GET /api/v1/email/availability": ok({
        configured: true,
        deliveryEnabled: true,
        autoSend: true,
        testRecipient: null,
      }),
      "GET /api/v1/parties/party-1": emailParty("party-1", "EL PERNO CIA. LTDA.", [
        "compras@cliente.ec",
        "pagos@cliente.ec",
      ]),
    });
    const dialog = await openConfirmation();
    expect(
      (
        await within(dialog).findByText(
          "Se enviará por correo a: compras@cliente.ec, pagos@cliente.ec.",
        )
      ).closest("[data-slot=email-destination-notice]"),
    ).not.toBeNull();
  });

  it("Producción: contexto en la confirmación, sin aviso ni presentación de éxito", async () => {
    render(<DraftEditorScreen draftId="draft-1" />, {
      "GET /api/v1/invoices/drafts/draft-1": ok(draft()),
      "GET /api/v1/company/status": status("PRODUCTION"),
    });
    const dialog = await openConfirmation();
    expect(within(dialog).getByText("Producción")).toBeDefined();
    expect(notices()).toHaveLength(0);
  });

  it("ambiente desconocido: lo dice junto a emitir y nunca muestra Producción", async () => {
    render(<DraftEditorScreen draftId="draft-1" />, {
      "GET /api/v1/invoices/drafts/draft-1": ok(draft()),
      "GET /api/v1/company/status": () => ({ status: 503, body: errorBody("X", "Caído") }),
    });
    await waitFor(() => expect(notices()).toHaveLength(1), { timeout: 5_000 });
    expect(notices()[0]!.textContent).toMatch(/^No pudimos confirmar el ambiente/);
    expect(screen.queryByText("Producción")).toBeNull();
  });

  it("a consumidor final, la confirmación advierte de sus restricciones", async () => {
    render(<DraftEditorScreen draftId="draft-1" />, {
      "GET /api/v1/invoices/drafts/draft-1": ok(
        draft({
          buyer: {
            id: "party-cf",
            identificationType: "07",
            identification: "9999999999999",
            legalName: "CONSUMIDOR FINAL",
            status: "ACTIVE",
            systemRecord: "CONSUMER_FINAL",
          },
        }),
      ),
    });
    const dialog = await openConfirmation();
    expect(within(dialog).getByText(/restricciones para anularse/)).toBeDefined();
  });

  it("confirmar dos veces seguidas envía una sola emisión, y un reintento repite la clave", async () => {
    const keys: string[] = [];
    let fail = true;
    const emitRoute: Route = (init) => {
      keys.push(new Headers(init.headers).get("Idempotency-Key") ?? "");
      if (fail) {
        fail = false;
        return { status: 503, body: errorBody("SERVICE_UNAVAILABLE", "No disponible.") };
      }
      return { status: 201, body: { data: invoice() } };
    };
    render(<DraftEditorScreen draftId="draft-1" />, {
      "GET /api/v1/invoices/drafts/draft-1": ok(draft()),
      "POST /api/v1/invoices": emitRoute,
    });
    const user = userEvent.setup();
    let dialog = await openConfirmation();
    await user.dblClick(within(dialog).getByRole("button", { name: "Emitir factura" }));
    expect(await screen.findByRole("alert")).toBeDefined();
    expect(keys).toHaveLength(1);
    dialog = await openConfirmation();
    await user.click(within(dialog).getByRole("button", { name: "Emitir factura" }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/facturas/inv-1"));
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
  });
});

describe("formas de pago", () => {
  it("con una, el importe es el total; al dividir dice cuánto falta y propone asignarlo", async () => {
    render(<DraftEditorScreen draftId="draft-1" />, {
      "GET /api/v1/invoices/drafts/draft-1": ok(draft()),
    });
    await line1();
    const first = screen.getByRole("group", { name: "Forma de pago 1" });
    // Con una forma de pago, el importe es un campo deshabilitado con el total
    // (decisión del propietario, 2026-10-22).
    const total = within(first).getByLabelText("Importe") as HTMLInputElement;
    await waitFor(() => expect(total.value).toBe("$28,75"));
    expect(total.disabled).toBe(true);
    expect(within(first).getByText("El total de la factura.")).toBeDefined();
    // Sin título visible de la sección: el de las formas de pago queda para la asistencia.
    expect(screen.getByRole("heading", { level: 2, name: "Formas de pago" }).className).toContain(
      "sr-only",
    );
    expect(
      await within(first).findByText("SRI 01 · Sin utilización del sistema financiero"),
    ).toBeDefined();
    expect(within(first).getByRole("option", { name: "Efectivo" })).toBeDefined();
    const user = userEvent.setup();
    await user.click(button("Dividir el pago"));
    // La ayuda de la sección y lo que falta van en la etiqueta del primer «Forma de pago».
    expect(within(first).getByText(/^Reparte el total entre las formas de pago\./)).toBeDefined();
    const pendingBadge = (await within(first).findByText("Faltan $28,75 por asignar")).closest(
      "[data-slot=badge]",
    );
    expect(pendingBadge?.getAttribute("data-variant")).toBe("warning");
    expect(pendingBadge?.closest("div")?.querySelector("label")?.textContent).toBe("Forma de pago");
    await user.type(within(first).getByLabelText("Importe (USD)"), "10");
    const second = screen.getByRole("group", { name: "Forma de pago 2" });
    await user.selectOptions(within(second).getByLabelText("Forma de pago"), "19");
    await user.click(
      await within(second).findByRole("button", { name: "Asignar lo pendiente ($18,75)" }),
    );
    expect(await screen.findByText("El pago cubre el total")).toBeDefined();
    expect(
      within(second).getByRole("button", {
        name: "Quitar la forma de pago 2 (Tarjeta de crédito)",
      }),
    ).toBeDefined();
    expect(within(first).queryByRole("button", { name: /Quitar la forma de pago 2/ })).toBeNull();
    // Asignar de más se dice al momento.
    const amount = within(second).getByLabelText("Importe (USD)") as HTMLInputElement;
    await user.clear(amount);
    await user.type(amount, "20");
    expect(await screen.findByText("Asignaste $1,25 más que el total")).toBeDefined();
    expect(reasonOf(button("Emitir factura"))).toBe("Para emitir falta: forma de pago.");
  });

  it("al volver a una sola forma de pago, su importe vuelve a ser el total", async () => {
    render(<DraftEditorScreen draftId="draft-1" />, {
      "GET /api/v1/invoices/drafts/draft-1": ok(draft()),
    });
    await line1();
    const user = userEvent.setup();
    await user.click(button("Dividir el pago"));
    const first = screen.getByRole("group", { name: "Forma de pago 1" });
    await user.type(within(first).getByLabelText("Importe (USD)"), "10");
    await user.click(screen.getByRole("button", { name: /Quitar la forma de pago 2/ }));
    expect(await within(first).findByText("El total de la factura.")).toBeDefined();
    expect(within(first).queryByLabelText("Importe (USD)")).toBeNull();
  });
});

describe("estado del guardado", () => {
  const beforeUnload = () => {
    const event = new Event("beforeunload", { cancelable: true });
    act(() => {
      window.dispatchEvent(event);
    });
    return event.defaultPrevented;
  };

  it("es texto neutro, no una advertencia junto al título, y pide confirmar al salir con cambios", async () => {
    render(<DraftEditorScreen draftId="draft-1" />, {
      "GET /api/v1/invoices/drafts/draft-1": ok(draft()),
      "PUT /api/v1/invoices/drafts/draft-1": () => ({
        status: 200,
        body: { data: draft({ version: 2 }) },
      }),
    });
    const line = await line1();
    expect(saveState()).toBe("Guardado");
    expect(document.querySelector("[data-slot=page-header] [data-slot=draft-state]")).toBeNull();
    expect(beforeUnload()).toBe(false);
    const user = userEvent.setup();
    await user.type(within(line).getByLabelText("Cantidad"), "0");
    expect(saveState()).toBe("Sin guardar");
    expect(beforeUnload()).toBe(true);
    await user.click(button("Guardar borrador"));
    expect(await screen.findByText("Guardaste el borrador.")).toBeDefined();
    await waitFor(() => expect(beforeUnload()).toBe(false));
    expect(saveState()).toBe("Guardado");
  });

  it("un guardado fallido conserva el estado y el aviso al salir", async () => {
    render(<DraftEditorScreen draftId="draft-1" />, {
      "GET /api/v1/invoices/drafts/draft-1": ok(draft()),
      "PUT /api/v1/invoices/drafts/draft-1": () => ({
        status: 409,
        body: errorBody("INVOICE_DRAFT_CHANGED", "Otro usuario cambió este borrador."),
      }),
    });
    const user = userEvent.setup();
    await user.type(within(await line1()).getByLabelText("Cantidad"), "0");
    await user.click(button("Guardar borrador"));
    await screen.findByRole("alert");
    expect(saveState()).toBe("Sin guardar");
    expect(beforeUnload()).toBe(true);
  });

  it("una factura nueva sin tocar no pide confirmar, aunque tome el punto predeterminado", async () => {
    navigation.pathname = "/borradores/nuevo";
    render(<DraftEditorScreen draftId={null} />, {});
    await screen.findByText("001 · Av. Amazonas, Quito");
    expect(saveState()).toBe("Sin guardar");
    expect(beforeUnload()).toBe(false);
  });
});

describe("estados del editor", () => {
  it("un borrador inexistente o de otra empresa no existe y no muestra ningún dato", async () => {
    render(<DraftEditorScreen draftId="ajeno" />, {
      "GET /api/v1/invoices/drafts/ajeno": () => ({
        status: 404,
        body: errorBody("INVOICE_DRAFT_NOT_FOUND", "El borrador no existe."),
      }),
    });
    expect(
      await screen.findByText("El borrador no existe", undefined, { timeout: 5_000 }),
    ).toBeDefined();
    expect(screen.queryByRole("complementary", { name: "Resumen" })).toBeNull();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  }, 10_000);

  it("la carga anuncia el estado con el mismo encabezado; el error se reintenta", async () => {
    let fail = true;
    navigation.pathname = "/borradores/draft-1";
    render(<DraftEditorScreen draftId="draft-1" />, {
      "GET /api/v1/invoices/drafts/draft-1": () =>
        fail ? { status: 500, body: errorBody("INTERNAL_ERROR", "x") } : ok(draft())({}),
    });
    expect((await screen.findByRole("status")).textContent).toBe("Cargando el borrador");
    expect(screen.getByRole("heading", { level: 1, name: "Factura Borrador" })).toBeDefined();
    expect(
      await screen.findByText("No pudimos cargar el borrador.", undefined, { timeout: 5_000 }),
    ).toBeDefined();
    fail = false;
    await userEvent.setup().click(screen.getByRole("button", { name: "Intentar de nuevo" }));
    expect(await line1()).toBeDefined();
  }, 10_000);
});

describe("pedidos del propietario sobre el editor (2026-10-22)", () => {
  const VARILLA = { ...PRODUCT, id: "prod-2", mainCode: "VAR-10", name: "Varilla 10 mm" };

  it("«Elegir comprador» y «Agregar producto» van en azul, y «Consumidor final» lo elige en un clic", async () => {
    navigation.pathname = "/borradores/nuevo";
    render(<DraftEditorScreen draftId={null} />, {
      "GET /api/v1/parties": paged([CONSUMER_FINAL]),
      "GET /api/v1/products": paged([PRODUCT]),
    });
    const user = userEvent.setup();
    const pick = await screen.findByRole("button", { name: "Elegir comprador" });
    expect(pick.getAttribute("data-variant")).toBe("primary");
    expect(
      screen.getByRole("button", { name: "Agregar producto" }).getAttribute("data-variant"),
    ).toBe("primary");
    await user.click(screen.getByRole("button", { name: "Consumidor final" }));
    expect(await screen.findByText("CONSUMIDOR FINAL")).toBeDefined();
    // Ya es el comprador: su botón rápido desaparece y el otro pasa a «Cambiar».
    expect(screen.queryByRole("button", { name: "Consumidor final" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Cambiar comprador" }).getAttribute("data-variant"),
    ).toBe("primary");
  });

  it("en el selector de comprador, «Consumidor final» va destacado con el degradado del primario", async () => {
    navigation.pathname = "/borradores/nuevo";
    render(<DraftEditorScreen draftId={null} />, {
      "GET /api/v1/parties": paged([CUSTOMER]),
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Elegir comprador" }));
    const dialog = await screen.findByRole("dialog", { name: "Elegir comprador" });
    const quick = await within(dialog).findByRole("option", { name: "Consumidor final" });
    expect(quick.className).toContain("bg-linear-to-r");
    expect(quick.className).toContain("from-primary");
  });

  it("la tabla de productos elige varios a la vez y los agrega en el orden en que se eligieron", async () => {
    navigation.pathname = "/borradores/nuevo";
    render(<DraftEditorScreen draftId={null} />, {
      "GET /api/v1/products": paged([PRODUCT, VARILLA]),
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Agregar producto" }));
    const dialog = await screen.findByRole("dialog", { name: "Agregar productos" });
    expect(within(dialog).getByRole("table", { name: "Productos activos" })).toBeDefined();
    // El filtro de tipo llena su cuarto de la fila, junto a la búsqueda.
    expect(within(dialog).getByRole("combobox", { name: "Tipo" }).className).toContain("w-full");
    await user.click(await within(dialog).findByRole("checkbox", { name: "Elegir Varilla 10 mm" }));
    await user.click(within(dialog).getByRole("checkbox", { name: "Elegir Cemento 50 kg" }));
    expect(within(dialog).getByText("2 productos elegidos")).toBeDefined();
    await user.click(within(dialog).getByRole("button", { name: "Agregar 2 productos" }));
    expect(await screen.findByRole("listitem", { name: "Línea 1: Varilla 10 mm" })).toBeDefined();
    expect(screen.getByRole("listitem", { name: "Línea 2: Cemento 50 kg" })).toBeDefined();
  });

  it("quitar va en rojo y «Dividir el pago» ocupa todo el ancho, punteado", async () => {
    render(<DraftEditorScreen draftId="draft-1" />, {
      "GET /api/v1/invoices/drafts/draft-1": ok(draft()),
    });
    const [remove] = await screen.findAllByRole("button", { name: /^Quitar / });
    expect(remove!.className).toContain("text-danger");
    const split = screen.getByRole("button", { name: "Dividir el pago" });
    expect(split.className).toContain("w-full");
    expect(split.className).toContain("border-dashed");
  });
});
