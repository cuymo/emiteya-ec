// Editor de factura (add-invoice-emission, tarea 10.2, design D15): alta con los selectores,
// conflicto de versión y emisión con su confirmación, la Idempotency-Key estable de la misma
// solicitud y el error señalado en su línea. La lista de borradores vive ahora en Facturas
// (unify-drafts-into-document-lists, design D5), con sus pruebas en invoices-list.test.tsx.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DraftEditorScreen } from "@/features/invoices/draft-editor";
import { OPERATOR_ME, errorBody, navigation } from "./harness";

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

beforeEach(() => {
  navigation.pathname = "/borradores";
  navigation.search = new URLSearchParams();
  navigation.replace.mockReset();
  navigation.push.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** «Emitir factura», en cuanto la vista previa del servidor lo deja disponible. */
async function emitButton() {
  const emit = await screen.findByRole("button", { name: "Emitir factura" });
  await waitFor(() => expect(emit).toHaveProperty("disabled", false));
  return emit;
}

describe("editor de factura", () => {
  it("prepara una factura nueva con los selectores y la guarda con importes como texto", async () => {
    const calls = render(<DraftEditorScreen draftId={null} />, {
      "GET /api/v1/parties": paged([CUSTOMER]),
      "GET /api/v1/products": paged([PRODUCT]),
      "POST /api/v1/invoices/drafts": () => ({ status: 201, body: { data: draft() } }),
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Elegir comprador" }));
    const buyerDialog = await screen.findByRole("dialog", { name: "Elegir comprador" });
    await user.click(await within(buyerDialog).findByRole("option", { name: /EL PERNO/ }));
    expect(await screen.findByText("EL PERNO CIA. LTDA.")).toBeDefined();
    expect(await screen.findByText("001 · Av. Amazonas, Quito")).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Agregar producto" }));
    const productDialog = await screen.findByRole("dialog", { name: "Agregar producto" });
    await user.click(await within(productDialog).findByRole("option", { name: /Cemento 50 kg/ }));
    const line = await screen.findByRole("listitem", { name: "Línea 1: Cemento 50 kg" });
    // El precio es el del producto y no se edita.
    expect(within(line).getByText("USD 8,75")).toBeDefined();
    expect(within(line).queryByLabelText(/Precio/)).toBeNull();
    const quantity = within(line).getByLabelText("Cantidad");
    await user.clear(quantity);
    await user.type(quantity, "3");
    await user.type(within(line).getByLabelText("Descuento (USD)"), "1.25");
    await user.click(screen.getByRole("button", { name: "Guardar borrador" }));
    expect(await screen.findByText("Guardaste el borrador.")).toBeDefined();
    const post = calls.find((call) => call.key === "POST /api/v1/invoices/drafts");
    expect(post?.body).toEqual({
      emissionPointId: "ep-1",
      buyerPartyId: "party-1",
      lines: [{ productId: "prod-1", quantity: "3", discount: "1.25" }],
      payments: [{ paymentMethod: "01", amount: null }],
    });
    expect(window.location.pathname).toBe("/borradores/draft-1");
  });

  it("no preselecciona el punto predeterminado si dejó de estar disponible", async () => {
    render(<DraftEditorScreen draftId={null} />, {
      "GET /api/v1/establishments": ok([
        {
          id: "est-1",
          code: "001",
          address: "Av. Amazonas, Quito",
          status: "ACTIVE",
          emissionPoints: [
            { id: "ep-1", code: "001", status: "INACTIVE", available: false },
            { id: "ep-2", code: "002", status: "ACTIVE", available: true },
          ],
        },
      ]),
      "GET /api/v1/me/default-emission-point": ok({
        establishment: {
          id: "est-1",
          code: "001",
          address: "Av. Amazonas, Quito",
          status: "ACTIVE",
        },
        emissionPoint: { id: "ep-1", code: "001", status: "INACTIVE" },
        available: false,
      }),
    });
    const select = (await screen.findByLabelText("Punto de emisión")) as HTMLSelectElement;
    await screen.findByRole("option", { name: /001-002/ });
    expect(select.value).toBe("");
    expect(screen.queryByRole("option", { name: /001-001/ })).toBeNull();
  });

  it("elige el punto entre los del establecimiento elegido (dos selectores dependientes)", async () => {
    render(<DraftEditorScreen draftId={null} />, {
      "GET /api/v1/establishments": ok([
        {
          id: "est-1",
          code: "001",
          address: "Av. Amazonas, Quito",
          status: "ACTIVE",
          emissionPoints: [
            { id: "ep-1", code: "001", status: "ACTIVE", available: true },
            { id: "ep-2", code: "002", status: "ACTIVE", available: true },
          ],
        },
        {
          id: "est-2",
          code: "002",
          address: "Av. 9 de Octubre, Guayaquil",
          status: "ACTIVE",
          emissionPoints: [{ id: "ep-3", code: "001", status: "ACTIVE", available: true }],
        },
      ]),
      "GET /api/v1/me/default-emission-point": ok(null),
    });
    const user = userEvent.setup();
    const establishment = (await screen.findByLabelText("Establecimiento")) as HTMLSelectElement;
    const point = screen.getByLabelText("Punto de emisión") as HTMLSelectElement;
    // Sin establecimiento, el punto espera.
    expect(point.disabled).toBe(true);
    await screen.findByRole("option", { name: "002 · Av. 9 de Octubre, Guayaquil" });
    await user.selectOptions(establishment, "est-1");
    expect(point.disabled).toBe(false);
    expect([...point.options].map((option) => option.textContent)).toEqual([
      "Elige un punto",
      "001-001",
      "001-002",
    ]);
    await user.selectOptions(point, "ep-2");
    // Otro establecimiento con un solo punto: queda elegido.
    await user.selectOptions(establishment, "est-2");
    await waitFor(() => expect(point.value).toBe("ep-3"));
    expect([...point.options].map((option) => option.textContent)).toEqual([
      "Elige un punto",
      "002-001",
    ]);
  });

  it("rechaza una cantidad de 7 decimales sin redondearla ni enviarla", async () => {
    const calls = render(<DraftEditorScreen draftId="draft-1" />, {
      "GET /api/v1/invoices/drafts/draft-1": ok(draft()),
    });
    const user = userEvent.setup();
    const line = await screen.findByRole("listitem", { name: "Línea 1: Cemento 50 kg" });
    const quantity = within(line).getByLabelText("Cantidad");
    await user.clear(quantity);
    await user.type(quantity, "1.1234567");
    await user.click(screen.getByRole("button", { name: "Guardar borrador" }));
    expect(await within(line).findByText("Admite como máximo 6 decimales.")).toBeDefined();
    expect(calls.some((call) => call.key.startsWith("PUT "))).toBe(false);
  });

  it("muestra los totales del servidor y un conflicto de versión con Recargar", async () => {
    render(<DraftEditorScreen draftId="draft-1" />, {
      "GET /api/v1/invoices/drafts/draft-1": ok(draft()),
      "PUT /api/v1/invoices/drafts/draft-1": () => ({
        status: 409,
        body: errorBody(
          "INVOICE_DRAFT_CHANGED",
          "Otro usuario cambió este borrador después de que lo abriste. Recarga para ver sus datos.",
        ),
      }),
    });
    const summary = await screen.findByRole("complementary", { name: "Resumen" });
    expect(await within(summary).findByText("USD 28,75")).toBeDefined();
    expect(within(summary).getByText("IVA 15 %")).toBeDefined();
    expect(within(summary).getByText(/Vista previa sin validez fiscal/)).toBeDefined();
    const user = userEvent.setup();
    const line = screen.getByRole("listitem", { name: "Línea 1: Cemento 50 kg" });
    await user.type(within(line).getByLabelText("Cantidad"), "0");
    await user.click(screen.getByRole("button", { name: "Guardar borrador" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Otro usuario cambió este borrador");
    expect(within(alert).getByRole("button", { name: "Recargar borrador" })).toBeDefined();
  });

  it("muestra los avisos de existencias junto a la última línea del producto, sin bloquear la emisión (add-minimal-inventory)", async () => {
    const line = (position: number, id: string, name: string, quantity: string) => ({
      position,
      product: { id, mainCode: null, name, unitPrice: "8.75", status: "ACTIVE" },
      quantity,
      discount: "0",
    });
    render(<DraftEditorScreen draftId="draft-1" />, {
      "GET /api/v1/invoices/drafts/draft-1": ok(
        draft({
          lines: [
            line(1, "prod-1", "Cemento 50 kg", "3"),
            line(2, "prod-2", "Arena fina", "1"),
            line(3, "prod-1", "Cemento 50 kg", "4"),
          ],
        }),
      ),
      "POST /api/v1/invoices/drafts/preview": ok({
        ...draft().preview,
        lines: [],
        stockWarnings: [
          { code: "STOCK_BELOW_REQUESTED", productId: "prod-1", requested: "7", balance: "5" },
          { code: "STOCK_NOT_INITIALIZED", productId: "prod-2", requested: "1", balance: null },
        ],
      }),
    });
    const third = await screen.findByRole("listitem", { name: "Línea 3: Cemento 50 kg" });
    expect((await within(third).findByRole("note")).textContent).toBe(
      "Aviso de existencias: pides 7 y el saldo contabilizado es 5. Es orientativo y no impide emitir.",
    );
    const first = screen.getByRole("listitem", { name: "Línea 1: Cemento 50 kg" });
    expect(within(first).queryByRole("note")).toBeNull();
    const second = screen.getByRole("listitem", { name: "Línea 2: Arena fina" });
    expect(within(second).getByRole("note").textContent).toContain(
      "este producto todavía no tiene inventario inicializado",
    );
    expect(third.getAttribute("aria-invalid")).toBeNull();
    expect(screen.getByRole("button", { name: "Emitir factura" })).toHaveProperty(
      "disabled",
      false,
    );
  });

  it("emite con la confirmación, el ambiente y la misma Idempotency-Key en el reintento", async () => {
    const keys: string[] = [];
    let attempt = 0;
    render(<DraftEditorScreen draftId="draft-1" />, {
      "GET /api/v1/invoices/drafts/draft-1": ok(draft()),
      "POST /api/v1/invoices": (init) => {
        keys.push(new Headers(init.headers).get("Idempotency-Key") ?? "");
        attempt += 1;
        return attempt === 1
          ? { status: 503, body: errorBody("CRYPTO_UNAVAILABLE", "No disponible.") }
          : { status: 201, body: { data: invoice() } };
      },
    });
    const user = userEvent.setup();
    await user.click(await emitButton());
    let dialog = await screen.findByRole("dialog", { name: "Emitir factura" });
    expect(within(dialog).getByText("Pruebas")).toBeDefined();
    expect(within(dialog).getByText("USD 28,75")).toBeDefined();
    expect(within(dialog).getByText(/EL PERNO CIA. LTDA./)).toBeDefined();
    await user.click(within(dialog).getByRole("button", { name: "Emitir factura" }));
    // El primer intento falla: el aviso queda en el editor.
    expect(await screen.findByRole("alert")).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Emitir factura" }));
    dialog = await screen.findByRole("dialog", { name: "Emitir factura" });
    await user.click(within(dialog).getByRole("button", { name: "Emitir factura" }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/facturas/inv-1"));
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^[!-~]{1,100}$/);
    expect(keys[1]).toBe(keys[0]);
    expect(await screen.findByText("Emitiste la factura 001-001-000000001.")).toBeDefined();
  });

  it("una versión nueva del borrador emite con otra Idempotency-Key", async () => {
    const keys: string[] = [];
    let current = draft();
    render(<DraftEditorScreen draftId="draft-1" />, {
      "GET /api/v1/invoices/drafts/draft-1": () => ({ status: 200, body: { data: current } }),
      "PUT /api/v1/invoices/drafts/draft-1": () => {
        current = draft({ version: 2 });
        return { status: 200, body: { data: current } };
      },
      "POST /api/v1/invoices": (init) => {
        keys.push(new Headers(init.headers).get("Idempotency-Key") ?? "");
        return keys.length === 1
          ? { status: 409, body: errorBody("PRODUCT_INACTIVE", "El producto está desactivado.") }
          : { status: 201, body: { data: invoice() } };
      },
    });
    const user = userEvent.setup();
    await user.click(await emitButton());
    let dialog = await screen.findByRole("dialog", { name: "Emitir factura" });
    await user.click(within(dialog).getByRole("button", { name: "Emitir factura" }));
    expect(await screen.findByRole("alert")).toBeDefined();
    const line = screen.getByRole("listitem", { name: "Línea 1: Cemento 50 kg" });
    const quantity = within(line).getByLabelText("Cantidad");
    await user.clear(quantity);
    await user.type(quantity, "2");
    await user.click(screen.getByRole("button", { name: "Guardar borrador" }));
    expect(await screen.findByText("Guardaste el borrador.")).toBeDefined();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Emitir factura" })).toHaveProperty(
        "disabled",
        false,
      ),
    );
    await user.click(screen.getByRole("button", { name: "Emitir factura" }));
    dialog = await screen.findByRole("dialog", { name: "Emitir factura" });
    await user.click(within(dialog).getByRole("button", { name: "Emitir factura" }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/facturas/inv-1"));
    expect(keys).toHaveLength(2);
    expect(keys[1]).not.toBe(keys[0]);
  });

  it("a consumidor final, la confirmación advierte de sus restricciones", async () => {
    render(<DraftEditorScreen draftId="draft-1" />, {
      "GET /api/v1/invoices/drafts/draft-1": ok(
        draft({
          buyer: {
            id: CONSUMER_FINAL.id,
            identificationType: "07",
            identification: "9999999999999",
            legalName: "CONSUMIDOR FINAL",
            status: "ACTIVE",
            systemRecord: "CONSUMER_FINAL",
          },
        }),
      ),
    });
    await userEvent.setup().click(await emitButton());
    const dialog = await screen.findByRole("dialog", { name: "Emitir factura" });
    expect(within(dialog).getByText(/restricciones para anularse o corregirse/)).toBeDefined();
  });

  it("un rechazo de la emisión vuelve al editor y señala la línea", async () => {
    let rejected = false;
    render(<DraftEditorScreen draftId="draft-1" />, {
      "GET /api/v1/invoices/drafts/draft-1": ok(draft()),
      // Tras el rechazo, la vista previa vuelve a calcularse con lo que cambió.
      "POST /api/v1/invoices/drafts/preview": () =>
        ok(
          rejected
            ? {
                ...draft().preview,
                totals: null,
                issues: [
                  {
                    code: "PRODUCT_INACTIVE",
                    message: "Línea 1: el producto Cemento 50 kg está desactivado.",
                    line: 1,
                    payment: null,
                  },
                ],
              }
            : draft().preview,
        )({}),
      "POST /api/v1/invoices": () => {
        rejected = true;
        return {
          status: 409,
          body: errorBody(
            "PRODUCT_INACTIVE",
            "Línea 1: el producto Cemento 50 kg está desactivado.",
          ),
        };
      },
    });
    const user = userEvent.setup();
    await user.click(await emitButton());
    const dialog = await screen.findByRole("dialog", { name: "Emitir factura" });
    await user.click(within(dialog).getByRole("button", { name: "Emitir factura" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("está desactivado");
    const line = await screen.findByRole("listitem", { name: "Línea 1: Cemento 50 kg" });
    await waitFor(() => expect(line.getAttribute("aria-invalid")).toBe("true"));
    expect(
      within(line).getByText("Línea 1: el producto Cemento 50 kg está desactivado."),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Emitir factura" })).toHaveProperty("disabled", true);
  });

  it("un borrador ya emitido lleva a Facturas", async () => {
    render(<DraftEditorScreen draftId="draft-1" />, {
      "GET /api/v1/invoices/drafts/draft-1": () => ({
        status: 409,
        body: errorBody("INVOICE_DRAFT_ALREADY_EMITTED", "Este borrador ya se emitió."),
      }),
    });
    expect(
      await screen.findByText("Este borrador ya se emitió", undefined, { timeout: 5_000 }),
    ).toBeDefined();
    expect(screen.getByRole("link", { name: "Ver facturas" }).getAttribute("href")).toBe(
      "/facturas",
    );
  }, 10_000);

  it("el operador también emite", async () => {
    render(
      <DraftEditorScreen draftId="draft-1" />,
      { "GET /api/v1/invoices/drafts/draft-1": ok(draft()) },
      OPERATOR_ME,
    );
    expect(await emitButton()).toBeDefined();
  });
});
