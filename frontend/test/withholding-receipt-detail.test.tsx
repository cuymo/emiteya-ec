// Detalle del comprobante de retención (add-withholding-receipts, tarea 12.3, design D24): los
// documentos sustento con sus retenciones, impuestos y pagos, la parte relacionada mostrada como
// declarada por el usuario, el total retenido, el reintento de la firma, la transmisión y los
// documentos.
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { SessionGate } from "@/components/session";
import { WithholdingReceiptDetailScreen } from "@/features/withholding-receipts/withholding-receipt-detail";
import {
  ADMIN_ME,
  OPERATOR_ME,
  errorBody,
  mockApi,
  navigation,
  renderApp,
  type Route,
} from "./harness";
import { withholdingDetail } from "./withholding-fixtures";

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
    ...routes,
  });
  renderApp(<SessionGate fallback={<p>cargando</p>}>{ui}</SessionGate>);
  return calls;
}

beforeEach(() => {
  navigation.pathname = "/retenciones/ret-1";
  navigation.search = new URLSearchParams();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("detalle de la retención", () => {
  it("muestra el proveedor, los documentos con sus retenciones, la parte relacionada declarada y el total", async () => {
    render(<WithholdingReceiptDetailScreen withholdingReceiptId="ret-1" />, {
      "GET /api/v1/withholding-receipts/ret-1": ok(
        withholdingDetail("AUTHORIZED", {
          authorization: {
            number: "0610202607179001234500120010010000000041234567811",
            authorizedAt: "2026-10-06T15:00:05.000Z",
            environment: "TEST",
          },
        }),
      ),
      "GET /api/v1/documents/ret-1": ok({
        id: "ret-1",
        documentType: "07",
        number: "001-001-000000004",
        issueDate: "2026-10-06",
        buyer: { name: "PROVEEDORA DEL SUR S.A.", identification: "1791234567001" },
        total: "3.25",
        state: "AUTHORIZED",
        transmissionStopped: false,
        documents: { ride: "AVAILABLE", authorizedXml: true, signedXml: true },
        artifacts: [],
        rideGeneration: { status: "AVAILABLE", reason: null, stoppedAt: null, retryable: false },
      }),
    });
    expect(
      await screen.findByRole("heading", { name: "Retención 001-001-000000004" }),
    ).toBeDefined();
    const supplier = screen.getByRole("region", { name: "Proveedor" });
    expect(within(supplier).getByText("PROVEEDORA DEL SUR S.A.")).toBeDefined();
    const supports = screen.getByRole("region", { name: "Documentos sustento" });
    const card = within(supports).getByRole("listitem", { name: "Factura 001-001-000000123" });
    expect(within(card).getByText(/Sustento 01: Crédito Tributario/)).toBeDefined();
    const rows = within(within(card).getByRole("table")).getAllByRole("row");
    expect(within(rows[1]!).getByText("RENTA 312")).toBeDefined();
    expect(within(rows[1]!).getByText("1,75 %")).toBeDefined();
    expect(within(rows[1]!).getAllByText("USD 1,75").length).toBe(1);
    expect(within(rows[2]!).getByText("IVA 9")).toBeDefined();
    expect(within(rows[2]!).getByText("10 %")).toBeDefined();
    expect(within(rows[2]!).getByText("USD 1,50")).toBeDefined();
    // Los impuestos y pagos declarados del documento, plegados.
    await userEvent.setup().click(within(card).getByText("Totales, impuestos y pagos declarados"));
    expect(within(card).getByText(/IVA · 15% · tarifa 15 · base USD 100,00/)).toBeDefined();
    expect(
      within(card).getByText("Pago: OTROS CON UTILIZACIÓN DEL SISTEMA FINANCIERO"),
    ).toBeDefined();
    const related = screen.getByRole("region", { name: "Parte relacionada" });
    expect(within(related).getByText(/No · Declarada por Óscar Operador/)).toBeDefined();
    expect(within(related).getByText(/el sistema no puede comprobarla/)).toBeDefined();
    const totals = screen.getByRole("complementary", { name: "Totales" });
    expect(within(totals).getByText("Octubre de 2026")).toBeDefined();
    expect(within(totals).getByText("USD 3,25")).toBeDefined();
    expect(
      screen.getByText("El SRI autorizó la retención: está lista para entregarse."),
    ).toBeDefined();
    expect(await screen.findByRole("button", { name: "Descargar RIDE" })).toBeDefined();
  });

  it("procesando: explica la firma pendiente y reintenta la firma", async () => {
    let state = "RESERVED";
    const calls = render(<WithholdingReceiptDetailScreen withholdingReceiptId="ret-1" />, {
      "GET /api/v1/withholding-receipts/ret-1": () => ({
        status: 200,
        body: { data: withholdingDetail(state, {}, { signedAt: null, artifact: null }) },
      }),
      "POST /api/v1/withholding-receipts/ret-1/signing-attempts": () => {
        state = "SIGNED";
        return { status: 200, body: { data: withholdingDetail("SIGNED") } };
      },
      "GET /api/v1/documents/ret-1": () => ({ status: 404, body: errorBody("NOT_FOUND", "x") }),
    });
    expect(await screen.findByText(/la firma está en curso o se interrumpió/)).toBeDefined();
    expect(screen.queryByRole("region", { name: "Transmisión al SRI" })).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "Reintentar firma" }));
    expect(await screen.findByText("Firmaste la retención 001-001-000000004.")).toBeDefined();
    expect(
      calls.some((call) => call.key === "POST /api/v1/withholding-receipts/ret-1/signing-attempts"),
    ).toBe(true);
    expect(
      await screen.findByText("La retención está firmada y espera su envío al SRI."),
    ).toBeDefined();
  });

  it("una retención inexistente lo explica", async () => {
    render(<WithholdingReceiptDetailScreen withholdingReceiptId="ret-x" />, {
      "GET /api/v1/withholding-receipts/ret-x": () => ({
        status: 404,
        body: errorBody("WITHHOLDING_RECEIPT_NOT_FOUND", "x"),
      }),
    });
    expect(await screen.findByText("La retención no existe")).toBeDefined();
  });
});
