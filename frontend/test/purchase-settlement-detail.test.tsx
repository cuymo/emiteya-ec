// Detalle de la liquidación de compra (add-purchase-settlements, tarea 12.3, design D24): el
// proveedor congelado, las cuatro declaraciones "declaradas por" el usuario con su momento y nunca
// verificadas, el aviso de la retención sin presentarla como emitida, las líneas con su unidad y sus
// códigos, el IVA por tarifa, los pagos con su plazo, el reintento de la firma, la transmisión, los
// documentos, la liquidación inexistente y el acceso sin permiso.
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { SessionGate } from "@/components/session";
import { formatDateTime } from "@/features/invoices/invoice-format";
import { PurchaseSettlementDetailScreen } from "@/features/purchase-settlements/purchase-settlement-detail";
import {
  ADMIN_ME,
  OPERATOR_ME,
  errorBody,
  mockApi,
  navigation,
  renderApp,
  type Route,
} from "./harness";
import { SETTLEMENT_KEY, settlementDetail } from "./purchase-settlement-fixtures";
import { TRANSMISSION_TAB, openTab } from "./tabs";

// La política vigente da `purchaseSettlements.read` a los dos roles: se retira para probar el acceso.
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
    ...routes,
  });
  renderApp(<SessionGate fallback={<p>cargando</p>}>{ui}</SessionGate>);
  return calls;
}

const archived = (state: string, ride: string) => ({
  id: "lc-1",
  documentType: "03",
  number: "001-001-000000003",
  issueDate: "2026-10-07",
  buyer: { name: "María Quishpe", identification: "0102030405" },
  total: "106.00",
  recipients: null,
  state,
  transmissionStopped: false,
  documents: {
    ride,
    authorizedXml: state === "AUTHORIZED",
    signedXml: state !== "RESERVED",
  },
  artifacts: [],
  rideGeneration: { status: ride, reason: null, stoppedAt: null, retryable: false },
});

beforeEach(() => {
  navigation.pathname = "/liquidaciones-compra/lc-1";
  navigation.search = new URLSearchParams();
  navigation.push.mockReset();
  permissions.deny.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("detalle de la liquidación de compra", () => {
  it("muestra el proveedor, las declaraciones del usuario, el aviso, las líneas, los pagos con plazo y los totales", async () => {
    render(<PurchaseSettlementDetailScreen purchaseSettlementId="lc-1" />, {
      "GET /api/v1/purchase-settlements/lc-1": ok(
        settlementDetail("AUTHORIZED", {
          authorization: {
            number: SETTLEMENT_KEY,
            authorizedAt: "2026-10-07T15:00:05.000Z",
            environment: "TEST",
          },
        }),
      ),
      "GET /api/v1/documents/lc-1": ok(archived("AUTHORIZED", "AVAILABLE")),
    });
    expect(
      await screen.findByRole("heading", { name: "Liquidación de compra 001-001-000000003" }),
    ).toBeDefined();
    const supplier = screen.getByRole("region", { name: "Proveedor" });
    expect(within(supplier).getByText("María Quishpe")).toBeDefined();
    expect(within(supplier).getByText("Cédula 0102030405")).toBeDefined();
    expect(within(supplier).getByText("Comunidad San Pablo, Cayambe")).toBeDefined();

    // Las cuatro declaraciones, declaradas por el usuario con su momento; nunca verificadas.
    await openTab("Procedencia");
    const origin = screen.getByRole("region", { name: "Procedencia" });
    const declarations = within(origin).getAllByRole("listitem");
    expect(declarations).toHaveLength(4);
    expect(declarations[0]!.textContent).toContain(
      "El proveedor es una persona natural no obligada a llevar contabilidad.",
    );
    for (const item of declarations) {
      expect(item.textContent).toContain(
        `Declarada por Óscar Operador · ${formatDateTime("2026-10-07T15:00:00.000Z")}`,
      );
    }
    expect(within(origin).getByText(/el sistema no puede comprobarlas/)).toBeDefined();
    expect(document.body.textContent).not.toMatch(/verificad/i);

    // El aviso de la retención, sin indicar que la retención exista.
    expect(
      screen.getByText(
        "Esta operación requiere la retención correspondiente conforme a la normativa aplicable.",
      ),
    ).toBeDefined();
    expect(document.body.textContent).not.toMatch(/retención (emitida|asociada|registrada)/i);

    await openTab("Detalle");
    const lines = screen.getByRole("region", { name: "Líneas" });
    expect(within(lines).getByText("Saco de cacao en grano, 45 kg")).toBeDefined();
    expect(within(lines).getByText(/10 saco × \$4,50 · Descuento \$5,00 · IVA 15%/)).toBeDefined();
    expect(within(lines).getByText("Código CAC-01")).toBeDefined();
    expect(within(lines).getByText(/2 × \$30,00 · IVA 0%/)).toBeDefined();
    const payments = screen.getByRole("region", { name: "Pagos" });
    expect(within(payments).getByText("01 · SIN UTILIZACION DEL SISTEMA FINANCIERO")).toBeDefined();
    expect(within(payments).getByText("Plazo 30 días")).toBeDefined();
    expect(within(payments).getByText("$56,00")).toBeDefined();
    const totals = screen.getByRole("complementary", { name: "Totales" });
    expect(within(totals).getByText("Subtotal 15%")).toBeDefined();
    expect(within(totals).getByText("IVA 15 %")).toBeDefined();
    expect(within(totals).getByText("$106,00")).toBeDefined();
    expect(within(totals).getByText(SETTLEMENT_KEY)).toBeDefined();
    await openTab(TRANSMISSION_TAB);
    expect(
      screen.getByText("El SRI autorizó la liquidación: está lista para entregarse."),
    ).toBeDefined();
    await openTab("RIDE y XML");
    expect(await screen.findByRole("button", { name: "Descargar RIDE" })).toBeDefined();
  });

  it("procesando: explica la firma pendiente y reintenta la firma", async () => {
    let state = "RESERVED";
    const calls = render(<PurchaseSettlementDetailScreen purchaseSettlementId="lc-1" />, {
      "GET /api/v1/purchase-settlements/lc-1": () => ({
        status: 200,
        body: { data: settlementDetail(state) },
      }),
      "POST /api/v1/purchase-settlements/lc-1/signing-attempts": () => {
        state = "SIGNED";
        return { status: 200, body: { data: settlementDetail("SIGNED") } };
      },
      "GET /api/v1/documents/lc-1": () => ({ status: 404, body: errorBody("NOT_FOUND", "x") }),
    });
    expect(await screen.findByText(/la firma está en curso o se interrumpió/)).toBeDefined();
    expect(screen.queryByRole("region", { name: "Transmisión al SRI" })).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "Reintentar firma" }));
    expect(await screen.findByText("Firmaste la liquidación 001-001-000000003.")).toBeDefined();
    expect(
      calls.some((call) => call.key === "POST /api/v1/purchase-settlements/lc-1/signing-attempts"),
    ).toBe(true);
    await openTab(TRANSMISSION_TAB);
    expect(
      await screen.findByText("La liquidación está firmada y espera su envío al SRI."),
    ).toBeDefined();
  });

  it("una liquidación inexistente lo explica", async () => {
    render(<PurchaseSettlementDetailScreen purchaseSettlementId="lc-x" />, {
      "GET /api/v1/purchase-settlements/lc-x": () => ({
        status: 404,
        body: errorBody("PURCHASE_SETTLEMENT_NOT_FOUND", "x"),
      }),
    });
    expect(await screen.findByText("La liquidación no existe")).toBeDefined();
  });

  it("sin purchaseSettlements.read explica el acceso y no consulta", async () => {
    permissions.deny.add("purchaseSettlements.read");
    const calls = render(<PurchaseSettlementDetailScreen purchaseSettlementId="lc-1" />, {});
    expect(await screen.findByText("No tienes acceso a Liquidaciones de compra")).toBeDefined();
    expect(calls.some((call) => call.key.startsWith("GET /api/v1/purchase-settlements"))).toBe(
      false,
    );
  });
});
