import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionGate } from "@/components/session";
import { ProductsScreen } from "@/features/products/products-screen";
import {
  ADMIN_ME,
  OPERATOR_ME,
  errorBody,
  mockApi,
  navigation,
  renderApp,
  type Route,
} from "./harness";

const ivaTax = (entryKey: string, label: string, usable = true, reason: string | null = null) => ({
  slot: "iva",
  catalogType: "iva-rate",
  entryKey,
  code: entryKey,
  officialLabel: label,
  rate: {
    taxKind: "IVA",
    sriTaxCode: "2",
    rateKind: "PERCENTAGE",
    percentage: label.replace("%", ""),
  },
  usable,
  reason,
});
const product = (overrides: Record<string, unknown> = {}) => ({
  id: "prod-1",
  kind: "GOOD",
  mainCode: "CEM-50",
  auxiliaryCode: null,
  name: "Cemento 50 kg",
  description: null,
  unitPrice: "8.75",
  stockTracked: false,
  status: "ACTIVE",
  version: 1,
  taxes: [ivaTax("4", "15%")],
  taxConfiguration: { status: "READY", reasons: [], evaluatedOn: "2026-10-03" },
  createdAt: "2026-10-03T10:00:00.000Z",
  updatedAt: "2026-10-03T10:00:00.000Z",
  ...overrides,
});
const REVIEW = product({
  id: "prod-2",
  mainCode: "DOCE-1",
  name: "Producto al 12",
  unitPrice: "999999999999.999999",
  taxes: [ivaTax("2", "12%", false, "DISABLED")],
  taxConfiguration: {
    status: "REVIEW_REQUIRED",
    reasons: [
      { slot: "iva", catalogType: "iva-rate", entryKey: "2", code: "2", reason: "DISABLED" },
    ],
    evaluatedOn: "2026-10-03",
  },
});
const page =
  (data: unknown[]): Route =>
  () => ({
    status: 200,
    body: { data, meta: { page: 1, pageSize: 25, total: data.length } },
  });
const SUMMARY: Route = () => ({
  status: 200,
  body: {
    data: {
      evaluatedOn: "2026-10-03",
      byStatus: { READY: 4, REVIEW_REQUIRED: 2, INCOMPLETE: 1 },
      byEntry: [],
    },
  },
});
const entries =
  (catalogType: string, items: [string, string, boolean][]): Route =>
  () => ({
    status: 200,
    body: {
      data: {
        catalog: {
          catalogType,
          datasetVersion: 1,
          source: {
            document: "Ficha",
            version: "2.34",
            publishedOn: "2026-07-27",
            url: "https://www.sri.gob.ec",
            sha256: "a".repeat(64),
          },
          enablementPolicy: "DEFAULT_ENABLED",
        },
        at: "2026-10-03",
        entries: items.map(([entryKey, label, usable]) => {
          const version = {
            id: `${catalogType}-${entryKey}`,
            officialLabel: label,
            effectiveFrom: "2026-07-27",
            effectiveFromBasis: "PROJECT_BASELINE",
            effectiveTo: null,
            normativeStatus: "OFFICIAL",
            sourceRef: "Ficha",
            datasetVersion: 1,
            rate: null,
            taxKind: null,
            identificationRule: null,
            withholding: null,
          };
          return {
            entryKey,
            code: entryKey.split("-")[0],
            versions: [version],
            applicable: version,
            enablement: { enabled: usable, source: "DEFAULT" },
            usable,
          };
        }),
      },
    },
  });

function renderProducts(
  routes: Record<string, Route>,
  me: typeof ADMIN_ME | typeof OPERATOR_ME = ADMIN_ME,
) {
  const calls = mockApi({
    "GET /api/v1/me": () => ({ status: 200, body: { data: me } }),
    "GET /api/v1/products/tax-summary": SUMMARY,
    "GET /api/v1/fiscal-catalogs/iva-rate/entries": entries("iva-rate", [
      ["4", "15%", true],
      ["2", "12%", false],
    ]),
    "GET /api/v1/fiscal-catalogs/ice-rate/entries": entries("ice-rate", [
      ["3041-GRAN-ESCALA", "ICE Cerveza Industrial Gran Escala", true],
    ]),
    "GET /api/v1/fiscal-catalogs/irbpnr-rate/entries": entries("irbpnr-rate", [
      ["5001", "IRBPNR", true],
    ]),
    ...routes,
  });
  renderApp(
    <SessionGate fallback={<p>cargando</p>}>
      <ProductsScreen />
    </SessionGate>,
  );
  return calls;
}

beforeEach(() => {
  navigation.pathname = "/productos";
  navigation.search = new URLSearchParams();
  navigation.replace.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pantalla Productos", () => {
  it("muestra la carga mientras llega la lista", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    renderProducts({ "GET /api/v1/products": page([product()]) });
    const fetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        if (String(input).startsWith("/api/v1/products?")) await gate;
        return fetch(input, init);
      }),
    );
    const table = await screen.findByRole("table", { name: "Productos y servicios de la empresa" });
    expect(table.closest("[aria-busy]")?.getAttribute("aria-busy")).toBe("true");
    release();
  });

  it("lista código, nombre, tipo, precio exacto, IVA y estado tributario, con recuentos en los filtros", async () => {
    renderProducts({ "GET /api/v1/products": page([product(), REVIEW]) });
    await screen.findAllByText("Producto al 12");
    const table = screen.getByRole("table", { name: "Productos y servicios de la empresa" });
    const rows = within(table).getAllByRole("row");
    const review = rows.find((r) => within(r).queryByText("Producto al 12"))!;
    // El precio se formatea desde el texto, sin pasar por number.
    expect(within(review).getByText("999.999.999.999,999999")).toBeDefined();
    expect(within(review).getByText("Revisar impuestos")).toBeDefined();
    expect(within(review).getByText("12%")).toBeDefined();
    const cement = rows.find((r) => within(r).queryByText("Cemento 50 kg"))!;
    expect(within(cement).getByText("8,75")).toBeDefined();
    expect(within(cement).getByText("Listo")).toBeDefined();
    expect(await screen.findByRole("radio", { name: "Revisar impuestos (2)" })).toBeDefined();
  });

  it("en móvil, estado y tipo van tras Más filtros, que indica cuántos están activos", async () => {
    navigation.search = new URLSearchParams("tipo=servicios");
    renderProducts({ "GET /api/v1/products": page([]) });
    const more = await screen.findByRole("button", { name: "Más filtros (1)" });
    const panel = document.getElementById(more.getAttribute("aria-controls")!)!;
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect(panel.className).toContain("hidden");
    await userEvent.setup().click(more);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(panel.className).not.toMatch(/(^| )hidden( |$)/);
    expect(
      within(panel).getByRole("radio", { name: "Servicios" }).getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("filtra por estado tributario desde la URL", async () => {
    navigation.search = new URLSearchParams("tributario=revisar");
    const calls = renderProducts({ "GET /api/v1/products": page([REVIEW]) });
    await screen.findAllByText("Producto al 12");
    expect(calls.some((c) => c.key.includes("taxStatus=REVIEW_REQUIRED"))).toBe(true);
  });

  it("muestra el vacío y el error con reintento", async () => {
    let fail = true;
    renderProducts({
      "GET /api/v1/products": () =>
        fail
          ? { status: 500, body: errorBody("INTERNAL_ERROR", "Error") }
          : { status: 200, body: { data: [], meta: { page: 1, pageSize: 25, total: 0 } } },
    });
    expect(
      (
        await screen.findAllByText("No pudimos cargar los productos.", undefined, {
          timeout: 5_000,
        })
      ).length,
    ).toBeGreaterThan(0);
    fail = false;
    await userEvent.setup().click(screen.getAllByRole("button", { name: "Intentar de nuevo" })[0]!);
    expect((await screen.findAllByText("Todavía no hay productos")).length).toBeGreaterThan(0);
  }, 10_000);

  it("el operador registra y corrige, pero no desactiva", async () => {
    renderProducts({ "GET /api/v1/products": page([product()]) }, OPERATOR_ME);
    await screen.findAllByText("Cemento 50 kg");
    expect(screen.getByRole("button", { name: "Nuevo producto" })).toBeDefined();
    expect(screen.queryAllByRole("button", { name: /Desactivar / })).toEqual([]);
  });

  it("registra un producto con el precio como texto y el IVA del catálogo", async () => {
    const calls = renderProducts({
      "GET /api/v1/products": page([]),
      "POST /api/v1/products": () => ({ status: 201, body: { data: product() } }),
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Nuevo producto" }));
    const dialog = await screen.findByRole("dialog", { name: "Nuevo producto" });
    await user.type(within(dialog).getByLabelText("Nombre"), "Cemento 50 kg");
    await user.type(within(dialog).getByLabelText("Código principal (opcional)"), "CEM-50");
    await user.type(within(dialog).getByLabelText("Precio unitario sin impuestos"), "8.75");
    await within(dialog).findByRole("option", { name: /15% · código 4/ });
    // Solo las entradas utilizables: el 12 % deshabilitado no se ofrece.
    expect(within(dialog).queryByRole("option", { name: /12%/ })).toBeNull();
    await user.selectOptions(within(dialog).getByLabelText("Tarifa de IVA"), "4");
    await user.click(within(dialog).getByRole("button", { name: "Registrar producto" }));
    expect(await screen.findByText("Registraste Cemento 50 kg.")).toBeDefined();
    expect(calls.find((c) => c.key === "POST /api/v1/products")?.body).toEqual({
      kind: "GOOD",
      mainCode: "CEM-50",
      auxiliaryCode: null,
      name: "Cemento 50 kg",
      description: null,
      unitPrice: "8.75",
      stockTracked: false,
      taxes: { iva: "4", ice: null, irbpnr: null },
    });
  });

  it("un precio con más de 6 decimales se rechaza en el campo, sin redondear ni enviar", async () => {
    const calls = renderProducts({ "GET /api/v1/products": page([]) });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Nuevo producto" }));
    const dialog = await screen.findByRole("dialog", { name: "Nuevo producto" });
    await user.type(within(dialog).getByLabelText("Nombre"), "Tornillo");
    await user.type(within(dialog).getByLabelText("Precio unitario sin impuestos"), "1.1234567");
    await within(dialog).findByRole("option", { name: /15% · código 4/ });
    await user.selectOptions(within(dialog).getByLabelText("Tarifa de IVA"), "4");
    await user.click(within(dialog).getByRole("button", { name: "Registrar producto" }));
    expect(await within(dialog).findByText("Admite como máximo 6 decimales.")).toBeDefined();
    expect(
      (within(dialog).getByLabelText("Precio unitario sin impuestos") as HTMLInputElement).value,
    ).toBe("1.1234567");
    expect(calls.some((c) => c.key === "POST /api/v1/products")).toBe(false);
  });

  it("el código en uso vuelve a su campo y un impuesto no disponible se explica en el diálogo", async () => {
    let code = "PRODUCT_MAIN_CODE_TAKEN";
    renderProducts({
      "GET /api/v1/products": page([]),
      "POST /api/v1/products": () =>
        code === "PRODUCT_MAIN_CODE_TAKEN"
          ? {
              status: 409,
              body: errorBody(
                code,
                "El código principal CEM-50 ya está en uso en otro producto de tu empresa.",
              ),
            }
          : {
              status: 400,
              body: errorBody(
                code,
                "El código de ICE 3041-GRAN-ESCALA no está habilitada para tu empresa.",
              ),
            },
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Nuevo producto" }));
    const dialog = await screen.findByRole("dialog", { name: "Nuevo producto" });
    await user.type(within(dialog).getByLabelText("Nombre"), "Cemento");
    await user.type(within(dialog).getByLabelText("Código principal (opcional)"), "CEM-50");
    await user.type(within(dialog).getByLabelText("Precio unitario sin impuestos"), "1");
    await within(dialog).findByRole("option", { name: /15% · código 4/ });
    await user.selectOptions(within(dialog).getByLabelText("Tarifa de IVA"), "4");
    await user.click(within(dialog).getByRole("button", { name: "Registrar producto" }));
    const field = within(dialog).getByLabelText("Código principal (opcional)");
    await waitFor(() => expect(field.getAttribute("aria-invalid")).toBe("true"));
    code = "PRODUCT_TAX_UNAVAILABLE";
    await user.click(within(dialog).getByRole("button", { name: "Registrar producto" }));
    expect(await within(dialog).findByText(/no está habilitada para tu empresa/)).toBeDefined();
  });

  it("un servicio no ofrece IRBPNR ni control de stock", async () => {
    renderProducts({ "GET /api/v1/products": page([]) });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Nuevo producto" }));
    const dialog = await screen.findByRole("dialog", { name: "Nuevo producto" });
    expect(within(dialog).getByLabelText("IRBPNR (opcional)")).toBeDefined();
    expect(within(dialog).getByLabelText("Controlar stock de este bien")).toBeDefined();
    await user.click(within(dialog).getByRole("radio", { name: "Servicio" }));
    expect(within(dialog).queryByLabelText("IRBPNR (opcional)")).toBeNull();
    expect(within(dialog).queryByLabelText("Controlar stock de este bien")).toBeNull();
    expect(
      within(dialog).getByText("Un servicio no lleva IRBPNR ni control de stock."),
    ).toBeDefined();
  });

  it("con el inventario inicializado, la marca se gestiona en Inventario (add-minimal-inventory)", async () => {
    const stockItem = (state: string) => ({
      status: 200,
      body: {
        data: {
          productId: "prod-1",
          mainCode: "CEM-50",
          auxiliaryCode: null,
          name: "Cemento 50 kg",
          productStatus: "ACTIVE",
          state,
          balance: state === "TRACKED_NOT_INITIALIZED" ? null : "4",
          negative: false,
          lastMovementAt: null,
          initializedAt: null,
          initializedByName: null,
        },
      },
    });
    let state = "TRACKED_INITIALIZED";
    const calls = renderProducts({
      "GET /api/v1/products": page([product({ stockTracked: true })]),
      "GET /api/v1/inventory/items/prod-1": () => stockItem(state),
      "PUT /api/v1/products/prod-1": () => ({ status: 200, body: { data: product() } }),
    });
    const user = userEvent.setup();
    await user.click(
      (await screen.findAllByRole("button", { name: "Corregir Cemento 50 kg" }))[0]!,
    );
    let dialog = await screen.findByRole("dialog", { name: "Corregir producto" });
    expect(await within(dialog).findByText(/El control se gestiona en Inventario/)).toBeDefined();
    const checkbox = within(dialog).getByLabelText("Controlar stock de este bien");
    expect(checkbox).toHaveProperty("disabled", true);
    expect(checkbox).toHaveProperty("checked", true);
    expect(
      within(dialog)
        .getByRole("link", { name: "Ir al inventario del producto" })
        .getAttribute("href"),
    ).toBe("/inventario/prod-1");
    await user.click(within(dialog).getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() =>
      expect(calls.find((call) => call.key === "PUT /api/v1/products/prod-1")?.body).toMatchObject({
        stockTracked: true,
      }),
    );

    state = "TRACKED_NOT_INITIALIZED";
    await user.click(
      (await screen.findAllByRole("button", { name: "Corregir Cemento 50 kg" }))[0]!,
    );
    dialog = await screen.findByRole("dialog", { name: "Corregir producto" });
    await waitFor(() =>
      expect(within(dialog).getByLabelText("Controlar stock de este bien")).toHaveProperty(
        "disabled",
        false,
      ),
    );
    expect(within(dialog).queryByText(/El control se gestiona en Inventario/)).toBeNull();
  });

  it("al corregir un producto en revisión explica el motivo y conserva su tarifa actual", async () => {
    renderProducts({ "GET /api/v1/products": page([REVIEW]) });
    const user = userEvent.setup();
    await user.click(
      (await screen.findAllByRole("button", { name: "Corregir Producto al 12" }))[0]!,
    );
    const dialog = await screen.findByRole("dialog", { name: "Corregir producto" });
    expect(
      within(dialog).getByText("La tarifa de IVA 2 no está habilitada para tu empresa."),
    ).toBeDefined();
    expect(within(dialog).getByRole("link", { name: "Ir a Catálogos fiscales" })).toBeDefined();
    expect(
      await within(dialog).findByRole("option", { name: /12% · código 2 \(no disponible hoy\)/ }),
    ).toBeDefined();
    expect((within(dialog).getByLabelText("Tarifa de IVA") as HTMLSelectElement).value).toBe("2");
  });

  it("el diálogo se abre con el teclado y Escape lo cierra", async () => {
    renderProducts({ "GET /api/v1/products": page([]) });
    const user = userEvent.setup();
    const button = await screen.findByRole("button", { name: "Nuevo producto" });
    button.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("dialog", { name: "Nuevo producto" })).toBeDefined();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("pantalla Productos sin permiso", () => {
  it("explica que no tiene acceso y no consulta la lista", async () => {
    vi.resetModules();
    vi.doMock("@/lib/permissions", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/permissions")>();
      return { ...actual, canSee: () => false };
    });
    const { ProductsScreen: Screen } = await import("@/features/products/products-screen");
    const { SessionGate: Gate } = await import("@/components/session");
    const calls = mockApi({ "GET /api/v1/me": () => ({ status: 200, body: { data: ADMIN_ME } }) });
    renderApp(
      <Gate fallback={<p>cargando</p>}>
        <Screen />
      </Gate>,
    );
    expect(await screen.findByText("No tienes acceso a Productos")).toBeDefined();
    expect(calls.some((c) => c.key.startsWith("GET /api/v1/products"))).toBe(false);
    vi.doUnmock("@/lib/permissions");
  });
});
