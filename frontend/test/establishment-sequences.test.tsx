// Secuenciales en Establecimientos (decisión del propietario, 2026-10-16; add-fiscal-numbering,
// design D14): cada punto despliega los contadores del ambiente vigente, y «Ajustar» abre el diálogo.
import type { FiscalSequenceView } from "@facturador/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionGate } from "@/components/session";
import { EstablishmentsScreen } from "@/features/establishments/establishments-screen";
import {
  ADMIN_ME,
  OPERATOR_ME,
  errorBody,
  mockApi,
  navigation,
  renderApp,
  type Route,
} from "./harness";

type Environment = "TEST" | "PRODUCTION";
type DocumentType = FiscalSequenceView["documentType"];

const TYPES: DocumentType[] = ["01", "03", "04", "05", "06", "07"];
const ESTABLISHMENT = { id: "e1", code: "001", status: "ACTIVE" } as const;
const POINT = { id: "p1", code: "001", status: "ACTIVE", available: true } as const;
const INACTIVE_POINT = { id: "p2", code: "002", status: "INACTIVE", available: false } as const;

/** Seis contadores de un punto; `overrides` fija siguiente y último reservado por tipo. */
function pointViews(
  environment: Environment,
  overrides: Partial<Record<DocumentType, Partial<FiscalSequenceView>>> = {},
  emissionPoint: FiscalSequenceView["emissionPoint"] = POINT,
): FiscalSequenceView[] {
  return TYPES.map((documentType) => ({
    establishment: ESTABLISHMENT,
    emissionPoint,
    environment,
    documentType,
    nextNumber: 1,
    lastReserved: null,
    exhausted: false,
    ...overrides[documentType],
  }));
}

const ESTABLISHMENTS = [
  {
    ...ESTABLISHMENT,
    address: "Av. Amazonas N24-03, Quito",
    emissionPoints: [POINT, INACTIVE_POINT],
  },
];

const STATUS = (environment: Environment) => ({
  environment,
  displayName: "Andina",
  readiness: { ready: false, checks: [] },
});

const TEST_LIST = [
  ...pointViews("TEST", {
    "01": { nextNumber: 101, lastReserved: 100 },
    "04": { nextNumber: 200, lastReserved: 100 },
    "06": { nextNumber: null, lastReserved: 999_999_999, exhausted: true },
  }),
  ...pointViews("TEST", {}, INACTIVE_POINT),
];

function renderScreen(
  lists: Partial<Record<Environment, () => FiscalSequenceView[]>>,
  routes: Record<string, Route> = {},
  {
    me = ADMIN_ME as typeof ADMIN_ME | typeof OPERATOR_ME,
    environment = "TEST" as Environment,
  } = {},
) {
  const calls = mockApi({
    "GET /api/v1/me": () => ({ status: 200, body: { data: me } }),
    "GET /api/v1/establishments": () => ({ status: 200, body: { data: ESTABLISHMENTS } }),
    "GET /api/v1/company/status": () => ({ status: 200, body: { data: STATUS(environment) } }),
    "GET /api/v1/fiscal-sequences?environment=TEST": () => ({
      status: 200,
      body: { data: lists.TEST?.() ?? [] },
    }),
    "GET /api/v1/fiscal-sequences?environment=PRODUCTION": () => ({
      status: 200,
      body: { data: lists.PRODUCTION?.() ?? [] },
    }),
    ...routes,
  });
  renderApp(
    <SessionGate fallback={<p>cargando</p>}>
      <EstablishmentsScreen />
    </SessionGate>,
  );
  return calls;
}

/** Despliega los secuenciales del punto, si no lo están, y devuelve su lista. */
async function sequencesOf(point: string) {
  const toggle = await screen.findByRole("button", { name: `Secuenciales del punto ${point}` });
  if (toggle.getAttribute("aria-expanded") !== "true") await userEvent.setup().click(toggle);
  return screen.findByRole("list", { name: `Secuenciales del punto ${point}` });
}

const rowsOf = async (point: string) => within(await sequencesOf(point)).getAllByRole("listitem");

async function openAdjust(type: string, point = "001-001") {
  const list = await sequencesOf(point);
  await userEvent.setup().click(
    within(list).getByRole("button", {
      name: `Ajustar el siguiente secuencial de ${type} del punto ${point}`,
    }),
  );
  return screen.getByRole("dialog");
}

async function typeNext(dialog: HTMLElement, value: string) {
  const user = userEvent.setup();
  const input = within(dialog).getByLabelText("Siguiente secuencial");
  await user.clear(input);
  await user.type(input, value);
  return input as HTMLInputElement;
}

const PUT_FACTURA = "PUT /api/v1/establishments/e1/emission-points/p1/sequences/TEST/01";
const PUT_NOTA = "PUT /api/v1/establishments/e1/emission-points/p1/sequences/TEST/04";

beforeEach(() => {
  navigation.pathname = "/configuracion/establecimientos";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("secuenciales de cada punto (design D14)", () => {
  it("lista por punto los seis tipos con el siguiente completo y el último reservado", async () => {
    renderScreen({ TEST: () => TEST_LIST });
    const rows = await rowsOf("001-001");
    expect(rows.map((row) => row.querySelector("span")?.textContent)).toEqual([
      "Factura",
      "Liquidación de compra",
      "Nota de crédito",
      "Nota de débito",
      "Guía de remisión",
      "Comprobante de retención",
    ]);
    expect(rows[0]!.textContent).toContain("Siguiente 001-001-000000101");
    expect(rows[0]!.textContent).toContain("Último reservado 000000100");
    expect(rows[1]!.textContent).toContain("Siguiente 001-001-000000001");
    expect(rows[1]!.textContent).toContain("Último reservado —");
    expect(screen.getByText("Secuenciales de Pruebas, el ambiente vigente.")).toBeDefined();
    // Plegados hasta que se piden: el otro punto no los muestra.
    expect(screen.queryByRole("list", { name: "Secuenciales del punto 001-002" })).toBeNull();
  });

  it("un punto inactivo también muestra y ajusta sus secuenciales", async () => {
    renderScreen({ TEST: () => TEST_LIST });
    const rows = await rowsOf("001-002");
    expect(rows).toHaveLength(6);
    expect(
      (
        within(rows[0]!).getByRole("button", {
          name: "Ajustar el siguiente secuencial de factura del punto 001-002",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("un contador agotado se muestra Agotado, sin siguiente secuencial y sin ajuste", async () => {
    renderScreen({ TEST: () => TEST_LIST });
    const guide = (await rowsOf("001-001"))[4]!;
    expect(within(guide).getByText("Agotado")).toBeDefined();
    expect(guide.textContent).toContain("No admite más comprobantes de este tipo en este punto.");
    expect(guide.textContent).not.toContain("Siguiente");
    expect(guide.textContent).toContain("Último reservado 999999999");
    expect(document.body.textContent).not.toContain("1000000000");
    expect(
      (
        within(guide).getByRole("button", {
          name: "Ajustar el siguiente secuencial de guía de remisión del punto 001-001",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("muestra solo los del ambiente vigente", async () => {
    const calls = renderScreen(
      {
        TEST: () => TEST_LIST,
        PRODUCTION: () => pointViews("PRODUCTION", { "01": { nextNumber: 1501 } }),
      },
      {},
      { environment: "PRODUCTION" },
    );
    const production = await rowsOf("001-001");
    expect(production[0]!.textContent).toContain("Siguiente 001-001-000001501");
    expect(screen.getByText("Secuenciales de Producción, el ambiente vigente.")).toBeDefined();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(calls.some((call) => call.key === "GET /api/v1/fiscal-sequences?environment=TEST")).toBe(
      false,
    );
  });

  it("un punto sin secuenciales en el ambiente lo explica", async () => {
    renderScreen({ TEST: () => pointViews("TEST") });
    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Secuenciales del punto 001-002" }));
    expect(
      await screen.findByText("Este punto todavía no tiene secuenciales en este ambiente."),
    ).toBeDefined();
  });

  it("un error de carga ofrece reintentar", async () => {
    let fail = true;
    renderScreen(
      {},
      {
        "GET /api/v1/fiscal-sequences?environment=TEST": () =>
          fail
            ? {
                status: 500,
                body: errorBody("INTERNAL_ERROR", "No pudimos completar la operación."),
              }
            : { status: 200, body: { data: TEST_LIST } },
      },
    );
    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Secuenciales del punto 001-001" }));
    // La consulta reintenta los fallos del servidor dos veces antes de mostrar el error.
    const alert = await screen.findByRole("alert", undefined, { timeout: 5_000 });
    fail = false;
    await userEvent.setup().click(within(alert).getByRole("button"));
    expect((await rowsOf("001-001"))[0]!.textContent).toContain("001-001-000000101");
  }, 10_000);

  it("sin permiso no consulta los secuenciales", async () => {
    const calls = renderScreen({ TEST: () => TEST_LIST }, {}, { me: OPERATOR_ME });
    expect(await screen.findByText("No tienes permiso para ver esta sección")).toBeDefined();
    expect(calls.some((call) => call.key.includes("fiscal-sequences"))).toBe(false);
  });
});

describe("diálogo Ajustar (design D14)", () => {
  it("al avanzar avisa de los números sin usar y guarda con el valor esperado", async () => {
    let list = TEST_LIST;
    const calls = renderScreen(
      { TEST: () => list },
      {
        [PUT_FACTURA]: () => {
          list = pointViews("TEST", { "01": { nextNumber: 1501, lastReserved: 100 } });
          return { status: 200, body: { data: list[0] } };
        },
      },
    );
    const dialog = await openAdjust("factura");
    expect(within(dialog).getByText("Factura · punto 001-001 · Pruebas")).toBeDefined();
    expect(within(dialog).getByText("000000101")).toBeDefined();
    expect(within(dialog).getByText("000000100")).toBeDefined();
    await typeNext(dialog, "1501");
    expect(within(dialog).getByText("Los números del 101 al 1500 no se usarán.")).toBeDefined();
    expect(within(dialog).queryByLabelText("Motivo")).toBeNull();
    await userEvent.setup().click(within(dialog).getByRole("button", { name: "Guardar ajuste" }));
    expect(
      await screen.findByText(
        "Ajustaste el siguiente secuencial de factura del punto 001-001 (Pruebas) a 001-001-000001501.",
      ),
    ).toBeDefined();
    expect(calls.find((call) => call.key === PUT_FACTURA)?.body).toEqual({
      nextNumber: 1501,
      expectedNextNumber: 101,
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect((await rowsOf("001-001"))[0]!.textContent).toContain("001-001-000001501");
  });

  it("al retroceder revela el motivo obligatorio y lo envía", async () => {
    const calls = renderScreen(
      { TEST: () => TEST_LIST },
      { [PUT_NOTA]: () => ({ status: 200, body: { data: { ...TEST_LIST[2], nextNumber: 150 } } }) },
    );
    const dialog = await openAdjust("nota de crédito");
    await typeNext(dialog, "150");
    expect(
      within(dialog).getByText(
        "Retrocedes el secuencial. Los números reservados no se reutilizan.",
      ),
    ).toBeDefined();
    const user = userEvent.setup();
    await user.click(within(dialog).getByRole("button", { name: "Guardar ajuste" }));
    expect(
      await within(dialog).findByText("Retroceder el secuencial exige un motivo."),
    ).toBeDefined();
    expect(calls.some((call) => call.key === PUT_NOTA)).toBe(false);
    await user.type(within(dialog).getByLabelText("Motivo"), "Corrige un avance por error");
    await user.click(within(dialog).getByRole("button", { name: "Guardar ajuste" }));
    await waitFor(() =>
      expect(calls.find((call) => call.key === PUT_NOTA)?.body).toEqual({
        nextNumber: 150,
        expectedNextNumber: 200,
        reason: "Corrige un avance por error",
      }),
    );
  });

  it("rechaza un número ya reservado en su campo, en el cliente y desde el servidor", async () => {
    const calls = renderScreen(
      { TEST: () => TEST_LIST },
      {
        [PUT_NOTA]: () => ({
          status: 409,
          body: errorBody(
            "SEQUENCE_NUMBER_RESERVED",
            "El número 150 ya está reservado; el siguiente debe ser mayor que 160.",
          ),
        }),
      },
    );
    const dialog = await openAdjust("nota de crédito");
    const user = userEvent.setup();
    const input = await typeNext(dialog, "100");
    await user.type(within(dialog).getByLabelText("Motivo"), "Retroceso");
    await user.click(within(dialog).getByRole("button", { name: "Guardar ajuste" }));
    expect(
      await within(dialog).findByText(
        "El último secuencial reservado es 100; el siguiente debe ser mayor.",
      ),
    ).toBeDefined();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(calls.some((call) => call.key === PUT_NOTA)).toBe(false);

    await typeNext(dialog, "150");
    await user.click(within(dialog).getByRole("button", { name: "Guardar ajuste" }));
    expect(
      await within(dialog).findByText(
        "El número 150 ya está reservado; el siguiente debe ser mayor que 160.",
      ),
    ).toBeDefined();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.value).toBe("150");
  });

  it("un conflicto ofrece recargar el valor vigente", async () => {
    let list = TEST_LIST;
    renderScreen(
      { TEST: () => list },
      {
        [PUT_FACTURA]: () => {
          // Una reserva concurrente avanzó el contador mientras el administrador decidía.
          list = pointViews("TEST", { "01": { nextNumber: 105, lastReserved: 104 } });
          return {
            status: 409,
            body: errorBody(
              "SEQUENCE_CHANGED",
              "El siguiente secuencial cambió mientras ajustabas. Recarga para ver el valor vigente.",
            ),
          };
        },
      },
    );
    const dialog = await openAdjust("factura");
    await typeNext(dialog, "1501");
    const user = userEvent.setup();
    await user.click(within(dialog).getByRole("button", { name: "Guardar ajuste" }));
    expect(await within(dialog).findByText(/cambió mientras ajustabas/)).toBeDefined();
    await user.click(within(dialog).getByRole("button", { name: "Recargar" }));
    await waitFor(() => expect(within(dialog).getByText("000000105")).toBeDefined());
    expect((within(dialog).getByLabelText("Siguiente secuencial") as HTMLInputElement).value).toBe(
      "105",
    );
    expect(within(dialog).queryByText(/cambió mientras ajustabas/)).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Recargar" })).toBeNull();
  });

  it("bloquea el doble envío mientras el ajuste está pendiente", async () => {
    renderScreen(
      { TEST: () => TEST_LIST },
      { [PUT_FACTURA]: () => ({ status: 200, body: { data: TEST_LIST[0] } }) },
    );
    // El PUT queda retenido hasta `release` y se cuentan los envíos que llegan a la red.
    const base = globalThis.fetch;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let puts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init: RequestInit = {}) => {
        if (init.method === "PUT") {
          puts++;
          await gate;
        }
        return base(input, init);
      }),
    );
    const dialog = await openAdjust("factura");
    const input = await typeNext(dialog, "1501");
    const user = userEvent.setup();
    const save = within(dialog).getByRole("button", { name: "Guardar ajuste" });
    await user.click(save);
    await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(true));
    await user.click(save);
    await user.type(input, "{Enter}");
    release();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(puts).toBe(1);
  });
});
