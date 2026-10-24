// Comprobantes, la bandeja documental (add-document-archive, tarea 10.2, design D13): carga, vacío,
// sin coincidencias, error, sin permiso, filtros en la URL, rango inválido y descarga del RIDE; con
// la nota de crédito (add-credit-notes, tarea 12.1, design D15), la nota de débito (add-debit-notes,
// tarea 10.1, design D19), el comprobante de retención (add-withholding-receipts, tarea 11.1, design
// D20), la guía de remisión (add-shipping-guides, tarea 11.1, design D21) y la liquidación de compra
// (add-purchase-settlements, tarea 11.1, design D20): el filtro de tipo en la URL, el tipo bajo el
// número, la contraparte (el proveedor, rotulado "Proveedor", en la liquidación) y el enlace al
// detalle según el tipo. Con el correo (add-email-delivery, tarea 11.1): el filtro «Correo» en la URL
// y el indicador del último envío en la fila y en la tarjeta.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionGate } from "@/components/session";
import { DocumentsScreen } from "@/features/archive/documents-screen";
import {
  ADMIN_ME,
  OPERATOR_ME,
  chooseDate,
  errorBody,
  mockApi,
  navigation,
  renderApp,
  type Route,
} from "./harness";
import { chooseFilter } from "./filters";

const item = (overrides: Record<string, unknown> = {}) => ({
  id: "doc-1",
  documentType: "01",
  number: "001-001-000000001",
  issueDate: "2026-10-04",
  buyer: { name: "EL PERNO CIA. LTDA.", identification: "0992877878001" },
  total: "28.75",
  recipients: null,
  state: "AUTHORIZED",
  transmissionStopped: false,
  documents: { ride: "AVAILABLE", authorizedXml: true, signedXml: true },
  ...overrides,
});
const paged =
  (data: unknown[]): Route =>
  () => ({ status: 200, body: { data, meta: { page: 1, pageSize: 25, total: data.length } } });
const ESTABLISHMENTS = [
  {
    id: "est-1",
    code: "001",
    address: "Quito",
    status: "ACTIVE",
    emissionPoints: [{ id: "pto-1", code: "001", status: "ACTIVE", available: true }],
  },
];

function render(
  routes: Record<string, Route>,
  me: typeof ADMIN_ME | typeof OPERATOR_ME = OPERATOR_ME,
) {
  const calls = mockApi({
    "GET /api/v1/me": () => ({ status: 200, body: { data: me } }),
    "GET /api/v1/establishments": () => ({ status: 200, body: { data: ESTABLISHMENTS } }),
    ...routes,
  });
  renderApp(
    <SessionGate fallback={<p>cargando</p>}>
      <DocumentsScreen />
    </SessionGate>,
  );
  return calls;
}

beforeEach(() => {
  navigation.pathname = "/comprobantes";
  navigation.search = new URLSearchParams();
  navigation.replace.mockReset();
  vi.stubGlobal(
    "URL",
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:ride"), revokeObjectURL: vi.fn() }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Comprobantes", () => {
  it("lista los comprobantes con su estado y el RIDE disponible, en preparación o detenido", async () => {
    render({
      "GET /api/v1/documents": paged([
        item(),
        item({
          id: "doc-2",
          number: "001-001-000000002",
          documents: { ride: "PENDING", authorizedXml: false, signedXml: true },
        }),
        item({
          id: "doc-3",
          number: "001-001-000000003",
          documents: { ride: "STOPPED", authorizedXml: false, signedXml: true },
        }),
        item({
          id: "doc-4",
          number: "001-001-000000004",
          state: "SIGNED",
          documents: { ride: "NOT_APPLICABLE", authorizedXml: false, signedXml: true },
        }),
      ]),
    });
    const table = await screen.findByRole("table", { name: "Comprobantes emitidos" });
    await within(table).findByText("001-001-000000001");
    const row = (number: string) =>
      within(table)
        .getAllByRole("row")
        .find((candidate) => within(candidate).queryByText(number))!;
    expect(
      within(row("001-001-000000001")).getByRole("button", {
        name: "Descargar el RIDE de 001-001-000000001",
      }),
    ).toBeDefined();
    expect(within(row("001-001-000000001")).getByText("Autorizado")).toBeDefined();
    expect(within(row("001-001-000000002")).getByText("En preparación")).toBeDefined();
    expect(within(row("001-001-000000003")).getByText("Detenido")).toBeDefined();
    expect(within(row("001-001-000000004")).queryByRole("button")).toBeNull();
    expect(within(row("001-001-000000001")).getByRole("link").getAttribute("href")).toBe(
      "/facturas/doc-1",
    );
    expect(within(row("001-001-000000001")).getByText("Factura")).toBeDefined();
  });

  it("la nota de crédito muestra su tipo bajo el número y enlaza a su detalle", async () => {
    render({
      "GET /api/v1/documents": paged([
        item(),
        item({ id: "nc-1", documentType: "04", number: "001-001-000000007", total: "11.50" }),
      ]),
    });
    const table = await screen.findByRole("table", { name: "Comprobantes emitidos" });
    await within(table).findByText("001-001-000000007");
    const row = (number: string) =>
      within(table)
        .getAllByRole("row")
        .find((candidate) => within(candidate).queryByText(number))!;
    expect(within(row("001-001-000000007")).getByText("Nota de crédito")).toBeDefined();
    expect(within(row("001-001-000000007")).getByRole("link").getAttribute("href")).toBe(
      "/notas-credito/nc-1",
    );
    expect(within(row("001-001-000000001")).getByRole("link").getAttribute("href")).toBe(
      "/facturas/doc-1",
    );
    expect(
      within(row("001-001-000000007")).getByRole("button", {
        name: "Descargar el RIDE de 001-001-000000007",
      }),
    ).toBeDefined();
  });

  it("la nota de débito muestra su tipo bajo el número y enlaza a su detalle", async () => {
    render({
      "GET /api/v1/documents": paged([
        item(),
        item({ id: "nd-1", documentType: "05", number: "001-001-000000003", total: "23.00" }),
      ]),
    });
    const table = await screen.findByRole("table", { name: "Comprobantes emitidos" });
    await within(table).findByText("001-001-000000003");
    const row = (number: string) =>
      within(table)
        .getAllByRole("row")
        .find((candidate) => within(candidate).queryByText(number))!;
    expect(within(row("001-001-000000003")).getByText("Nota de débito")).toBeDefined();
    expect(within(row("001-001-000000003")).getByRole("link").getAttribute("href")).toBe(
      "/notas-debito/nd-1",
    );
    expect(
      within(row("001-001-000000003")).getByRole("button", {
        name: "Descargar el RIDE de 001-001-000000003",
      }),
    ).toBeDefined();
  });

  it("la retención muestra su tipo, el total retenido y el sujeto, y enlaza a su detalle", async () => {
    render({
      "GET /api/v1/documents": paged([
        item(),
        item({
          id: "ret-1",
          documentType: "07",
          number: "001-001-000000004",
          buyer: { name: "PROVEEDORA DEL SUR S.A.", identification: "1791234567001" },
          total: "3.25",
          recipients: null,
          state: "SIGNED",
          documents: { ride: "NOT_APPLICABLE", authorizedXml: false, signedXml: true },
        }),
      ]),
    });
    const table = await screen.findByRole("table", { name: "Comprobantes emitidos" });
    await within(table).findByText("001-001-000000004");
    const row = within(table)
      .getAllByRole("row")
      .find((candidate) => within(candidate).queryByText("001-001-000000004"))!;
    expect(within(row).getByText("Comprobante de retención")).toBeDefined();
    expect(within(row).getByText("PROVEEDORA DEL SUR S.A.")).toBeDefined();
    expect(within(row).getByText("$3,25")).toBeDefined();
    expect(within(row).getByRole("link").getAttribute("href")).toBe("/retenciones/ret-1");
    // Firmada sin autorizar: no hay RIDE que descargar.
    expect(
      within(row).queryByRole("button", { name: "Descargar el RIDE de 001-001-000000004" }),
    ).toBeNull();
  });

  it("una guía sin total muestra su único destinatario o el número de destinatarios (P10)", async () => {
    const guide = (overrides: Record<string, unknown>) =>
      item({
        documentType: "06",
        buyer: null,
        total: null,
        state: "SIGNED",
        documents: { ride: "NOT_APPLICABLE", authorizedXml: false, signedXml: true },
        ...overrides,
      });
    render({
      "GET /api/v1/documents": paged([
        guide({
          id: "gr-1",
          number: "001-001-000000005",
          recipients: { count: 1, name: "María Pérez" },
        }),
        guide({ id: "gr-2", number: "001-001-000000006", recipients: { count: 3, name: null } }),
      ]),
    });
    const table = await screen.findByRole("table", { name: "Comprobantes emitidos" });
    const rowOf = async (number: string) => {
      await within(table).findByText(number);
      return within(table)
        .getAllByRole("row")
        .find((candidate) => within(candidate).queryByText(number))!;
    };
    const single = await rowOf("001-001-000000005");
    expect(within(single).getByText("María Pérez")).toBeDefined();
    expect(within(single).getByText("Sin total monetario")).toBeDefined();
    expect(within(single).queryByText(/USD/)).toBeNull();
    const several = await rowOf("001-001-000000006");
    expect(within(several).getByText("3 destinatarios")).toBeDefined();
    expect(within(several).getByText("Sin total monetario")).toBeDefined();
    expect(within(several).queryByText("USD 0,00")).toBeNull();
  });

  it("la guía muestra su tipo bajo el número, enlaza a su detalle y ofrece su RIDE autorizada", async () => {
    render({
      "GET /api/v1/documents": paged([
        item({
          id: "gr-1",
          documentType: "06",
          number: "001-001-000000005",
          buyer: null,
          total: null,
          recipients: { count: 2, name: null },
        }),
        item({
          id: "gr-2",
          documentType: "06",
          number: "001-001-000000006",
          buyer: null,
          total: null,
          recipients: { count: 1, name: "María Pérez" },
          state: "SIGNED",
          documents: { ride: "NOT_APPLICABLE", authorizedXml: false, signedXml: true },
        }),
      ]),
    });
    const table = await screen.findByRole("table", { name: "Comprobantes emitidos" });
    await within(table).findByText("001-001-000000005");
    const row = (number: string) =>
      within(table)
        .getAllByRole("row")
        .find((candidate) => within(candidate).queryByText(number))!;
    const authorized = row("001-001-000000005");
    expect(within(authorized).getByText("Guía de remisión")).toBeDefined();
    expect(within(authorized).getByText("2 destinatarios")).toBeDefined();
    expect(within(authorized).getByRole("link").getAttribute("href")).toBe("/guias-remision/gr-1");
    expect(
      within(authorized).getByRole("button", { name: "Descargar el RIDE de 001-001-000000005" }),
    ).toBeDefined();
    // Firmada sin autorizar: no hay RIDE que descargar.
    const signed = row("001-001-000000006");
    expect(within(signed).getByRole("link").getAttribute("href")).toBe("/guias-remision/gr-2");
    expect(
      within(signed).queryByRole("button", { name: "Descargar el RIDE de 001-001-000000006" }),
    ).toBeNull();
  });

  it("la liquidación muestra su tipo, su proveedor rotulado y su importe, enlaza a su detalle y ofrece su RIDE autorizada", async () => {
    const settlement = (overrides: Record<string, unknown>) =>
      item({
        documentType: "03",
        buyer: { name: "María Quishpe", identification: "0102030405" },
        total: "106.00",
        ...overrides,
      });
    render({
      "GET /api/v1/documents": paged([
        settlement({ id: "lc-1", number: "001-001-000000003" }),
        settlement({
          id: "lc-2",
          number: "001-001-000000008",
          state: "SIGNED",
          documents: { ride: "NOT_APPLICABLE", authorizedXml: false, signedXml: true },
        }),
      ]),
    });
    const table = await screen.findByRole("table", { name: "Comprobantes emitidos" });
    await within(table).findByText("001-001-000000003");
    const row = (number: string) =>
      within(table)
        .getAllByRole("row")
        .find((candidate) => within(candidate).queryByText(number))!;
    const authorized = row("001-001-000000003");
    expect(within(authorized).getByText("Liquidación de compra")).toBeDefined();
    expect(within(authorized).getByText("María Quishpe")).toBeDefined();
    // La contraparte es el proveedor, nunca un comprador.
    expect(within(authorized).getByText("Proveedor · 0102030405")).toBeDefined();
    expect(within(authorized).queryByText(/Comprador/)).toBeNull();
    expect(within(authorized).getByText("$106,00")).toBeDefined();
    expect(within(authorized).getByRole("link").getAttribute("href")).toBe(
      "/liquidaciones-compra/lc-1",
    );
    expect(
      within(authorized).getByRole("button", { name: "Descargar el RIDE de 001-001-000000003" }),
    ).toBeDefined();
    // Firmada sin autorizar: no hay RIDE que descargar.
    const signed = row("001-001-000000008");
    expect(within(signed).getByRole("link").getAttribute("href")).toBe(
      "/liquidaciones-compra/lc-2",
    );
    expect(
      within(signed).queryByRole("button", { name: "Descargar el RIDE de 001-001-000000008" }),
    ).toBeNull();
  });

  it("la bandeja muestra los seis tipos con su tipo bajo el número", async () => {
    render({
      "GET /api/v1/documents": paged([
        item(),
        item({ id: "lc-1", documentType: "03", number: "001-001-000000006" }),
        item({ id: "nc-1", documentType: "04", number: "001-001-000000002" }),
        item({ id: "nd-1", documentType: "05", number: "001-001-000000003" }),
        item({ id: "ret-1", documentType: "07", number: "001-001-000000004" }),
        item({
          id: "gr-1",
          documentType: "06",
          number: "001-001-000000005",
          buyer: null,
          total: null,
          recipients: { count: 1, name: "María Pérez" },
        }),
      ]),
    });
    const table = await screen.findByRole("table", { name: "Comprobantes emitidos" });
    await within(table).findByText("001-001-000000004");
    const typeOf = (number: string) =>
      within(
        within(table)
          .getAllByRole("row")
          .find((candidate) => within(candidate).queryByText(number))!,
      );
    expect(typeOf("001-001-000000001").getByText("Factura")).toBeDefined();
    expect(typeOf("001-001-000000002").getByText("Nota de crédito")).toBeDefined();
    expect(typeOf("001-001-000000003").getByText("Nota de débito")).toBeDefined();
    expect(typeOf("001-001-000000004").getByText("Comprobante de retención")).toBeDefined();
    expect(typeOf("001-001-000000005").getByText("Guía de remisión")).toBeDefined();
    expect(typeOf("001-001-000000006").getByText("Liquidación de compra")).toBeDefined();
  });

  it("el filtro de tipo vive en la URL y llega a la API", async () => {
    navigation.search = new URLSearchParams("tipo=04");
    const calls = render({ "GET /api/v1/documents": paged([]) });
    expect(
      (await screen.findAllByText("No hay comprobantes que coincidan")).length,
    ).toBeGreaterThan(0);
    const call = calls.find((entry) => entry.key.startsWith("GET /api/v1/documents?"))!;
    expect(new URLSearchParams(call.key.split("?")[1]).get("documentType")).toBe("04");
    const type = screen.getByRole("combobox", { name: "Tipo" });
    expect(type.textContent).toContain("Nota de crédito");
    await userEvent.setup().click(type);
    expect((await screen.findAllByRole("option")).map((option) => option.textContent)).toEqual([
      "Todos",
      "Factura",
      "Liquidación de compra",
      "Nota de crédito",
      "Nota de débito",
      "Guía de remisión",
      "Comprobante de retención",
    ]);
    await userEvent.setup().click(screen.getByRole("option", { name: "Liquidación de compra" }));
    expect(navigation.replace).toHaveBeenLastCalledWith("/comprobantes?tipo=03", {
      scroll: false,
    });
    await chooseFilter("Tipo", "Guía de remisión");
    expect(navigation.replace).toHaveBeenLastCalledWith("/comprobantes?tipo=06", {
      scroll: false,
    });
    await chooseFilter("Tipo", "Comprobante de retención");
    expect(navigation.replace).toHaveBeenLastCalledWith("/comprobantes?tipo=07", {
      scroll: false,
    });
    await chooseFilter("Tipo", "Factura");
    expect(navigation.replace).toHaveBeenLastCalledWith("/comprobantes?tipo=01", {
      scroll: false,
    });
    await chooseFilter("Tipo", "Todos");
    expect(navigation.replace).toHaveBeenLastCalledWith("/comprobantes", { scroll: false });
  });

  it("un tipo desconocido en la URL no filtra", async () => {
    navigation.search = new URLSearchParams("tipo=99");
    const calls = render({ "GET /api/v1/documents": paged([item()]) });
    await screen.findAllByText("001-001-000000001");
    const call = calls.find((entry) => entry.key.startsWith("GET /api/v1/documents?"))!;
    expect(new URLSearchParams(call.key.split("?")[1]).has("documentType")).toBe(false);
  });

  it("muestra la carga, la bandeja vacía y el error con reintento", async () => {
    let fail = true;
    render({
      "GET /api/v1/documents": () =>
        fail ? { status: 500, body: errorBody("INTERNAL_ERROR", "x") } : paged([])({}),
    });
    expect(
      (
        await screen.findAllByText("No pudimos cargar los comprobantes.", undefined, {
          timeout: 5_000,
        })
      ).length,
    ).toBeGreaterThan(0);
    fail = false;
    await userEvent.setup().click(screen.getAllByRole("button", { name: "Intentar de nuevo" })[0]!);
    expect((await screen.findAllByText("Todavía no hay comprobantes")).length).toBeGreaterThan(0);
  });

  it("sin permiso explica el acceso", async () => {
    render({ "GET /api/v1/documents": () => ({ status: 403, body: errorBody("FORBIDDEN", "x") }) });
    expect(await screen.findByText("No tienes acceso a los comprobantes")).toBeDefined();
  });

  it("los filtros viven en la URL y llegan a la API", async () => {
    navigation.search = new URLSearchParams(
      "estado=autorizados&desde=2026-10-01&hasta=2026-10-15&establecimiento=est-1&punto=pto-1&q=0992877878001",
    );
    const calls = render({ "GET /api/v1/documents": paged([]) });
    expect(
      (await screen.findAllByText("No hay comprobantes que coincidan")).length,
    ).toBeGreaterThan(0);
    const call = calls.find((entry) => entry.key.startsWith("GET /api/v1/documents?"))!;
    const query = new URLSearchParams(call.key.split("?")[1]);
    expect(Object.fromEntries(query)).toMatchObject({
      state: "AUTHORIZED",
      from: "2026-10-01",
      to: "2026-10-15",
      establishmentId: "est-1",
      emissionPointId: "pto-1",
      // La identificación del receptor se busca en el mismo campo (refine-archive-search).
      search: "0992877878001",
    });
    const user = userEvent.setup();
    await chooseFilter("Estado", "Devueltos");
    expect(navigation.replace).toHaveBeenLastCalledWith(
      expect.stringContaining("estado=devueltos"),
      { scroll: false },
    );
    await user.click(screen.getAllByRole("button", { name: "Limpiar filtros" })[0]!);
    expect(navigation.replace).toHaveBeenLastCalledWith("/comprobantes", { scroll: false });
  });

  it("un rango invertido se explica en el campo y no consulta", async () => {
    navigation.search = new URLSearchParams("desde=2026-10-15&hasta=2026-10-01");
    const calls = render({ "GET /api/v1/documents": paged([item()]) });
    expect((await screen.findAllByText("Revisa el rango de fechas")).length).toBeGreaterThan(0);
    const hasta = screen.getByLabelText("Hasta");
    expect(hasta.getAttribute("aria-invalid")).toBe("true");
    expect(calls.some((entry) => entry.key.startsWith("GET /api/v1/documents"))).toBe(false);
  });

  it("dos fechas seguidas se acumulan aunque la primera todavía no esté en la URL", async () => {
    render({ "GET /api/v1/documents": paged([item()]) });
    await screen.findAllByText("001-001-000000001");
    const user = userEvent.setup();
    await chooseDate(user, "Desde", "2026-12-31");
    await chooseDate(user, "Hasta", "2026-01-01");
    const query = new URLSearchParams(navigation.replace.mock.lastCall![0].split("?")[1]);
    expect(Object.fromEntries(query)).toEqual({ desde: "2026-12-31", hasta: "2026-01-01" });
  });

  it("descarga el RIDE desde la fila con su aviso", async () => {
    const calls = render({
      "GET /api/v1/documents": paged([item()]),
      "GET /api/v1/documents/doc-1/ride": () => ({ status: 200, body: "%PDF" }),
    });
    const table = await screen.findByRole("table", { name: "Comprobantes emitidos" });
    const button = await within(table).findByRole("button", {
      name: "Descargar el RIDE de 001-001-000000001",
    });
    await userEvent.setup().click(button);
    expect(await screen.findByText("Descargaste el RIDE.")).toBeDefined();
    await waitFor(() =>
      expect(calls.some((entry) => entry.key === "GET /api/v1/documents/doc-1/ride")).toBe(true),
    );
  });
});

describe("correo en la bandeja (add-email-delivery)", () => {
  it("el filtro «Correo» vive en la URL, llega a la API como emailStatus y se limpia", async () => {
    navigation.search = new URLSearchParams("correo=no-enviado");
    const calls = render({ "GET /api/v1/documents": paged([]) });
    expect(
      (await screen.findAllByText("No hay comprobantes que coincidan")).length,
    ).toBeGreaterThan(0);
    const call = calls.find((entry) => entry.key.startsWith("GET /api/v1/documents?"))!;
    expect(new URLSearchParams(call.key.split("?")[1]).get("emailStatus")).toBe("FAILED");
    expect(screen.getByRole("combobox", { name: "Correo" }).textContent).toContain("No enviado");
    await chooseFilter("Correo", "Todos");
    expect(navigation.replace).toHaveBeenLastCalledWith("/comprobantes", { scroll: false });
    await userEvent.setup().click(screen.getAllByRole("button", { name: "Limpiar filtros" })[0]!);
    expect(navigation.replace).toHaveBeenLastCalledWith("/comprobantes", { scroll: false });
  });

  it("elegir «No enviado» escribe correo=no-enviado en la URL", async () => {
    render({ "GET /api/v1/documents": paged([item()]) });
    await screen.findAllByText("001-001-000000001");
    await chooseFilter("Correo", "No enviado");
    expect(navigation.replace).toHaveBeenLastCalledWith("/comprobantes?correo=no-enviado", {
      scroll: false,
    });
  });

  it("un valor desconocido de correo en la URL no filtra", async () => {
    navigation.search = new URLSearchParams("correo=entregado");
    const calls = render({ "GET /api/v1/documents": paged([item()]) });
    await screen.findAllByText("001-001-000000001");
    const call = calls.find((entry) => entry.key.startsWith("GET /api/v1/documents?"))!;
    expect(new URLSearchParams(call.key.split("?")[1]).has("emailStatus")).toBe(false);
  });

  it("el indicador va junto al estado: un icono con su nombre en la fila y con su texto en la tarjeta", async () => {
    render({
      "GET /api/v1/documents": paged([
        item({ email: { status: "FAILED" } }),
        item({ id: "doc-2", number: "001-001-000000002", email: { status: "SENT" } }),
        item({ id: "doc-3", number: "001-001-000000003", email: null }),
      ]),
    });
    const table = await screen.findByRole("table", { name: "Comprobantes emitidos" });
    await within(table).findByText("001-001-000000003");
    const failed = within(table).getByRole("img", { name: "Correo: no enviado" });
    expect(failed.getAttribute("title")).toBe("Correo: no enviado");
    expect(failed.className).toContain("text-danger");
    expect(within(table).getByRole("img", { name: "Correo: enviado" })).toBeDefined();
    const third = within(table).getByText("001-001-000000003").closest("tr")!;
    expect(third.querySelector("[data-email-status]")).toBeNull();
    // En la tarjeta del teléfono, con su texto.
    expect(
      screen
        .getAllByText("Correo: no enviado")
        .some((element) => element.tagName === "SPAN" && !element.closest("table")),
    ).toBe(true);
  });
});

describe("búsqueda, fechas y filtros (refine-archive-search)", () => {
  it("la búsqueda declara número, receptor o identificación, sin campo aparte de identificación", async () => {
    render({ "GET /api/v1/documents": paged([item()]) });
    await screen.findAllByText("001-001-000000001");
    const search = screen.getByRole("searchbox", {
      name: "Buscar por número, receptor o identificación",
    });
    expect(search.getAttribute("placeholder")).toBe("Número, receptor o identificación");
    expect(screen.queryByLabelText("Identificación del receptor")).toBeNull();
  });

  it("las fechas van a la izquierda de la búsqueda, de su tamaño, con la etiqueta como texto de ejemplo", async () => {
    render({ "GET /api/v1/documents": paged([item()]) });
    await screen.findAllByText("001-001-000000001");
    const search = screen.getByRole("searchbox", {
      name: "Buscar por número, receptor o identificación",
    });
    const header =
      search.closest("[data-slot=card-header]") ?? search.closest("header") ?? document.body;
    const from = screen.getByRole("button", { name: /^Desde/ });
    const to = screen.getByRole("button", { name: /^Hasta/ });
    expect(header.contains(from) && header.contains(to)).toBe(true);
    // En el orden del documento: Desde, Hasta y la búsqueda.
    expect(from.compareDocumentPosition(to) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(to.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(from.className).toContain("h-8");
    expect(from.textContent).toContain("Desde");
    // Los tres campos se reparten el 75 % derecho de la cabecera, en una sola fila (2026-10-24).
    expect(from.closest("div.flex-col")?.className).toContain("md:flex-1");
    expect(search.parentElement?.className).toContain("md:flex-1");
    const card = search.closest("[data-slot=data-table-card]")!;
    expect(card.firstElementChild?.className).toContain(
      "md:grid-cols-[minmax(0,1fr)_minmax(0,3fr)]",
    );
  });

  it("los desplegables se reparten toda la fila", async () => {
    render({ "GET /api/v1/documents": paged([item()]) });
    await screen.findAllByText("001-001-000000001");
    for (const name of ["Estado", "Tipo", "Correo", "Establecimiento", "Punto de emisión"]) {
      expect(screen.getByRole("combobox", { name }).className, name).toContain(
        "md:flex-[1_1_12rem]",
      );
    }
    const row = screen.getByRole("combobox", { name: "Estado" }).parentElement!;
    expect(row.className).toContain("w-full");
  });
});
