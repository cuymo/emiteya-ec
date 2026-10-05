// Notas de crédito, su detalle y el crédito en el detalle de la factura (add-credit-notes, tareas
// 13.1 y 13.3, design D19): carga, vacío, error con reintento, sin permiso, filtros en la URL, los
// borradores en curso, las declaraciones mostradas como declaradas por el usuario, el reintento de
// la firma, la transmisión y los documentos, y "Emitir nota de crédito" solo para una factura elegible
// y con permiso.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { SessionGate } from "@/components/session";
import { CreditNoteDetailScreen } from "@/features/credit-notes/credit-note-detail";
import { CreditNotesScreen } from "@/features/credit-notes/credit-notes-screen";
import { InvoiceCreditSection } from "@/features/credit-notes/invoice-credit-section";
import {
  creditNoteDetail,
  creditNoteDraftSummary,
  creditNoteSummary,
  invoiceCredit,
} from "./credit-note-fixtures";
import {
  ADMIN_ME,
  OPERATOR_ME,
  errorBody,
  mockApi,
  navigation,
  renderApp,
  type Route,
} from "./harness";

const ok =
  (data: unknown): Route =>
  () => ({ status: 200, body: { data } });
const paged =
  (data: unknown[]): Route =>
  () => ({ status: 200, body: { data, meta: { page: 1, pageSize: 25, total: data.length } } });

function render(
  ui: ReactNode,
  routes: Record<string, Route>,
  me: typeof ADMIN_ME | typeof OPERATOR_ME = OPERATOR_ME,
) {
  const calls = mockApi({
    "GET /api/v1/me": () => ({ status: 200, body: { data: me } }),
    "GET /api/v1/credit-notes/drafts": paged([]),
    ...routes,
  });
  renderApp(<SessionGate fallback={<p>cargando</p>}>{ui}</SessionGate>);
  return calls;
}

beforeEach(() => {
  navigation.pathname = "/notas-credito";
  navigation.search = new URLSearchParams();
  navigation.replace.mockReset();
  navigation.push.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pantalla Notas de crédito", () => {
  it("lista número, factura, causa, comprador, valor y estado, con enlace al detalle", async () => {
    render(<CreditNotesScreen />, {
      "GET /api/v1/credit-notes": paged([
        creditNoteSummary(),
        creditNoteSummary({
          id: "nc-2",
          documentNumber: "001-001-000000008",
          cause: "TOTAL_ANNULMENT",
          state: "MANUAL_REVIEW",
          total: "66.00",
        }),
      ]),
    });
    const table = await screen.findByRole("table", { name: "Notas de crédito emitidas" });
    const row = (number: string) =>
      within(table)
        .getAllByRole("row")
        .find((candidate) => within(candidate).queryByText(number))!;
    await within(table).findByText("001-001-000000007");
    expect(within(row("001-001-000000007")).getByRole("link").getAttribute("href")).toBe(
      "/notas-credito/nc-1",
    );
    expect(within(row("001-001-000000007")).getByText("Devolución")).toBeDefined();
    expect(within(row("001-001-000000007")).getByText("001-001-000000001")).toBeDefined();
    expect(within(row("001-001-000000007")).getByText("USD 11,50")).toBeDefined();
    expect(within(row("001-001-000000007")).getByText("Autorizado")).toBeDefined();
    expect(within(row("001-001-000000008")).getByText("Anulación total")).toBeDefined();
    expect(within(row("001-001-000000008")).getByText("Requiere revisión")).toBeDefined();
    expect(screen.getByRole("link", { name: "Nueva nota de crédito" }).getAttribute("href")).toBe(
      "/notas-credito/borradores/nueva",
    );
  });

  it("muestra la carga mientras llegan las notas", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    render(<CreditNotesScreen />, { "GET /api/v1/credit-notes": paged([creditNoteSummary()]) });
    const fetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        if (input.startsWith("/api/v1/credit-notes?")) await gate;
        return fetch(input, init);
      }),
    );
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).not.toBeNull());
    release();
    expect(await screen.findByRole("table", { name: "Notas de crédito emitidas" })).toBeDefined();
  });

  it("vacía ofrece crear la primera; el error se reintenta", async () => {
    let fail = true;
    render(<CreditNotesScreen />, {
      "GET /api/v1/credit-notes": () =>
        fail ? { status: 500, body: errorBody("INTERNAL_ERROR", "x") } : paged([])({}),
    });
    expect(
      (
        await screen.findAllByText("No pudimos cargar las notas de crédito.", undefined, {
          timeout: 5_000,
        })
      ).length,
    ).toBeGreaterThan(0);
    fail = false;
    await userEvent.setup().click(screen.getAllByRole("button", { name: "Intentar de nuevo" })[0]!);
    expect((await screen.findAllByText("Todavía no hay notas de crédito")).length).toBeGreaterThan(
      0,
    );
  });

  it("sin permiso explica el acceso", async () => {
    render(<CreditNotesScreen />, {
      "GET /api/v1/credit-notes": () => ({ status: 403, body: errorBody("FORBIDDEN", "x") }),
    });
    expect(await screen.findByText("No tienes acceso a Notas de crédito")).toBeDefined();
  });

  it("la búsqueda, el estado y la causa viven en la URL y llegan a la API", async () => {
    navigation.search = new URLSearchParams("q=perno&estado=revision&causa=anulacion");
    const calls = render(<CreditNotesScreen />, { "GET /api/v1/credit-notes": paged([]) });
    expect((await screen.findAllByText("No hay notas que coincidan")).length).toBeGreaterThan(0);
    const call = calls.find((entry) => entry.key.startsWith("GET /api/v1/credit-notes?"))!;
    expect(Object.fromEntries(new URLSearchParams(call.key.split("?")[1]))).toMatchObject({
      search: "perno",
      state: "MANUAL_REVIEW",
      cause: "TOTAL_ANNULMENT",
    });
    fireEvent.change(screen.getByLabelText("Causa"), { target: { value: "devolucion" } });
    expect(navigation.replace).toHaveBeenLastCalledWith(
      expect.stringContaining("causa=devolucion"),
      { scroll: false },
    );
    await userEvent.setup().click(screen.getByRole("radio", { name: "Devueltas" }));
    expect(navigation.replace).toHaveBeenLastCalledWith(
      expect.stringContaining("estado=devueltas"),
      { scroll: false },
    );
    await userEvent.setup().click(screen.getAllByRole("button", { name: "Limpiar filtros" })[0]!);
    expect(navigation.replace).toHaveBeenLastCalledWith("/notas-credito", { scroll: false });
  });

  it("muestra los borradores en curso con su enlace y los elimina con confirmación", async () => {
    let drafts = [creditNoteDraftSummary()];
    const calls = render(<CreditNotesScreen />, {
      "GET /api/v1/credit-notes": paged([]),
      "GET /api/v1/credit-notes/drafts": () => paged(drafts)({}),
      "DELETE /api/v1/credit-notes/drafts/cnd-1": () => {
        drafts = [];
        return { status: 204 };
      },
    });
    const panel = await screen.findByRole("region", { name: "Borradores en curso" });
    expect(
      within(panel).getByRole("link", { name: /Devolución de la factura 001-001-000000001/ }),
    ).toHaveProperty("href", expect.stringContaining("/notas-credito/borradores/cnd-1"));
    const user = userEvent.setup();
    await user.click(
      within(panel).getByRole("button", {
        name: "Eliminar el borrador de la factura 001-001-000000001",
      }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Eliminar borrador" });
    await user.click(within(dialog).getByRole("button", { name: "Eliminar" }));
    expect(await screen.findByText("Eliminaste el borrador.")).toBeDefined();
    expect(calls.some((call) => call.key === "DELETE /api/v1/credit-notes/drafts/cnd-1")).toBe(
      true,
    );
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Borradores en curso" })).toBeNull(),
    );
  });
});

describe("detalle de la nota de crédito", () => {
  it("muestra la factura, la causa, las líneas con su retorno y las declaraciones del usuario", async () => {
    render(<CreditNoteDetailScreen creditNoteId="nc-1" />, {
      "GET /api/v1/credit-notes/nc-1": ok(
        creditNoteDetail("AUTHORIZED", {
          authorization: {
            number: "0410202604179001234500120010010000000071234567819",
            authorizedAt: "2026-10-04T15:00:05.000Z",
            environment: "TEST",
          },
        }),
      ),
      "GET /api/v1/documents/nc-1": ok({
        id: "nc-1",
        documentType: "04",
        number: "001-001-000000007",
        issueDate: "2026-10-04",
        buyer: { name: "EL PERNO CIA. LTDA.", identification: "0992877878001" },
        total: "11.50",
        state: "AUTHORIZED",
        transmissionStopped: false,
        documents: { ride: "AVAILABLE", authorizedXml: true, signedXml: true },
        artifacts: [],
        rideGeneration: {
          status: "AVAILABLE",
          reason: null,
          stoppedAt: null,
          retryable: false,
        },
      }),
    });
    expect(
      await screen.findByRole("heading", { name: "Nota de crédito 001-001-000000007" }),
    ).toBeDefined();
    expect(
      screen.getByRole("link", { name: "Factura 001-001-000000001" }).getAttribute("href"),
    ).toBe("/facturas/inv-1");
    expect(screen.getByText("Devolución de mercadería")).toBeDefined();
    expect(screen.getByText("Retorno físico al inventario: 1")).toBeDefined();
    expect(screen.getByText("Su crédito está aplicado en la factura.")).toBeDefined();
    const declarations = screen.getByRole("region", { name: "Declaraciones del usuario" });
    expect(within(declarations).getByText(/Declaradas por Óscar Operador/)).toBeDefined();
    expect(within(declarations).getByText(/el sistema no puede comprobarlas/)).toBeDefined();
    expect(
      within(declarations).getByText(
        "Declaro que esta factura no es una factura comercial negociable que haya sido negociada.",
      ),
    ).toBeDefined();
    expect(
      within(declarations).getByText(
        "Declaro que esta factura no sustentó una solicitud de devolución de impuestos.",
      ),
    ).toBeDefined();
    expect(
      screen.getByText("El SRI autorizó la nota de crédito: está lista para entregarse."),
    ).toBeDefined();
    expect(await screen.findByRole("button", { name: "Descargar RIDE" })).toBeDefined();
    expect(screen.getByText("Valor de la modificación")).toBeDefined();
  });

  it("procesando: explica la firma pendiente, conserva el crédito reservado y reintenta la firma", async () => {
    let state = "RESERVED";
    const calls = render(<CreditNoteDetailScreen creditNoteId="nc-1" />, {
      "GET /api/v1/credit-notes/nc-1": () => ({
        status: 200,
        body: { data: creditNoteDetail(state, {}, { signedAt: null }) },
      }),
      "POST /api/v1/credit-notes/nc-1/signing-attempts": () => {
        state = "SIGNED";
        return { status: 200, body: { data: creditNoteDetail("SIGNED") } };
      },
      "GET /api/v1/documents/nc-1": () => ({ status: 404, body: errorBody("NOT_FOUND", "x") }),
    });
    expect(await screen.findByText(/la firma está en curso o se interrumpió/)).toBeDefined();
    expect(screen.getByText(/Su crédito queda reservado en la factura/)).toBeDefined();
    expect(screen.queryByRole("region", { name: "Transmisión al SRI" })).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "Reintentar firma" }));
    expect(await screen.findByText("Firmaste la nota de crédito 001-001-000000007.")).toBeDefined();
    expect(
      calls.some((call) => call.key === "POST /api/v1/credit-notes/nc-1/signing-attempts"),
    ).toBe(true);
    expect(
      await screen.findByText("La nota de crédito está firmada y espera su envío al SRI."),
    ).toBeDefined();
  });

  it("una nota inexistente lo explica", async () => {
    render(<CreditNoteDetailScreen creditNoteId="nc-x" />, {
      "GET /api/v1/credit-notes/nc-x": () => ({
        status: 404,
        body: errorBody("CREDIT_NOTE_NOT_FOUND", "x"),
      }),
    });
    expect(await screen.findByText("La nota de crédito no existe")).toBeDefined();
  });
});

describe("crédito en el detalle de la factura", () => {
  const AUTHORIZED = { id: "inv-1", state: "AUTHORIZED" as const };

  it("muestra lo aplicado, reservado y disponible con la acción para emitir", async () => {
    render(<InvoiceCreditSection invoice={AUTHORIZED} />, {
      "GET /api/v1/credit-notes/invoices/inv-1/credit": ok(
        invoiceCredit({ applied: "11.50", reserved: "5.75", available: "48.75" }),
      ),
    });
    const section = await screen.findByRole("region", { name: "Notas de crédito" });
    await within(section).findByText("USD 48,75");
    expect(within(section).getByText("USD 11,50")).toBeDefined();
    expect(within(section).getByText("USD 5,75")).toBeDefined();
    expect(
      within(section).getByRole("link", { name: "Emitir nota de crédito" }).getAttribute("href"),
    ).toBe("/notas-credito/borradores/nueva?factura=inv-1");
  });

  it("oculta la acción a consumidor final y sin valor acreditable", async () => {
    render(<InvoiceCreditSection invoice={AUTHORIZED} />, {
      "GET /api/v1/credit-notes/invoices/inv-1/credit": ok(invoiceCredit({ consumerFinal: true })),
    });
    expect(
      await screen.findByText("Es una factura a consumidor final: no admite notas de crédito."),
    ).toBeDefined();
    expect(screen.queryByRole("link", { name: "Emitir nota de crédito" })).toBeNull();
  });

  it("oculta la acción sin valor acreditable", async () => {
    render(<InvoiceCreditSection invoice={AUTHORIZED} />, {
      "GET /api/v1/credit-notes/invoices/inv-1/credit": ok(
        invoiceCredit({ applied: "66.00", available: "0.00", totalAnnulmentAvailable: false }),
      ),
    });
    expect(await screen.findByText("La factura ya no tiene valor acreditable.")).toBeDefined();
    expect(screen.queryByRole("link", { name: "Emitir nota de crédito" })).toBeNull();
  });

  it("sin permiso en la API o sin autorizar, no muestra la sección", async () => {
    render(
      <>
        <p>detalle</p>
        <InvoiceCreditSection invoice={AUTHORIZED} />
      </>,
      {
        "GET /api/v1/credit-notes/invoices/inv-1/credit": () => ({
          status: 403,
          body: errorBody("FORBIDDEN", "x"),
        }),
      },
      ADMIN_ME,
    );
    await screen.findByText("detalle");
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Notas de crédito" })).toBeNull(),
    );
    expect(screen.queryByRole("link", { name: "Emitir nota de crédito" })).toBeNull();
  });

  it("una factura sin autorizar no consulta el crédito", async () => {
    const calls = render(
      <>
        <p>detalle</p>
        <InvoiceCreditSection invoice={{ id: "inv-1", state: "RECEIVED" }} />
      </>,
      {},
    );
    await screen.findByText("detalle");
    expect(screen.queryByRole("region", { name: "Notas de crédito" })).toBeNull();
    expect(calls.some((call) => call.key.includes("/credit"))).toBe(false);
  });
});
