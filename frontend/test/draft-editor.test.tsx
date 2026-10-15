// Editor de facturas productizado (productize-invoice-editor-and-composition-foundation, grupo 6):
// composición (D13), guardar y emitir por situación (D14), totales veraces (D8, PO-2), ambiente junto
// a la emisión y en la confirmación (D21, D15), formas de pago, cambios sin guardar (D16, PO-3) y los
// estados de la pantalla. El servidor está simulado: ninguna prueba contacta el SRI ni emite de verdad.
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DraftEditorScreen } from "@/features/invoices/draft-editor";
import { errorBody, navigation } from "./harness";
import { CUSTOMER, PRODUCT, draft, invoice, ok, paged, render } from "./invoice-draft-fixtures";

const button = (name: string) => screen.getByRole("button", { name });
const summary = () => screen.getByRole("complementary", { name: "Resumen" });
const line1 = () => screen.findByRole("listitem", { name: "Línea 1: Cemento 50 kg" });
const reasonOf = (element: HTMLElement) =>
  document.getElementById(element.getAttribute("aria-describedby") ?? "")?.textContent;

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

const withIssues = (issues: unknown[], extra: Record<string, unknown> = {}) =>
  draft({ preview: { ...draft().preview, issues, ...extra } });

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

describe("composición del editor (D13)", () => {
  it("el comprador y el punto de emisión van en la misma sección, y hay una sola fila de migas", async () => {
    render(<DraftEditorScreen draftId="draft-1" />, {
      "GET /api/v1/invoices/drafts/draft-1": ok(draft()),
    });
    const section = await screen.findByRole("region", { name: "Comprador y punto de emisión" });
    expect(within(section).getByRole("group", { name: "Comprador" }).textContent).toContain(
      "EL PERNO CIA. LTDA.",
    );
    expect(within(section).getByText(CUSTOMER.identification)).toBeDefined();
    expect(within(section).getByLabelText("Punto de emisión")).toBeDefined();
    expect(within(section).getByRole("button", { name: "Cambiar comprador" })).toBeDefined();
    const crumbs = screen.getAllByRole("navigation", { name: "Ruta de navegación" });
    expect(crumbs).toHaveLength(1);
    expect(within(crumbs[0]!).getByRole("link", { name: "Facturas" }).getAttribute("href")).toBe(
      "/facturas",
    );
    // Sin enlace «volver» aparte.
    expect(screen.queryByRole("link", { name: "Borradores de facturas" })).toBeNull();
  });

  it("agregar un producto deja el foco en la cantidad de la línea nueva", async () => {
    navigation.pathname = "/borradores/nuevo";
    render(<DraftEditorScreen draftId={null} />, {
      "GET /api/v1/products": paged([PRODUCT]),
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Agregar producto" }));
    const dialog = await screen.findByRole("dialog", { name: "Agregar producto" });
    await user.click(await within(dialog).findByRole("option", { name: /Cemento 50 kg/ }));
    const line = await line1();
    await waitFor(() =>
      expect(document.activeElement).toBe(within(line).getByLabelText("Cantidad")),
    );
  });

  it("la base imponible es la del servidor, solo con el borrador guardado y sin cambios", async () => {
    render(<DraftEditorScreen draftId="draft-1" />, {
      "GET /api/v1/invoices/drafts/draft-1": ok(draft()),
    });
    const line = await line1();
    expect(within(line).getAllByText(/USD 25,00/).length).toBeGreaterThan(0);
    const user = userEvent.setup();
    await user.type(within(line).getByLabelText("Cantidad"), "0");
    expect(within(line).queryAllByText(/USD 25,00/)).toHaveLength(0);
    expect(within(line).getAllByText("se calcula al guardar").length).toBeGreaterThan(0);
  });
});

describe("guardar y emitir según la situación (D14)", () => {
  it("nuevo, sin guardar: guardar es la principal y emitir dice que primero hay que guardar", async () => {
    navigation.pathname = "/borradores/nuevo";
    render(<DraftEditorScreen draftId={null} />, {});
    const save = await screen.findByRole("button", { name: "Guardar borrador" });
    expect(save.getAttribute("data-variant")).toBe("primary");
    const emit = button("Emitir factura");
    expect(emit).toHaveProperty("disabled", true);
    expect(emit.getAttribute("data-variant")).not.toBe("primary");
    expect(reasonOf(emit)).toBe("Guarda el borrador para emitirlo.");
  });

  it("un borrador incompleto, sin comprador ni líneas, se guarda", async () => {
    navigation.pathname = "/borradores/nuevo";
    const calls = render(<DraftEditorScreen draftId={null} />, {
      "POST /api/v1/invoices/drafts": () => ({
        status: 201,
        body: { data: draft({ buyer: null, lines: [] }) },
      }),
    });
    const user = userEvent.setup();
    await waitFor(() =>
      expect((screen.getByLabelText("Punto de emisión") as HTMLSelectElement).value).toBe("ep-1"),
    );
    await user.click(button("Guardar borrador"));
    expect(await screen.findByText("Guardaste el borrador.")).toBeDefined();
    expect(calls.find((call) => call.key === "POST /api/v1/invoices/drafts")?.body).toEqual({
      emissionPointId: "ep-1",
      buyerPartyId: null,
      lines: [],
      payments: [{ paymentMethod: "01", amount: null }],
    });
  });

  it("guardado con problemas y sin cambios: ninguna se destaca, guardar sigue y el problema va junto al comprador", async () => {
    render(<DraftEditorScreen draftId="draft-1" />, {
      "GET /api/v1/invoices/drafts/draft-1": ok(
        withIssues([
          {
            code: "BUYER_NOT_CUSTOMER",
            message: "El comprador EL PERNO CIA. LTDA. no tiene el rol de cliente.",
            line: null,
            payment: null,
          },
        ]),
      ),
    });
    const save = await screen.findByRole("button", { name: "Guardar borrador" });
    expect(save).toHaveProperty("disabled", false);
    expect(save.getAttribute("data-variant")).toBe("outline");
    const emit = button("Emitir factura");
    expect(emit).toHaveProperty("disabled", true);
    expect(emit.getAttribute("data-variant")).toBe("outline");
    expect(reasonOf(emit)).toBe("Resuelve los problemas del resumen antes de emitir.");
    const section = screen.getByRole("region", { name: "Comprador y punto de emisión" });
    expect(within(section).getByText(/no tiene el rol de cliente/)).toBeDefined();
    // No se repite en «Antes de emitir».
    expect(within(summary()).queryByText(/no tiene el rol de cliente/)).toBeNull();
  });

  it("guardado con cambios: guardar pasa a principal y emitir pide guardar los cambios", async () => {
    const calls = render(<DraftEditorScreen draftId="draft-1" />, {
      "GET /api/v1/invoices/drafts/draft-1": ok(draft()),
      "PUT /api/v1/invoices/drafts/draft-1": () => ({
        status: 200,
        body: { data: draft({ version: 2 }) },
      }),
    });
    const line = await line1();
    const user = userEvent.setup();
    await user.type(within(line).getByLabelText("Cantidad"), "0");
    expect(button("Guardar borrador").getAttribute("data-variant")).toBe("primary");
    expect(reasonOf(button("Emitir factura"))).toBe("Guarda los cambios antes de emitir.");
    await user.click(button("Guardar borrador"));
    expect(await screen.findByText("Guardaste el borrador.")).toBeDefined();
    expect(calls.some((call) => call.key === "PUT /api/v1/invoices/drafts/draft-1")).toBe(true);
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
    expect(button("Emitir factura")).toHaveProperty("disabled", true);
    // El `fieldset` deshabilitado deja sin edición todo lo que contiene.
    const quantity = within(line).getByLabelText("Cantidad") as HTMLInputElement;
    expect(quantity.matches(":disabled")).toBe(true);
    await user.type(quantity, "9");
    expect(quantity.value).toBe("30");
    expect(button("Cambiar comprador").matches(":disabled")).toBe(true);
    expect(button("Agregar producto").matches(":disabled")).toBe(true);
    release();
    expect(await screen.findByText("Guardaste el borrador.")).toBeDefined();
  });

  it("listo: emitir es la principal, guardar la secundaria, y abre la confirmación", async () => {
    render(<DraftEditorScreen draftId="draft-1" />, {
      "GET /api/v1/invoices/drafts/draft-1": ok(draft()),
    });
    const emit = await screen.findByRole("button", { name: "Emitir factura" });
    expect(emit.getAttribute("data-variant")).toBe("primary");
    expect(emit.getAttribute("aria-describedby")).toBeNull();
    expect(button("Guardar borrador").getAttribute("data-variant")).toBe("outline");
    await userEvent.setup().click(emit);
    expect(await screen.findByRole("dialog", { name: "Emitir factura" })).toBeDefined();
  });

  it("un guardado rechazado por un conflicto conserva lo escrito y ofrece recargar", async () => {
    render(<DraftEditorScreen draftId="draft-1" />, {
      "GET /api/v1/invoices/drafts/draft-1": ok(draft()),
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
    expect(within(alert).getByRole("button", { name: "Recargar borrador" })).toBeDefined();
    expect((within(line).getByLabelText("Cantidad") as HTMLInputElement).value).toBe("7");
    expect(screen.getAllByText("Cambios sin guardar").length).toBeGreaterThan(0);
  });
});

describe("totales veraces (D8, PO-2)", () => {
  it("A. sin borrador guardado no hay importes ni ceros", async () => {
    navigation.pathname = "/borradores/nuevo";
    render(<DraftEditorScreen draftId={null} />, {
      "GET /api/v1/products": paged([PRODUCT]),
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Agregar producto" }));
    const dialog = await screen.findByRole("dialog", { name: "Agregar producto" });
    await user.click(await within(dialog).findByRole("option", { name: /Cemento 50 kg/ }));
    await line1();
    expect(
      within(summary()).getByText(
        "Guarda el borrador para obtener los totales calculados por el servidor.",
      ),
    ).toBeDefined();
    expect(within(summary()).queryByText(/USD/)).toBeNull();
  });

  it("B, C y D: vigentes al abrir, rotulados como del último guardado al editar, y los nuevos tras guardar", async () => {
    let current = draft();
    render(<DraftEditorScreen draftId="draft-1" />, {
      "GET /api/v1/invoices/drafts/draft-1": () => ({ status: 200, body: { data: current } }),
      "PUT /api/v1/invoices/drafts/draft-1": () => {
        current = draft({
          version: 2,
          preview: {
            ...draft().preview,
            totals: { ...draft().preview.totals, total: "43.13" },
          },
        });
        return { status: 200, body: { data: current } };
      },
    });
    await line1();
    expect(within(summary()).getByText("USD 28,75")).toBeDefined();
    expect(within(summary()).queryByText("Totales del último guardado")).toBeNull();
    const user = userEvent.setup();
    await user.type(within(await line1()).getByLabelText("Cantidad"), "0");
    // C: el total anterior no se presenta como vigente y el navegador no calcula otro.
    expect(within(summary()).getByText("Totales del último guardado")).toBeDefined();
    expect(within(summary()).getByText("Guarda para recalcularlos.")).toBeDefined();
    expect(
      within(summary()).getByText("USD 28,75").closest("[data-slot=stale-totals]"),
    ).not.toBeNull();
    await user.click(button("Guardar borrador"));
    // D: la respuesta del servidor es la única fuente.
    expect(await within(summary()).findByText("USD 43,13")).toBeDefined();
    expect(within(summary()).queryByText("Totales del último guardado")).toBeNull();
  });

  it("un guardado fallido deja los totales rotulados como del último guardado", async () => {
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
    expect(within(summary()).getByText("Totales del último guardado")).toBeDefined();
  });

  it("sin totales calculables lo dice, y los problemas generales van en «Antes de emitir»", async () => {
    render(<DraftEditorScreen draftId="draft-1" />, {
      "GET /api/v1/invoices/drafts/draft-1": ok(
        withIssues(
          [
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
          { totals: null },
        ),
      ),
    });
    await line1();
    expect(
      within(summary()).getByText(
        "Los totales aparecen cuando todas las líneas se pueden calcular.",
      ),
    ).toBeDefined();
    expect(within(summary()).queryByText(/USD/)).toBeNull();
    expect(within(summary()).getByText("La firma electrónica no es utilizable.")).toBeDefined();
  });
});

describe("ambiente junto a la emisión y confirmación (D21, D15)", () => {
  const status = (environment: "TEST" | "PRODUCTION") =>
    ok({
      environment,
      displayName: "COMERCIAL ANDINA S.A.",
      readiness: { ready: true, checks: [] },
    });
  const notices = () => document.querySelectorAll("[data-slot=emission-environment-notice]");

  it("Pruebas: el aviso junto a emitir y en la confirmación", async () => {
    render(<DraftEditorScreen draftId="draft-1" />, {
      "GET /api/v1/invoices/drafts/draft-1": ok(draft()),
    });
    await waitFor(() => expect(notices()).toHaveLength(1));
    expect(notices()[0]!.textContent).toBe("Pruebas · esta factura no tendrá validez tributaria.");
    await userEvent.setup().click(button("Emitir factura"));
    const dialog = await screen.findByRole("dialog", { name: "Emitir factura" });
    expect(
      within(dialog).getByText("Pruebas · esta factura no tendrá validez tributaria."),
    ).toBeDefined();
  });

  it("Producción: contexto en la confirmación, sin aviso ni presentación de éxito", async () => {
    render(<DraftEditorScreen draftId="draft-1" />, {
      "GET /api/v1/invoices/drafts/draft-1": ok(draft()),
      "GET /api/v1/company/status": status("PRODUCTION"),
    });
    await userEvent.setup().click(await screen.findByRole("button", { name: "Emitir factura" }));
    const dialog = await screen.findByRole("dialog", { name: "Emitir factura" });
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

  it("confirmar dos veces seguidas envía una sola emisión", async () => {
    const keys: string[] = [];
    render(<DraftEditorScreen draftId="draft-1" />, {
      "GET /api/v1/invoices/drafts/draft-1": ok(draft()),
      "POST /api/v1/invoices": (init) => {
        keys.push(new Headers(init.headers).get("Idempotency-Key") ?? "");
        return { status: 201, body: { data: invoice() } };
      },
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Emitir factura" }));
    const dialog = await screen.findByRole("dialog", { name: "Emitir factura" });
    const confirm = within(dialog).getByRole("button", { name: "Emitir factura" });
    await user.dblClick(confirm);
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/facturas/inv-1"));
    expect(keys).toHaveLength(1);
  });
});

describe("formas de pago (spec «Formas de pago en el editor»)", () => {
  it("con una, el importe vacío usa el total; con varias, cada una lleva su importe y quitar es de su fila", async () => {
    render(<DraftEditorScreen draftId="draft-1" />, {
      "GET /api/v1/invoices/drafts/draft-1": ok(draft()),
    });
    await line1();
    expect(screen.getByText("Déjalo vacío para usar el total de la factura")).toBeDefined();
    const user = userEvent.setup();
    await user.click(button("Agregar forma de pago"));
    expect(
      screen.getByText("Cada forma de pago lleva su importe y deben sumar el total."),
    ).toBeDefined();
    expect(screen.queryByText("Déjalo vacío para usar el total de la factura")).toBeNull();
    const second = screen.getByRole("group", { name: "Forma de pago 2" });
    expect(within(second).getByRole("button", { name: "Quitar la forma de pago 2" })).toBeDefined();
    expect(within(second).getByLabelText("Importe")).toBeDefined();
    expect(
      within(screen.getByRole("group", { name: "Forma de pago 1" })).queryByRole("button", {
        name: "Quitar la forma de pago 2",
      }),
    ).toBeNull();
  });
});

describe("cambios sin guardar (D16, PO-3)", () => {
  const beforeUnload = () => {
    const event = new Event("beforeunload", { cancelable: true });
    act(() => {
      window.dispatchEvent(event);
    });
    return event.defaultPrevented;
  };

  it("sin cambios no pide nada; con cambios lo indica y pide confirmar al salir; tras guardar se limpia", async () => {
    render(<DraftEditorScreen draftId="draft-1" />, {
      "GET /api/v1/invoices/drafts/draft-1": ok(draft()),
      "PUT /api/v1/invoices/drafts/draft-1": () => ({
        status: 200,
        body: { data: draft({ version: 2 }) },
      }),
    });
    const line = await line1();
    expect(screen.getAllByText("Guardado").length).toBeGreaterThan(0);
    expect(beforeUnload()).toBe(false);
    const user = userEvent.setup();
    await user.type(within(line).getByLabelText("Cantidad"), "0");
    expect(
      document.querySelector("[data-slot=page-header] [data-slot=draft-state]")?.textContent,
    ).toBe("Cambios sin guardar");
    expect(within(summary()).getByText("Estado: Cambios sin guardar")).toBeDefined();
    expect(beforeUnload()).toBe(true);
    await user.click(button("Guardar borrador"));
    expect(await screen.findByText("Guardaste el borrador.")).toBeDefined();
    await waitFor(() => expect(beforeUnload()).toBe(false));
    expect(screen.getAllByText("Guardado").length).toBeGreaterThan(0);
  });

  it("un guardado fallido conserva el indicador y el aviso al salir", async () => {
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
    expect(within(summary()).getByText("Estado: Cambios sin guardar")).toBeDefined();
    expect(beforeUnload()).toBe(true);
  });

  it("una factura nueva sin tocar no pide confirmar, aunque tome el punto predeterminado", async () => {
    navigation.pathname = "/borradores/nuevo";
    render(<DraftEditorScreen draftId={null} />, {});
    await waitFor(() =>
      expect((screen.getByLabelText("Punto de emisión") as HTMLSelectElement).value).toBe("ep-1"),
    );
    expect(screen.getAllByText("Sin guardar").length).toBeGreaterThan(0);
    expect(beforeUnload()).toBe(false);
  });
});

describe("estados del editor (6.7)", () => {
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
    expect(screen.getByRole("heading", { level: 1, name: "Borrador de factura" })).toBeDefined();
    expect(
      await screen.findByText("No pudimos cargar el borrador.", undefined, { timeout: 5_000 }),
    ).toBeDefined();
    fail = false;
    await userEvent.setup().click(screen.getByRole("button", { name: "Intentar de nuevo" }));
    expect(await line1()).toBeDefined();
  }, 10_000);
});
