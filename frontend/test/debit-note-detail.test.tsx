// Detalle de la nota de débito y su acción en el detalle de la factura (add-debit-notes, tarea 11.3,
// design D23): conceptos con causa y tratamiento, la declaración mostrada como declarada por el
// usuario, la forma de pago del snapshot, el reintento de la firma, la transmisión y los documentos,
// y "Emitir nota de débito" oculta para una factura no elegible o sin permiso.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { SessionGate } from "@/components/session";
import { DebitNoteDetailScreen } from "@/features/debit-notes/debit-note-detail";
import { InvoiceDebitNoteAction } from "@/features/debit-notes/invoice-debit-note-action";
import { InvoiceDetailScreen } from "@/features/invoices/invoice-detail";
import { authorizedInvoice, debitNoteDetail } from "./debit-note-fixtures";
import { TRANSMISSION_TAB, openTab } from "./tabs";
import {
  ADMIN_ME,
  OPERATOR_ME,
  errorBody,
  mockApi,
  navigation,
  renderApp,
  type Route,
} from "./harness";

// La política vigente da `debitNotes.draft` a los dos roles: se retira para probar la acción oculta.
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
const COMPANY_STATUS = ok({
  environment: "TEST",
  displayName: "COMERCIAL ANDINA S.A.",
  readiness: { ready: true, checks: [] },
});

function render(
  ui: ReactNode,
  routes: Record<string, Route>,
  me: typeof ADMIN_ME | typeof OPERATOR_ME = OPERATOR_ME,
) {
  const calls = mockApi({
    "GET /api/v1/me": () => ({ status: 200, body: { data: me } }),
    "GET /api/v1/company/status": COMPANY_STATUS,
    ...routes,
  });
  renderApp(<SessionGate fallback={<p>cargando</p>}>{ui}</SessionGate>);
  return calls;
}

beforeEach(() => {
  navigation.pathname = "/notas-debito/nd-1";
  navigation.search = new URLSearchParams();
});

afterEach(() => {
  permissions.deny.clear();
  vi.unstubAllGlobals();
});

describe("detalle de la nota de débito", () => {
  it("muestra la factura, los conceptos, los impuestos por tratamiento, la forma de pago y la declaración del usuario", async () => {
    render(<DebitNoteDetailScreen debitNoteId="nd-1" />, {
      "GET /api/v1/debit-notes/nd-1": ok(
        debitNoteDetail("AUTHORIZED", {
          authorization: {
            number: "0910202605179001234500120010010000000031234567815",
            authorizedAt: "2026-10-09T15:00:05.000Z",
            environment: "TEST",
          },
        }),
      ),
      "GET /api/v1/documents/nd-1": ok({
        id: "nd-1",
        documentType: "05",
        number: "001-001-000000003",
        issueDate: "2026-10-09",
        buyer: { name: "EL PERNO CIA. LTDA.", identification: "0992877878001" },
        total: "28.00",
        recipients: null,
        state: "AUTHORIZED",
        transmissionStopped: false,
        documents: { ride: "AVAILABLE", authorizedXml: true, signedXml: true },
        artifacts: [],
        rideGeneration: { status: "AVAILABLE", reason: null, stoppedAt: null, retryable: false },
      }),
    });
    expect(
      await screen.findByRole("heading", { name: "Nota de débito 001-001-000000003" }),
    ).toBeDefined();
    expect(
      screen.getByRole("link", { name: "Factura 001-001-000000001" }).getAttribute("href"),
    ).toBe("/facturas/inv-1");
    const concepts = screen.getByRole("region", { name: "Conceptos" });
    const items = within(concepts).getAllByRole("listitem");
    expect(within(items[0]!).getByText("Intereses por 30 días de mora")).toBeDefined();
    expect(within(items[0]!).getByText("Intereses de mora · IVA 15 %")).toBeDefined();
    expect(within(items[0]!).getByText("USD 20,00")).toBeDefined();
    expect(
      within(items[1]!).getByText("Costos o gastos posteriores a la factura · IVA 0 %"),
    ).toBeDefined();
    const totals = screen.getByRole("complementary", { name: "Totales" });
    expect(within(totals).getByText("Base IVA 15 %")).toBeDefined();
    expect(within(totals).getByText("USD 3,00")).toBeDefined();
    expect(
      within(totals).getByText("OTROS CON UTILIZACIÓN DEL SISTEMA FINANCIERO ·", { exact: false }),
    ).toBeDefined();
    await openTab("Declaración");
    const declaration = screen.getByRole("region", { name: "Declaración del usuario" });
    expect(within(declaration).getByText(/Declarada por Óscar Operador/)).toBeDefined();
    expect(within(declaration).getByText(/el sistema no puede comprobarla/)).toBeDefined();
    expect(
      within(declaration).getByText(
        "Declaro que esta factura no es una factura comercial negociable que haya sido efectivamente negociada.",
      ),
    ).toBeDefined();
    await openTab(TRANSMISSION_TAB);
    expect(
      screen.getByText("El SRI autorizó la nota de débito: está lista para entregarse."),
    ).toBeDefined();
    await openTab("RIDE y XML");
    expect(await screen.findByRole("button", { name: "Descargar RIDE" })).toBeDefined();
  });

  it("procesando: explica la firma pendiente y reintenta la firma", async () => {
    let state = "RESERVED";
    const calls = render(<DebitNoteDetailScreen debitNoteId="nd-1" />, {
      "GET /api/v1/debit-notes/nd-1": () => ({
        status: 200,
        body: { data: debitNoteDetail(state, {}, { signedAt: null, artifact: null }) },
      }),
      "POST /api/v1/debit-notes/nd-1/signing-attempts": () => {
        state = "SIGNED";
        return { status: 200, body: { data: debitNoteDetail("SIGNED") } };
      },
      "GET /api/v1/documents/nd-1": () => ({ status: 404, body: errorBody("NOT_FOUND", "x") }),
    });
    expect(await screen.findByText(/la firma está en curso o se interrumpió/)).toBeDefined();
    expect(screen.queryByRole("region", { name: "Transmisión al SRI" })).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "Reintentar firma" }));
    expect(await screen.findByText("Firmaste la nota de débito 001-001-000000003.")).toBeDefined();
    expect(
      calls.some((call) => call.key === "POST /api/v1/debit-notes/nd-1/signing-attempts"),
    ).toBe(true);
    await openTab(TRANSMISSION_TAB);
    expect(
      await screen.findByText("La nota de débito está firmada y espera su envío al SRI."),
    ).toBeDefined();
  });

  it("una nota inexistente lo explica", async () => {
    render(<DebitNoteDetailScreen debitNoteId="nd-x" />, {
      "GET /api/v1/debit-notes/nd-x": () => ({
        status: 404,
        body: errorBody("DEBIT_NOTE_NOT_FOUND", "x"),
      }),
    });
    expect(await screen.findByText("La nota de débito no existe")).toBeDefined();
  });
});

describe("Emitir nota de débito en el detalle de la factura", () => {
  const actionFor = (overrides: Record<string, unknown> = {}) => {
    const invoice = authorizedInvoice(overrides) as unknown as Parameters<
      typeof InvoiceDebitNoteAction
    >[0]["invoice"];
    return (
      <>
        <p>detalle</p>
        <InvoiceDebitNoteAction invoice={invoice} />
      </>
    );
  };

  it("una factura autorizada, identificada y del ambiente vigente ofrece la acción", async () => {
    render(actionFor(), {});
    expect(
      (await screen.findByRole("link", { name: "Emitir nota de débito" })).getAttribute("href"),
    ).toBe("/notas-debito/borradores/nueva?factura=inv-1");
  });

  it.each([
    ["sin autorizar", { state: "RECEIVED" }],
    [
      "a consumidor final",
      {
        buyer: {
          identificationType: "07",
          identification: "9999999999999",
          legalName: "CONSUMIDOR FINAL",
          address: null,
          consumerFinal: true,
        },
      },
    ],
    ["de otro ambiente", { environment: "PRODUCTION" }],
  ])("se oculta para una factura %s", async (_case, overrides) => {
    const calls = render(actionFor(overrides), {});
    await screen.findByText("detalle");
    await waitFor(() =>
      expect(calls.some((call) => call.key === "GET /api/v1/company/status")).toBe(true),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole("link", { name: "Emitir nota de débito" })).toBeNull();
  });

  it("se oculta sin permiso para preparar notas de débito", async () => {
    permissions.deny.add("debitNotes.draft");
    render(actionFor(), {});
    await screen.findByText("detalle");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole("link", { name: "Emitir nota de débito" })).toBeNull();
  });

  it("el detalle de una factura autorizada la ofrece junto a su encabezado", async () => {
    render(<InvoiceDetailScreen invoiceId="inv-1" />, {
      "GET /api/v1/invoices/inv-1": ok(authorizedInvoice()),
    });
    expect(
      await screen.findByRole("heading", { level: 1, name: "Factura 001-001-000000001" }),
    ).toBeDefined();
    expect(
      (await screen.findByRole("link", { name: "Emitir nota de débito" })).getAttribute("href"),
    ).toBe("/notas-debito/borradores/nueva?factura=inv-1");
  });

  it("sin el estado de la empresa no se ofrece", async () => {
    render(actionFor(), {
      "GET /api/v1/company/status": () => ({ status: 500, body: errorBody("INTERNAL_ERROR", "x") }),
    });
    await screen.findByText("detalle");
    await waitFor(() =>
      expect(screen.queryByRole("link", { name: "Emitir nota de débito" })).toBeNull(),
    );
  });
});
