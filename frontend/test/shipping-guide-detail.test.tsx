// Detalle de la guía de remisión y "Nueva guía de remisión" en la factura (add-shipping-guides, tarea
// 12.3, design D25): el transporte, todos los destinatarios con su sustento (la factura con su enlace,
// o la excepción declarada por el usuario con su momento) y su detalle, el reintento de la firma, la
// transmisión y los documentos; la acción visible solo con `shippingGuides.draft` en una factura
// autorizada del ambiente vigente, que crea el borrador propuesto y abre el editor.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { SessionGate } from "@/components/session";
import { formatDateTime } from "@/features/invoices/invoice-format";
import { HeaderActionsMenu } from "@/components/layout/header-actions-menu";
import { useInvoiceShippingGuideAction } from "@/features/shipping-guides/invoice-shipping-guide-action";
import { ShippingGuideDetailScreen } from "@/features/shipping-guides/shipping-guide-detail";
import {
  ADMIN_ME,
  OPERATOR_ME,
  errorBody,
  mockApi,
  navigation,
  renderApp,
  type Route,
} from "./harness";
import { guideDetail, guideDraft } from "./shipping-guide-fixtures";
import { TRANSMISSION_TAB, openMoreActions, openTab } from "./tabs";

// La política vigente da `shippingGuides.draft` a los dos roles: se retira para probar la acción oculta.
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

function render(
  ui: ReactNode,
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
    ...routes,
  });
  renderApp(<SessionGate fallback={<p>cargando</p>}>{ui}</SessionGate>);
  return calls;
}

beforeEach(() => {
  navigation.pathname = "/guias-remision/gr-1";
  navigation.search = new URLSearchParams();
  navigation.push.mockReset();
  permissions.deny.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("detalle de la guía", () => {
  it("muestra el transporte y cada destinatario con su sustento y su detalle, sin total monetario", async () => {
    render(<ShippingGuideDetailScreen shippingGuideId="gr-1" />, {
      "GET /api/v1/shipping-guides/gr-1": ok(
        guideDetail("AUTHORIZED", {
          authorization: {
            number: "0610202606179001234500110010010000000051234567817",
            authorizedAt: "2026-10-06T15:00:05.000Z",
            environment: "TEST",
          },
        }),
      ),
      "GET /api/v1/documents/gr-1": ok({
        id: "gr-1",
        documentType: "06",
        number: "001-001-000000005",
        issueDate: "2026-10-06",
        buyer: null,
        total: null,
        recipients: { count: 2, name: null },
        state: "AUTHORIZED",
        transmissionStopped: false,
        documents: { ride: "AVAILABLE", authorizedXml: true, signedXml: true },
        artifacts: [],
        rideGeneration: { status: "AVAILABLE", reason: null, stoppedAt: null, retryable: false },
      }),
    });
    expect(
      await screen.findByRole("heading", { name: "Guía de remisión 001-001-000000005" }),
    ).toBeDefined();
    const transport = screen.getByRole("region", { name: "Transporte" });
    expect(within(transport).getByText("TRANSPORTES ANDINOS S.A.")).toBeDefined();
    expect(within(transport).getByText("Tercero · 1791111111001")).toBeDefined();
    expect(within(transport).getByText("PAA-1234")).toBeDefined();
    expect(within(transport).getByText("Del 06/10/2026 al 07/10/2026")).toBeDefined();
    expect(within(transport).getByText("Desde el establecimiento 001")).toBeDefined();
    await openTab("Destinatarios");
    const recipients = screen.getByRole("region", { name: "Destinatarios" });
    const first = within(recipients).getByRole("listitem", { name: "1. EL PERNO CIA. LTDA." });
    expect(
      within(first).getByRole("link", { name: "001-001-000000123" }).getAttribute("href"),
    ).toBe("/facturas/inv-1");
    const firstTable = within(within(first).getByRole("table"));
    expect(firstTable.getByText("Cemento 50 kg")).toBeDefined();
    expect(firstTable.getByText("CEM-50")).toBeDefined();
    const second = within(recipients).getByRole("listitem", {
      name: "2. EMPRESA DE PRUEBA S.A.",
    });
    expect(within(second).getByText("Establecimiento propio 002")).toBeDefined();
    expect(
      within(second).getByText(/Sin factura: Traslado entre establecimientos propios/),
    ).toBeDefined();
    // La excepción se presenta como declarada por el usuario, con su momento; nunca verificada.
    expect(
      within(second).getByText(
        `Declarada por Óscar Operador · ${formatDateTime("2026-10-06T15:00:00.000Z")}`,
      ),
    ).toBeDefined();
    expect(within(second).getByText(/el sistema no puede comprobarla/)).toBeDefined();
    expect(second.textContent).not.toMatch(/verificad/i);
    expect(within(within(second).getByRole("table")).getByText("Varilla 12 mm")).toBeDefined();
    const summary = screen.getByRole("complementary", { name: "Resumen" });
    expect(within(summary).getByText("2 destinatarios")).toBeDefined();
    expect(within(summary).queryByText(/USD/)).toBeNull();
    await openTab(TRANSMISSION_TAB);
    expect(screen.getByText("El SRI autorizó la guía: está lista para entregarse.")).toBeDefined();
    await openTab("RIDE y XML");
    expect(await screen.findByRole("button", { name: "Descargar RIDE" })).toBeDefined();
  });

  it("procesando: explica la firma pendiente y reintenta la firma", async () => {
    let state = "RESERVED";
    const calls = render(<ShippingGuideDetailScreen shippingGuideId="gr-1" />, {
      "GET /api/v1/shipping-guides/gr-1": () => ({
        status: 200,
        body: { data: guideDetail(state) },
      }),
      "POST /api/v1/shipping-guides/gr-1/signing-attempts": () => {
        state = "SIGNED";
        return { status: 200, body: { data: guideDetail("SIGNED") } };
      },
      "GET /api/v1/documents/gr-1": () => ({ status: 404, body: errorBody("NOT_FOUND", "x") }),
    });
    expect(await screen.findByText(/la firma está en curso o se interrumpió/)).toBeDefined();
    expect(screen.queryByRole("region", { name: "Transmisión al SRI" })).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "Reintentar firma" }));
    expect(await screen.findByText("Firmaste la guía 001-001-000000005.")).toBeDefined();
    expect(
      calls.some((call) => call.key === "POST /api/v1/shipping-guides/gr-1/signing-attempts"),
    ).toBe(true);
    await openTab(TRANSMISSION_TAB);
    expect(await screen.findByText("La guía está firmada y espera su envío al SRI.")).toBeDefined();
  });

  it("una guía inexistente lo explica", async () => {
    render(<ShippingGuideDetailScreen shippingGuideId="gr-x" />, {
      "GET /api/v1/shipping-guides/gr-x": () => ({
        status: 404,
        body: errorBody("SHIPPING_GUIDE_NOT_FOUND", "x"),
      }),
    });
    expect(await screen.findByText("La guía no existe")).toBeDefined();
  });
});

describe("Nueva guía de remisión en el detalle de la factura", () => {
  const invoice = (overrides: Record<string, unknown> = {}) =>
    ({
      id: "inv-1",
      state: "AUTHORIZED",
      environment: "TEST",
      ...overrides,
    }) as Parameters<typeof useInvoiceShippingGuideAction>[0];
  /** La opción en el menú de más acciones, como en el encabezado del detalle. */
  function Menu({ overrides }: { overrides: Record<string, unknown> }) {
    const { action, pending } = useInvoiceShippingGuideAction(invoice(overrides));
    return (
      <HeaderActionsMenu label="Más acciones" actions={action ? [action] : []} busy={pending} />
    );
  }
  const actionFor = (overrides: Record<string, unknown> = {}) => (
    <>
      <p>detalle</p>
      <Menu overrides={overrides} />
    </>
  );

  it("una factura autorizada del ambiente vigente crea el borrador propuesto y abre el editor", async () => {
    let created: unknown;
    render(actionFor(), {
      "POST /api/v1/shipping-guides/drafts": (init) => {
        created = JSON.parse(init.body as string);
        return { status: 201, body: { data: guideDraft() } };
      },
    });
    const menu = await openMoreActions();
    await userEvent
      .setup()
      .click(within(menu).getByRole("menuitem", { name: "Nueva guía de remisión" }));
    await waitFor(() =>
      expect(navigation.push).toHaveBeenCalledWith("/guias-remision/borradores/grd-1"),
    );
    expect(created).toEqual({ fromInvoiceId: "inv-1" });
    expect(
      await screen.findByText("Preparaste la guía de remisión desde la factura."),
    ).toBeDefined();
  });

  it.each([
    ["sin autorizar", { state: "RECEIVED" }],
    ["de otro ambiente", { environment: "PRODUCTION" }],
  ])("se oculta para una factura %s", async (_case, overrides) => {
    const calls = render(actionFor(overrides), {});
    await screen.findByText("detalle");
    await waitFor(() =>
      expect(calls.some((call) => call.key === "GET /api/v1/company/status")).toBe(true),
    );
    expect(screen.queryByRole("button", { name: /^Más acciones/ })).toBeNull();
  });

  it("sin shippingGuides.draft no se ofrece", async () => {
    permissions.deny.add("shippingGuides.draft");
    render(actionFor(), {});
    await screen.findByText("detalle");
    expect(screen.queryByRole("button", { name: /^Más acciones/ })).toBeNull();
  });
});
