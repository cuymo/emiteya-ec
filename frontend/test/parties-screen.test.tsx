import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionGate } from "@/components/session";
import { PartiesScreen } from "@/features/parties/parties-screen";
import {
  ADMIN_ME,
  OPERATOR_ME,
  errorBody,
  mockApi,
  navigation,
  renderApp,
  type Route,
} from "./harness";

const party = (overrides: Record<string, unknown> = {}) => ({
  id: "p-1",
  identificationType: "04",
  identificationTypeLabel: "RUC",
  identification: "1790012345001",
  legalName: "Comercial Andina S.A.",
  address: null,
  email: null,
  phone: null,
  roles: ["CUSTOMER"],
  status: "ACTIVE",
  systemRecord: null,
  version: 1,
  createdAt: "2026-10-03T10:00:00.000Z",
  updatedAt: "2026-10-03T10:00:00.000Z",
  ...overrides,
});
const CONSUMER = party({
  id: "p-cf",
  identificationType: "07",
  identificationTypeLabel: "VENTA A CONSUMIDOR FINAL",
  identification: "9999999999999",
  legalName: "CONSUMIDOR FINAL",
  systemRecord: "CONSUMER_FINAL",
});
const page =
  (data: unknown[]): Route =>
  () => ({
    status: 200,
    body: { data, meta: { page: 1, pageSize: 25, total: data.length } },
  });
const TYPES: Route = () => ({
  status: 200,
  body: {
    data: {
      catalog: {
        catalogType: "identification-type",
        datasetVersion: 1,
        source: {
          document: "Ficha",
          version: "2.34",
          publishedOn: "2026-07-27",
          url: "https://www.sri.gob.ec",
          sha256: "a".repeat(64),
        },
        enablementPolicy: "NOT_ENABLEABLE",
      },
      at: "2026-10-03",
      entries: [
        ["04", "RUC", "13 dígitos terminados en 001", null],
        ["05", "CÉDULA", "10 dígitos", null],
        ["07", "VENTA A CONSUMIDOR FINAL", "Reservado", "CONSUMER_FINAL"],
      ].map(([code, label, description, reservedFor]) => {
        const version = {
          id: `id-${code}`,
          officialLabel: label,
          effectiveFrom: "2026-07-27",
          effectiveFromBasis: "PROJECT_BASELINE",
          effectiveTo: null,
          normativeStatus: "OFFICIAL",
          sourceRef: "Tabla 6",
          datasetVersion: 1,
          rate: null,
          taxKind: null,
          identificationRule: { pattern: null, description, reservedFor },
        };
        return {
          entryKey: code,
          code,
          versions: [version],
          applicable: version,
          enablement: { enabled: true, source: "NOT_ENABLEABLE" },
          usable: true,
        };
      }),
    },
  },
});

function renderParties(
  routes: Record<string, Route>,
  me: typeof ADMIN_ME | typeof OPERATOR_ME = ADMIN_ME,
) {
  const calls = mockApi({
    "GET /api/v1/me": () => ({ status: 200, body: { data: me } }),
    "GET /api/v1/fiscal-catalogs/identification-type/entries": TYPES,
    ...routes,
  });
  renderApp(
    <SessionGate fallback={<p>cargando</p>}>
      <PartiesScreen />
    </SessionGate>,
  );
  return calls;
}

const table = () => screen.findByRole("table", { name: "Terceros de la empresa" });

beforeEach(() => {
  navigation.pathname = "/terceros";
  navigation.search = new URLSearchParams();
  navigation.replace.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pantalla Terceros", () => {
  it("lista identificación con su tipo, razón social, roles y estado; el consumidor final, del sistema y sin acciones", async () => {
    renderParties({ "GET /api/v1/parties": page([party(), CONSUMER]) });
    await screen.findAllByText("Comercial Andina S.A.");
    const rows = within(await table()).getAllByRole("row");
    const andina = rows.find((r) => within(r).queryByText("Comercial Andina S.A."))!;
    expect(within(andina).getByText("1790012345001")).toBeDefined();
    expect(within(andina).getByText("RUC")).toBeDefined();
    expect(within(andina).getByText("Cliente")).toBeDefined();
    expect(within(andina).getByText("Activo")).toBeDefined();
    expect(
      within(andina).getByRole("button", { name: "Corregir a Comercial Andina S.A." }),
    ).toBeDefined();
    const consumer = rows.find((r) => within(r).queryByText("CONSUMIDOR FINAL"))!;
    expect(within(consumer).getByText("Del sistema")).toBeDefined();
    expect(within(consumer).queryAllByRole("button")).toEqual([]);
  });

  it("muestra la carga mientras llega la lista", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    renderParties({ "GET /api/v1/parties": page([party()]) });
    const fetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        if (String(input).startsWith("/api/v1/parties?")) await gate;
        return fetch(input, init);
      }),
    );
    const loading = await table();
    expect(loading.closest("[aria-busy]")?.getAttribute("aria-busy")).toBe("true");
    release();
  });

  it("muestra el vacío y el error con reintento", async () => {
    let fail = true;
    renderParties({
      "GET /api/v1/parties": () =>
        fail
          ? { status: 500, body: errorBody("INTERNAL_ERROR", "Error") }
          : { status: 200, body: { data: [], meta: { page: 1, pageSize: 25, total: 0 } } },
    });
    expect(
      (await screen.findAllByText("No pudimos cargar los terceros.", undefined, { timeout: 5_000 }))
        .length,
    ).toBeGreaterThan(0);
    fail = false;
    await userEvent.setup().click(screen.getAllByRole("button", { name: "Intentar de nuevo" })[0]!);
    expect((await screen.findAllByText("Todavía no hay terceros")).length).toBeGreaterThan(0);
  }, 10_000);

  it("el operador registra y corrige, pero no desactiva", async () => {
    renderParties({ "GET /api/v1/parties": page([party()]) }, OPERATOR_ME);
    await screen.findAllByText("Comercial Andina S.A.");
    expect(screen.getByRole("button", { name: "Nuevo tercero" })).toBeDefined();
    expect(screen.queryAllByRole("button", { name: /Desactivar a/ })).toEqual([]);
    expect(
      screen.getAllByRole("button", { name: "Corregir a Comercial Andina S.A." }).length,
    ).toBeGreaterThan(0);
  });

  it("registra un tercero con roles en chips y confirma con un aviso", async () => {
    const calls = renderParties({
      "GET /api/v1/parties": page([]),
      "POST /api/v1/parties": () => ({
        status: 201,
        body: { data: party({ roles: ["CUSTOMER", "CARRIER"] }) },
      }),
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Nuevo tercero" }));
    const dialog = await screen.findByRole("dialog", { name: "Nuevo tercero" });
    expect(await within(dialog).findByText("Regla: 13 dígitos terminados en 001.")).toBeDefined();
    // El tipo reservado no se ofrece.
    expect(within(dialog).queryByRole("option", { name: "VENTA A CONSUMIDOR FINAL" })).toBeNull();
    await user.type(within(dialog).getByLabelText("Identificación"), "1790012345001");
    await user.type(
      within(dialog).getByLabelText("Razón social o nombres"),
      "Comercial Andina S.A.",
    );
    await user.click(within(dialog).getByRole("button", { name: "Transportista" }));
    await user.click(within(dialog).getByRole("button", { name: "Cliente" }));
    expect(
      within(dialog).getByRole("button", { name: "Cliente" }).getAttribute("aria-pressed"),
    ).toBe("true");
    await user.click(within(dialog).getByRole("button", { name: "Registrar tercero" }));
    expect(await screen.findByText("Registraste a Comercial Andina S.A.")).toBeDefined();
    expect(calls.find((c) => c.key === "POST /api/v1/parties")?.body).toEqual({
      identificationType: "04",
      identification: "1790012345001",
      legalName: "Comercial Andina S.A.",
      address: null,
      email: null,
      phone: null,
      roles: ["CUSTOMER", "CARRIER"],
    });
  });

  it("una identificación repetida vuelve al campo y ofrece ver el tercero existente", async () => {
    renderParties({
      "GET /api/v1/parties": page([]),
      "POST /api/v1/parties": () => ({
        status: 409,
        body: errorBody(
          "PARTY_IDENTIFICATION_TAKEN",
          "Ya existe un tercero con esa identificación: Comercial Andina S.A.",
        ),
      }),
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Nuevo tercero" }));
    const dialog = await screen.findByRole("dialog", { name: "Nuevo tercero" });
    await user.type(within(dialog).getByLabelText("Identificación"), "1790012345001");
    await user.type(within(dialog).getByLabelText("Razón social o nombres"), "Otra S.A.");
    await user.click(within(dialog).getByRole("button", { name: "Registrar tercero" }));
    const field = within(dialog).getByLabelText("Identificación");
    await waitFor(() => expect(field.getAttribute("aria-invalid")).toBe("true"));
    expect(within(dialog).getByText(/Ya existe un tercero con esa identificación/)).toBeDefined();
    await user.click(within(dialog).getByRole("button", { name: "Ver el tercero existente" }));
    expect(navigation.replace).toHaveBeenCalledWith("/terceros?q=1790012345001&estado=todos", {
      scroll: false,
    });
  });

  it("un conflicto de versión se explica en el diálogo sin perder lo escrito", async () => {
    renderParties({
      "GET /api/v1/parties": page([party()]),
      "PUT /api/v1/parties/p-1": () => ({
        status: 409,
        body: errorBody(
          "PARTY_CHANGED",
          "Otro usuario cambió este tercero después de que lo abriste. Recarga para ver sus datos.",
        ),
      }),
    });
    const user = userEvent.setup();
    await user.click(
      (await screen.findAllByRole("button", { name: "Corregir a Comercial Andina S.A." }))[0]!,
    );
    const dialog = await screen.findByRole("dialog", { name: "Corregir tercero" });
    const name = within(dialog).getByLabelText("Razón social o nombres");
    await user.clear(name);
    await user.type(name, "Andina Corregida S.A.");
    await user.click(within(dialog).getByRole("button", { name: "Guardar cambios" }));
    expect(await within(dialog).findByText(/Otro usuario cambió este tercero/)).toBeDefined();
    expect((name as HTMLInputElement).value).toBe("Andina Corregida S.A.");
  });

  it("el diálogo se abre con el teclado y Escape lo cierra", async () => {
    renderParties({ "GET /api/v1/parties": page([]) });
    const user = userEvent.setup();
    const button = await screen.findByRole("button", { name: "Nuevo tercero" });
    button.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("dialog", { name: "Nuevo tercero" })).toBeDefined();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("pantalla Terceros sin permiso", () => {
  it("explica que no tiene acceso y no consulta la lista", async () => {
    vi.resetModules();
    vi.doMock("@/lib/permissions", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/permissions")>();
      return { ...actual, canSee: () => false };
    });
    const { PartiesScreen: Screen } = await import("@/features/parties/parties-screen");
    const { SessionGate: Gate } = await import("@/components/session");
    const calls = mockApi({ "GET /api/v1/me": () => ({ status: 200, body: { data: ADMIN_ME } }) });
    renderApp(
      <Gate fallback={<p>cargando</p>}>
        <Screen />
      </Gate>,
    );
    expect(await screen.findByText("No tienes acceso a Terceros")).toBeDefined();
    expect(calls.some((c) => c.key.startsWith("GET /api/v1/parties"))).toBe(false);
    vi.doUnmock("@/lib/permissions");
  });
});
