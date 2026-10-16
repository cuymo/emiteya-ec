// Lista de Facturas sobre la base compartida (productize-invoice-list-and-shared-table-foundation,
// tareas 7.1 a 7.3; design D4, D6 a D11, D13 y D14). La navegación es simulada: un cambio de filtro
// se comprueba en `router.replace`, y una dirección nueva se dibuja otra vez con `rerenderApp`.
// Cada estado tiene dos copias en el DOM (distribución amplia y compacta, D15); jsdom no aplica las
// container queries, así que las aserciones toman la primera copia o cuentan las dos.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionGate } from "@/components/session";
import { InvoicesScreen } from "@/features/invoices/invoices-screen";
import {
  ADMIN_ME,
  OPERATOR_ME,
  errorBody,
  mockApi,
  navigation,
  renderApp,
  type Route,
} from "./harness";

// La política vigente da `invoices.draft` a los dos roles: se retira para probar la falta de permiso.
const permissions = vi.hoisted(() => ({ deny: new Set<string>() }));
vi.mock("@/lib/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/permissions")>();
  return {
    ...actual,
    canSee: (...args: Parameters<typeof actual.canSee>) =>
      !permissions.deny.has(args[1]) && actual.canSee(...args),
  };
});

const summary = (overrides: Record<string, unknown> = {}) => ({
  id: "inv-1",
  documentNumber: "001-001-000000001",
  environment: "TEST",
  issueDate: "2026-10-03",
  buyerIdentification: "0992877878001",
  buyerName: "EL PERNO CIA. LTDA.",
  total: "1250.00",
  state: "SIGNED",
  diagnosticCode: null,
  transmissionStopped: false,
  createdAt: "2026-10-03T15:00:00.000Z",
  ...overrides,
});
const paged =
  (data: unknown[], total = data.length, page = 1, pageSize = 25): Route =>
  () => ({ status: 200, body: { data, meta: { page, pageSize, total } } });
const companyStatus =
  (environment: "TEST" | "PRODUCTION"): Route =>
  () => ({
    status: 200,
    body: {
      data: {
        environment,
        displayName: "Comercial Andina",
        readiness: { ready: true, checks: [] },
      },
    },
  });
const COUNT = "GET /api/v1/invoices?attention=true&pageSize=1";

function render(
  routes: Record<string, Route>,
  me: typeof ADMIN_ME | typeof OPERATOR_ME = OPERATOR_ME,
) {
  const calls = mockApi({
    "GET /api/v1/me": () => ({ status: 200, body: { data: me } }),
    "GET /api/v1/company/status": companyStatus("TEST"),
    [COUNT]: paged([], 0),
    ...routes,
  });
  const ui = (): ReactNode => (
    <SessionGate fallback={<p>cargando</p>}>
      <InvoicesScreen />
    </SessionGate>
  );
  const view = renderApp(ui());
  return { calls, rerender: () => view.rerenderApp(ui()) };
}

const listCalls = (calls: { key: string }[]) =>
  calls.filter((call) => call.key.startsWith("GET /api/v1/invoices?page="));
const countCalls = (calls: { key: string }[]) => calls.filter((call) => call.key === COUNT);
const rowOf = async (number: string) => {
  const table = await screen.findByRole("table", { name: "Facturas emitidas" });
  await within(table).findAllByText(number);
  return within(table)
    .getAllByRole("row")
    .find((row) => within(row).queryAllByText(number).length > 0)!;
};

beforeEach(() => {
  navigation.pathname = "/facturas";
  navigation.search = new URLSearchParams();
  navigation.replace.mockReset();
  navigation.push.mockReset();
  permissions.deny.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("encabezado de Facturas (D4)", () => {
  it("tiene un solo h1 y «Nueva factura» como única acción principal, hacia la pantalla existente", async () => {
    render({ "GET /api/v1/invoices": paged([summary()]) });
    await rowOf("001-001-000000001");
    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual([
      "Facturas",
    ]);
    const create = screen.getByRole("link", { name: "Nueva factura" });
    expect(create.getAttribute("href")).toBe("/borradores/nuevo");
    expect(document.querySelectorAll("[data-variant=primary]")).toHaveLength(1);
    expect(screen.queryByRole("navigation", { name: /migas/i })).toBeNull();
  });

  it("sin permiso para preparar borradores no ofrece «Nueva factura», tampoco en el vacío", async () => {
    permissions.deny.add("invoices.draft");
    render({ "GET /api/v1/invoices": paged([]) });
    expect(await screen.findByText("Todavía no hay facturas")).toBeDefined();
    expect(screen.queryByRole("link", { name: "Nueva factura" })).toBeNull();
  });
});

describe("vistas, conteo y estado (D6 y D7)", () => {
  it("«Requiere atención» muestra el número de la empresa y elegirla cambia la vista", async () => {
    const { calls } = render({
      "GET /api/v1/invoices": paged([summary()]),
      [COUNT]: paged([summary({ state: "SEND_UNKNOWN" })], 3, 1, 1),
    });
    const user = userEvent.setup();
    const views = await screen.findByRole("combobox", { name: "Vista" });
    expect(views.textContent).toContain("Todas");
    await waitFor(() => expect(countCalls(calls)).toHaveLength(1));
    await user.click(views);
    await user.click(await screen.findByRole("option", { name: "Requiere atención 3" }));
    expect(navigation.replace).toHaveBeenCalledWith("/facturas?vista=atencion", { scroll: false });
    expect(countCalls(calls)).toHaveLength(1);
  });

  it("el conteo no se repite al cambiar de página, filas, estado o búsqueda", async () => {
    const { calls, rerender } = render({
      "GET /api/v1/invoices": paged([summary()], 60),
      [COUNT]: paged([], 2, 1, 1),
    });
    await waitFor(() => expect(countCalls(calls)).toHaveLength(1));
    for (const search of ["pagina=2", "pagina=2&filas=50", "estado=devueltas", "q=perno"]) {
      navigation.search = new URLSearchParams(search);
      rerender();
      await waitFor(() =>
        expect(listCalls(calls).some((call) => call.key.includes(searchToApi(search)))).toBe(true),
      );
    }
    expect(countCalls(calls)).toHaveLength(1);
  });

  it("cada estado del filtro va a su parámetro de la API, combinado con la vista", async () => {
    const expected = {
      procesando: "RESERVED",
      firmadas: "SIGNED",
      verificando: "SEND_UNKNOWN",
      recibidas: "RECEIVED",
      autorizadas: "AUTHORIZED",
      devueltas: "RETURNED",
      "no-autorizadas": "NOT_AUTHORIZED",
      revision: "MANUAL_REVIEW",
    } as const;
    const { calls, rerender } = render({ "GET /api/v1/invoices": paged([summary()]) });
    await rowOf("001-001-000000001");
    for (const [param, state] of Object.entries(expected)) {
      navigation.search = new URLSearchParams(`estado=${param}`);
      rerender();
      await waitFor(() =>
        expect(listCalls(calls).some((call) => call.key.endsWith(`&state=${state}`))).toBe(true),
      );
    }
    navigation.search = new URLSearchParams("vista=atencion&estado=firmadas");
    rerender();
    await waitFor(() =>
      expect(
        listCalls(calls).some(
          (call) => call.key.includes("state=SIGNED") && call.key.includes("attention=true"),
        ),
      ).toBe(true),
    );
  });

  it("el filtro ofrece los ocho estados del glosario y escribe su valor en la URL", async () => {
    render({ "GET /api/v1/invoices": paged([summary()]) });
    await rowOf("001-001-000000001");
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "Estado" }));
    const options = (await screen.findAllByRole("option")).map((option) => option.textContent);
    expect(options).toEqual([
      "Todos",
      "Procesando",
      "Pendiente de envío",
      "Verificando con el SRI",
      "Pendiente de autorización",
      "Devuelto",
      "Autorizado",
      "No autorizado",
      "Requiere revisión",
    ]);
    await user.click(screen.getByRole("option", { name: "Pendiente de autorización" }));
    expect(navigation.replace).toHaveBeenCalledWith("/facturas?estado=recibidas", {
      scroll: false,
    });
  });

  it("un enlace anterior con `estado=atencion` abre la vista «Requiere atención»", async () => {
    navigation.search = new URLSearchParams("estado=atencion");
    const { calls } = render({ "GET /api/v1/invoices": paged([]) });
    await screen.findByText("No hay facturas con estos filtros");
    expect(listCalls(calls).every((call) => call.key.includes("attention=true"))).toBe(true);
    expect(listCalls(calls).some((call) => call.key.includes("state="))).toBe(false);
    expect(screen.getByRole("combobox", { name: "Vista" }).textContent).toContain(
      "Requiere atención",
    );
    // Solo la vista: «Todas» la deshace, así que la fila de filtros no ofrece «Limpiar filtros». El
    // único es el del vacío por filtros, dentro de la tabla.
    const clear = screen.getAllByRole("button", { name: "Limpiar filtros" });
    expect(clear).toHaveLength(1);
    expect(screen.getByRole("table", { name: "Facturas emitidas" }).contains(clear[0]!)).toBe(true);
    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith("/facturas?vista=atencion", {
        scroll: false,
      }),
    );
  });
});

/** El parámetro de la API que corresponde a un cambio de la URL en la prueba del conteo. */
function searchToApi(search: string): string {
  if (search === "pagina=2") return "page=2&pageSize=25";
  if (search === "pagina=2&filas=50") return "page=2&pageSize=50";
  if (search === "estado=devueltas") return "state=RETURNED";
  return "search=perno";
}

describe("búsqueda y estado en la URL (D8 y D9)", () => {
  it("declara lo que busca y consulta al servidor tras la espera, desde la primera página", async () => {
    navigation.search = new URLSearchParams("pagina=3");
    render({ "GET /api/v1/invoices": paged([summary()], 80) });
    const search = await screen.findByRole("searchbox", {
      name: "Buscar por número, comprador o identificación",
    });
    expect(search.getAttribute("placeholder")).toBe("Número, comprador o identificación");
    expect(search.getAttribute("maxlength")).toBe("100");
    await userEvent.setup().type(search, "0992877878001");
    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith("/facturas?q=0992877878001", {
        scroll: false,
      }),
    );
  });

  it("restaura la vista, el estado, la búsqueda, la página y las filas desde la URL", async () => {
    navigation.search = new URLSearchParams(
      "vista=atencion&estado=devueltas&q=perno&pagina=2&filas=50",
    );
    const { calls } = render({ "GET /api/v1/invoices": paged([summary()], 60, 2, 50) });
    await rowOf("001-001-000000001");
    expect(listCalls(calls)[0]!.key).toBe(
      "GET /api/v1/invoices?page=2&pageSize=50&search=perno&state=RETURNED&attention=true",
    );
    expect(screen.getByRole("combobox", { name: "Vista" }).textContent).toContain(
      "Requiere atención",
    );
    expect(screen.getByRole("combobox", { name: "Estado" }).textContent).toContain("Devuelto");
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("perno");
    expect(screen.getByText("Mostrando 51-60 de 60")).toBeDefined();
  });

  it("los valores no válidos vuelven a los de por defecto", async () => {
    navigation.search = new URLSearchParams("vista=otra&estado=borradores&filas=500&pagina=-2");
    const { calls } = render({ "GET /api/v1/invoices": paged([summary()]) });
    await rowOf("001-001-000000001");
    expect(listCalls(calls)[0]!.key).toBe("GET /api/v1/invoices?page=1&pageSize=25");
    expect(screen.queryByRole("button", { name: "Limpiar filtros" })).toBeNull();
  });

  it("una página posterior a la última lleva a la última, sin vacío", async () => {
    navigation.search = new URLSearchParams("pagina=9");
    render({ "GET /api/v1/invoices": paged([], 30, 9) });
    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith("/facturas?pagina=2", { scroll: false }),
    );
    expect(navigation.replace).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("No hay facturas con estos filtros")).toBeNull();
    expect(screen.queryByText("Todavía no hay facturas")).toBeNull();
  });

  it("«Limpiar filtros» aparece solo con filtros y vuelve a todas las facturas", async () => {
    const { rerender } = render({ "GET /api/v1/invoices": paged([summary()]) });
    await rowOf("001-001-000000001");
    expect(screen.queryByRole("button", { name: "Limpiar filtros" })).toBeNull();
    navigation.search = new URLSearchParams("q=perno&estado=firmadas");
    rerender();
    // Cada filtro activo se ve en su control: la búsqueda en su campo y el estado en su desplegable.
    const clear = await screen.findByRole("button", { name: "Limpiar filtros" });
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("perno");
    expect(screen.getByRole("combobox", { name: "Estado" }).textContent).toContain(
      "Pendiente de envío",
    );
    await userEvent.setup().click(clear);
    expect(navigation.replace).toHaveBeenLastCalledWith("/facturas", { scroll: false });
  });

  it("la paginación usa la base compartida y no aparece mientras carga", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    render({ "GET /api/v1/invoices": paged([summary()], 30) });
    const fetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        if (input.startsWith("/api/v1/invoices?page=")) await gate;
        return fetch(input, init);
      }),
    );
    await screen.findByRole("table", { name: "Facturas emitidas" });
    expect(screen.queryByText(/Mostrando/)).toBeNull();
    expect(screen.queryByText(/0-0/)).toBeNull();
    release();
    expect(await screen.findByText("Mostrando 1-25 de 30")).toBeDefined();
    await userEvent.setup().click(screen.getByRole("button", { name: "Página siguiente" }));
    expect(navigation.replace).toHaveBeenCalledWith("/facturas?pagina=2", { scroll: false });
  });
});

describe("columnas, marcas y apertura (D10, D11 y D13)", () => {
  it("cada fila tiene el número enlazado, la fecha, el estado, el comprador y el total, sin orden falso", async () => {
    render({ "GET /api/v1/invoices": paged([summary()]) });
    const row = await rowOf("001-001-000000001");
    expect(within(row).getByRole("link", { name: "001-001-000000001" }).getAttribute("href")).toBe(
      "/facturas/inv-1",
    );
    expect(within(row).getAllByText("03/10/2026").length).toBeGreaterThan(0);
    expect(within(row).getAllByText("Pendiente de envío").length).toBeGreaterThan(0);
    expect(within(row).getAllByText("EL PERNO CIA. LTDA.").length).toBeGreaterThan(0);
    expect(within(row).getByText("0992877878001")).toBeDefined();
    expect(within(row).getByText("$1.250,00")).toBeDefined();
    const headers = screen.getAllByRole("columnheader");
    expect(headers.map((header) => header.textContent)).toEqual([
      "Factura",
      "Estado",
      "Comprador",
      "Total",
      "Acciones",
    ]);
    for (const header of headers) {
      expect(header.getAttribute("aria-sort")).toBeNull();
      expect(within(header).queryByRole("button")).toBeNull();
    }
    expect(row.getAttribute("tabindex")).toBeNull();
    // La fila no es un control: ni rol propio ni parada de teclado; el teclado usa el enlace.
    expect(row.getAttribute("role")).toBeNull();
  });

  it("el clic en una zona no interactiva abre la factura; el menú y la selección no", async () => {
    render({ "GET /api/v1/invoices": paged([summary()]) });
    const row = await rowOf("001-001-000000001");
    fireEvent.click(within(row).getByText("0992877878001"));
    expect(navigation.push).toHaveBeenCalledWith("/facturas/inv-1");
    navigation.push.mockReset();
    fireEvent.click(within(row).getAllByRole("button", { name: /^Acciones de la factura/ })[0]!);
    fireEvent.click(within(row).getByText("$1.250,00"), { ctrlKey: true });
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it("el menú de la fila tiene solo «Ver factura» y «Copiar número», y copia el número visible", async () => {
    // `userEvent.setup()` pone un portapapeles de prueba en `navigator.clipboard`.
    const user = userEvent.setup();
    render({ "GET /api/v1/invoices": paged([summary({ state: "AUTHORIZED" })]) });
    const row = await rowOf("001-001-000000001");
    await user.click(
      within(row).getAllByRole("button", { name: "Acciones de la factura 001-001-000000001" })[0]!,
    );
    const menu = await screen.findByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Ver factura", "Copiar número"]);
    expect(within(menu).getByRole("menuitem", { name: "Ver factura" }).getAttribute("href")).toBe(
      "/facturas/inv-1",
    );
    expect(
      within(menu).queryByText(/RIDE|nota|Reintentar|Reconciliar|Anular|Reenviar|Duplicar/i),
    ).toBeNull();
    await user.click(within(menu).getByRole("menuitem", { name: "Copiar número" }));
    expect(await navigator.clipboard.readText()).toBe("001-001-000000001");
    expect(await screen.findByText("Copiaste el número 001-001-000000001.")).toBeDefined();
  });

  it("marca las facturas que requieren atención con un nombre accesible", async () => {
    render({
      "GET /api/v1/invoices": paged([
        summary({ id: "a", documentNumber: "001-001-000000010", state: "SEND_UNKNOWN" }),
        summary({ id: "b", documentNumber: "001-001-000000011", state: "MANUAL_REVIEW" }),
        summary({ id: "c", documentNumber: "001-001-000000012", transmissionStopped: true }),
        summary({ id: "d", documentNumber: "001-001-000000013", state: "AUTHORIZED" }),
        summary({ id: "e", documentNumber: "001-001-000000014", state: "RETURNED" }),
      ]),
    });
    for (const number of ["001-001-000000010", "001-001-000000011", "001-001-000000012"]) {
      expect(
        within(await rowOf(number)).getByRole("img", { name: "Requiere atención" }),
      ).toBeDefined();
    }
    for (const number of ["001-001-000000013", "001-001-000000014"]) {
      expect(
        within(await rowOf(number)).queryByRole("img", { name: "Requiere atención" }),
      ).toBeNull();
    }
  });

  it("la lista no pide nada por fila: solo la lista, el conteo y el contexto de la empresa", async () => {
    const { calls } = render({
      "GET /api/v1/invoices": paged([
        summary({ id: "a", documentNumber: "001-001-000000040" }),
        summary({ id: "b", documentNumber: "001-001-000000041", state: "AUTHORIZED" }),
        summary({ id: "c", documentNumber: "001-001-000000042", state: "SEND_UNKNOWN" }),
      ]),
    });
    await rowOf("001-001-000000042");
    const keys = new Set(calls.map((call) => call.key.split("?")[0]));
    expect([...keys].sort()).toEqual([
      "GET /api/v1/company/status",
      "GET /api/v1/invoices",
      "GET /api/v1/me",
    ]);
    expect(listCalls(calls)).toHaveLength(1);
    expect(countCalls(calls)).toHaveLength(1);
  });
});

// Ambiente de cada factura (D13, PO-4; tarea 11.1). Solo cuenta el `environment` de la fila; el
// vigente llega de `/company/status`. Con el vigente desconocido no hay con qué coincidir, así que
// cada fila dice el suyo. Un 403 deja el error asentado sin reintentos.
describe("ambiente de cada factura (PO-4, tarea 11.1)", () => {
  const TEST_ROW = "001-001-000000020";
  const PRODUCTION_ROW = "001-001-000000021";
  const ROWS = paged([
    summary({ id: "t", documentNumber: TEST_ROW, state: "AUTHORIZED" }),
    summary({
      id: "p",
      documentNumber: PRODUCTION_ROW,
      environment: "PRODUCTION",
      state: "AUTHORIZED",
    }),
  ]);
  const UNKNOWN: Route = () => ({ status: 403, body: errorBody("FORBIDDEN", "No.") });
  const badgeOf = (element: HTMLElement) => element.closest("[data-slot=badge]");

  /** Espera a que la consulta del ambiente vigente haya fallado (sin reintentos con un 403). */
  async function renderUnknown() {
    const { calls } = render({
      "GET /api/v1/company/status": UNKNOWN,
      "GET /api/v1/invoices": ROWS,
    });
    await waitFor(() =>
      expect(calls.some((call) => call.key === "GET /api/v1/company/status")).toBe(true),
    );
    await rowOf(PRODUCTION_ROW);
  }

  it("vigente desconocido + factura de Pruebas: «Pruebas» y «sin validez tributaria»", async () => {
    await renderUnknown();
    const row = await rowOf(TEST_ROW);
    const label = within(row).getByText("Pruebas");
    expect(label.getAttribute("data-variant")).toBe("neutral");
    expect(within(row).getByText("sin validez tributaria")).toBeDefined();
  });

  it("vigente desconocido + factura de Producción: «Producción», nunca en silencio ni en verde", async () => {
    await renderUnknown();
    const row = await rowOf(PRODUCTION_ROW);
    const label = within(row).getByText("Producción");
    expect(label.getAttribute("data-variant")).toBe("emphasis");
    expect(within(row).queryByText("sin validez tributaria")).toBeNull();
  });

  it("empresa en Producción + factura de Pruebas: «Pruebas» con «sin validez tributaria»", async () => {
    render({
      "GET /api/v1/company/status": companyStatus("PRODUCTION"),
      "GET /api/v1/invoices": ROWS,
    });
    const production = await rowOf(PRODUCTION_ROW);
    // Con el vigente confirmado, la fila de Producción deja de llevar marca: coincide.
    await waitFor(() => expect(within(production).queryByText("Producción")).toBeNull());
    const row = await rowOf(TEST_ROW);
    expect(within(row).getByText("Pruebas").getAttribute("data-variant")).toBe("neutral");
    expect(within(row).getByText("sin validez tributaria")).toBeDefined();
  });

  it("empresa en Pruebas + factura de Producción: «Producción» como contexto, sin el tono de éxito", async () => {
    render({ "GET /api/v1/company/status": companyStatus("TEST"), "GET /api/v1/invoices": ROWS });
    const test = await rowOf(TEST_ROW);
    await waitFor(() => expect(within(test).queryByText("Pruebas")).toBeNull());
    const row = await rowOf(PRODUCTION_ROW);
    const label = within(row).getByText("Producción");
    expect(label.getAttribute("data-variant")).toBe("emphasis");
    expect(label.getAttribute("data-variant")).not.toBe("success");
  });

  it("mismo ambiente: ninguna marca redundante", async () => {
    render({
      "GET /api/v1/company/status": companyStatus("TEST"),
      "GET /api/v1/invoices": paged([
        summary({ id: "a", documentNumber: "001-001-000000040" }),
        summary({ id: "b", documentNumber: "001-001-000000041", state: "AUTHORIZED" }),
      ]),
    });
    const table = await screen.findByRole("table", { name: "Facturas emitidas" });
    await within(table).findAllByText("001-001-000000041");
    await waitFor(() => expect(within(table).queryByText("Pruebas")).toBeNull());
    expect(within(table).queryByText("sin validez tributaria")).toBeNull();
    expect(within(table).queryByText("Producción")).toBeNull();
  });

  it("el ambiente y el estado son independientes: «Autorizado» en Pruebas sigue sin validez", async () => {
    render({
      "GET /api/v1/company/status": companyStatus("PRODUCTION"),
      "GET /api/v1/invoices": ROWS,
    });
    const production = await rowOf(PRODUCTION_ROW);
    await waitFor(() => expect(within(production).queryByText("Producción")).toBeNull());
    const row = await rowOf(TEST_ROW);
    const status = badgeOf(within(row).getAllByText("Autorizado")[0]!);
    const environment = badgeOf(within(row).getByText("Pruebas"));
    expect(status?.getAttribute("data-variant")).toBe("success");
    expect(environment?.getAttribute("data-variant")).toBe("neutral");
    // Dos insignias distintas: el ambiente no se mezcla con el estado ni lo tiñe.
    expect(status).not.toBe(environment);
    expect(status?.textContent).not.toContain("Pruebas");
    expect(within(row).getByText("sin validez tributaria")).toBeDefined();
  });
});

describe("carga, vacío y error (D14)", () => {
  it("vacío inicial: explica qué aparece y ofrece «Nueva factura» en outline, sin paginación", async () => {
    render({ "GET /api/v1/invoices": paged([]) });
    const title = await screen.findByRole("heading", { level: 2, name: "Todavía no hay facturas" });
    expect(
      screen.getByText("Aquí aparecen las facturas que emites. Empieza con un borrador."),
    ).toBeDefined();
    const creates = screen.getAllByRole("link", { name: "Nueva factura" });
    expect(creates).toHaveLength(2);
    const table = screen.getByRole("table", { name: "Facturas emitidas" });
    expect(
      within(table).getByRole("link", { name: "Nueva factura" }).getAttribute("data-variant"),
    ).toBe("outline");
    expect(title).toBeDefined();
    expect(screen.queryByText(/Mostrando/)).toBeNull();
  });

  it("vacío por filtros: nombra los filtros y ofrece limpiarlos, no crear", async () => {
    navigation.search = new URLSearchParams("q=zzz&estado=devueltas");
    render({ "GET /api/v1/invoices": paged([]) });
    expect(
      await screen.findByRole("heading", { level: 2, name: "No hay facturas con estos filtros" }),
    ).toBeDefined();
    expect(
      screen.getByText("Ninguna factura está en «Devuelto» y coincide con «zzz»."),
    ).toBeDefined();
    const table = screen.getByRole("table", { name: "Facturas emitidas" });
    expect(within(table).getByRole("button", { name: "Limpiar filtros" })).toBeDefined();
    expect(within(table).queryByRole("link", { name: "Nueva factura" })).toBeNull();
    expect(screen.queryByText(/Mostrando/)).toBeNull();
  });

  it("error: mantiene el encabezado y las herramientas y ofrece reintentar", async () => {
    let fail = true;
    render({
      "GET /api/v1/invoices": () =>
        fail
          ? { status: 500, body: errorBody("INTERNAL_ERROR", "Error") }
          : { status: 200, body: { data: [summary()], meta: { page: 1, pageSize: 25, total: 1 } } },
    });
    const alert = await screen.findByRole("alert", undefined, { timeout: 5_000 });
    expect(alert.textContent).toContain("No pudimos cargar las facturas.");
    expect(alert.textContent).not.toMatch(/INTERNAL_ERROR|req-prueba/);
    expect(screen.getByRole("heading", { level: 1, name: "Facturas" })).toBeDefined();
    expect(screen.getByRole("searchbox")).toBeDefined();
    fail = false;
    await userEvent.setup().click(screen.getByRole("button", { name: "Intentar de nuevo" }));
    expect(await rowOf("001-001-000000001")).toBeDefined();
  }, 10_000);

  it("sin permiso en el servidor, el aviso va bajo el encabezado y sin acción principal", async () => {
    render({
      "GET /api/v1/invoices": () => ({ status: 403, body: errorBody("FORBIDDEN", "No.") }),
    });
    expect(await screen.findByText("No tienes acceso a Facturas")).toBeDefined();
    expect(screen.getByRole("heading", { level: 1, name: "Facturas" })).toBeDefined();
    expect(screen.queryByRole("link", { name: "Nueva factura" })).toBeNull();
  });
});
