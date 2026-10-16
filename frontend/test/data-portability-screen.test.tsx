// Portabilidad de datos (add-data-portability, design D23; tarea 6.1): la carga, el vacío, el error
// con reintento y sin permiso; la cola, el progreso, el listo, el fallido y el caducado; la
// confirmación al generar de nuevo; el `409`; y la descarga como enlace del mismo origen, sin Blob.
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DATA_EXPORT_FAILURE_CODES } from "@facturador/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionGate } from "@/components/session";
import {
  DataPortabilityScreen,
  FAILURE_MESSAGES,
} from "@/features/data-portability/data-portability-screen";
import {
  ADMIN_ME,
  OPERATOR_ME,
  errorBody,
  mockApi,
  navigation,
  renderApp,
  type Route,
} from "./harness";

const HOUR = 3_600_000;
const SHA = "0123456789abcdef".repeat(4);

function exportView(overrides: Record<string, unknown> = {}) {
  return {
    id: "e1",
    status: "QUEUED",
    phase: null,
    progress: null,
    requestedBy: { name: "Ana Admin" },
    requestedAt: "2026-10-08T15:00:00.000Z",
    startedAt: null,
    snapshotAt: null,
    generatedAt: null,
    expiresAt: null,
    finishedAt: null,
    sizeBytes: null,
    sha256: null,
    formatVersion: "1",
    counts: null,
    errorCode: null,
    expiredReason: null,
    ...overrides,
  };
}

/** Lista, con su caducidad relativa al reloj real: la pantalla compara con el de la consulta. */
const readyView = (overrides: Record<string, unknown> = {}) =>
  exportView({
    id: "r1",
    status: "READY",
    startedAt: "2026-10-08T15:00:01.000Z",
    snapshotAt: "2026-10-08T15:00:02.000Z",
    generatedAt: new Date(Date.now() - HOUR).toISOString(),
    expiresAt: new Date(Date.now() + 23 * HOUR).toISOString(),
    sizeBytes: "1610612736",
    sha256: SHA,
    counts: {
      documentsTest: 3,
      documentsProduction: 1,
      files: 9,
      parties: 2,
      products: 1,
      stockMovements: 4,
      auditEvents: 5,
      users: 2,
    },
    ...overrides,
  });

const page = (rows: unknown[]) => ({
  status: 200,
  body: { data: rows, meta: { page: 1, pageSize: 25, total: rows.length } },
});

function renderScreen(
  list: Route,
  routes: Record<string, Route> = {},
  me: typeof ADMIN_ME | typeof OPERATOR_ME = ADMIN_ME,
) {
  const calls = mockApi({
    "GET /api/v1/me": () => ({ status: 200, body: { data: me } }),
    "GET /api/v1/data-exports": list,
    ...routes,
  });
  renderApp(
    <SessionGate fallback={<p>cargando</p>}>
      <DataPortabilityScreen />
    </SessionGate>,
  );
  return calls;
}

const exportCalls = (calls: { key: string }[]) =>
  calls.filter((call) => call.key.startsWith("POST /api/v1/data-exports"));

beforeEach(() => {
  navigation.pathname = "/configuracion/portabilidad";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Portabilidad de datos (design D23)", () => {
  it("carga y, sin exportaciones, explica el paquete y ofrece generarlo", async () => {
    renderScreen(() => page([]));
    await screen.findByText("Todavía no generaste una exportación");
    expect(screen.getByRole("button", { name: "Generar exportación" })).toBeDefined();
    const content = screen.getByRole("region", { name: "Qué contiene el paquete" }).textContent;
    expect(content).toContain("Pruebas y de Producción");
    expect(content).toContain("La firma electrónica, su contraseña ni ningún otro secreto.");
    expect(content).toContain("Los borradores sin emitir");
    expect(content).toContain("No es un respaldo");
    expect(content).toContain("24 horas después de quedar listo");
    expect(content).toContain("SHA256SUMS");
    // Sin exportaciones no hay historia.
    expect(screen.queryByRole("region", { name: "Historial" })).toBeNull();
    // La pestaña nombra la pantalla: el título es solo para lectores de pantalla.
    expect(
      screen.getByRole("heading", { level: 1, name: "Portabilidad de datos" }).className,
    ).toContain("sr-only");
  });

  it("muestra el error con reintento", { timeout: 10_000 }, async () => {
    let fail = true;
    renderScreen(() =>
      fail ? { status: 500, body: errorBody("INTERNAL_ERROR", "falló") } : page([]),
    );
    // Un 500 se reintenta antes de mostrar el error.
    const retry = await screen.findByRole(
      "button",
      { name: "Intentar de nuevo" },
      { timeout: 5_000 },
    );
    expect(screen.getByRole("alert").textContent).toContain("No pudimos completar la operación");
    fail = false;
    await userEvent.setup().click(retry);
    await screen.findByText("Todavía no generaste una exportación");
  });

  it("el operador ve que no tiene acceso, sin consultar exportaciones", async () => {
    const calls = renderScreen(() => page([]), {}, OPERATOR_ME);
    await screen.findByText("No tienes permiso para ver esta sección");
    expect(
      screen.getByText("Solo un administrador exporta los datos de la empresa."),
    ).toBeDefined();
    expect(calls.some((call) => call.key.includes("/data-exports"))).toBe(false);
  });

  it("un 403 del servidor también se muestra como sin acceso", async () => {
    renderScreen(() => ({ status: 403, body: errorBody("FORBIDDEN", "Sin acceso.") }));
    await screen.findByText("No tienes permiso para ver esta sección");
  });

  it("genera la exportación y muestra la cola", async () => {
    let rows: unknown[] = [];
    const calls = renderScreen(() => page(rows), {
      "POST /api/v1/data-exports": () => {
        rows = [exportView()];
        return { status: 202, body: { data: exportView() } };
      },
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Generar exportación" }));
    expect(
      (await screen.findAllByText("Esperando su turno para generarse.")).length,
    ).toBeGreaterThan(0);
    expect(exportCalls(calls)).toEqual([{ key: "POST /api/v1/data-exports", body: {} }]);
    expect(screen.getAllByText("En cola").length).toBeGreaterThan(0);
    expect(
      screen.getByText("Puedes salir de esta pantalla: la exportación sigue generándose."),
    ).toBeDefined();
    // Con una en curso no se ofrece generar otra.
    expect(screen.queryByRole("button", { name: "Generar exportación" })).toBeNull();
  });

  it("consulta el progreso por fase, sin porcentaje, hasta que queda lista", async () => {
    let polls = 0;
    renderScreen(() => {
      polls += 1;
      return page([
        polls < 3
          ? exportView({
              status: "GENERATING",
              phase: "ARTIFACTS",
              progress: { done: 1200, total: 3400 },
              startedAt: "2026-10-08T15:00:01.000Z",
            })
          : readyView({ id: "e1" }),
      ]);
    });
    await screen.findByText("Agregando los comprobantes: 1.200 de 3.400 comprobantes.");
    expect(document.body.textContent).not.toMatch(/\d\s?%/);
    await screen.findByRole("link", { name: "Descargar paquete" }, { timeout: 6_000 });
    // La historia también se actualiza al terminar, aunque ya no haya una generación activa.
    const history = screen.getByRole("region", { name: "Historial" });
    expect((await within(history).findAllByText(/^Disponible hasta/)).length).toBeGreaterThan(0);
    expect(within(history).queryByText(/Agregando los comprobantes/)).toBeNull();
  }, 10_000);

  it("el paquete listo muestra sus datos, copia el SHA-256 y se descarga por navegación", async () => {
    const calls = renderScreen(() => page([readyView()]));
    const link = await screen.findByRole("link", { name: "Descargar paquete" });
    expect(link.getAttribute("href")).toBe("/api/v1/data-exports/r1/download");
    expect(link.hasAttribute("download")).toBe(true);
    expect(screen.getByText("1,5 GB")).toBeDefined();
    expect(screen.getByText(/1\.610\.612\.736 bytes/)).toBeDefined();
    expect(screen.getByLabelText(`SHA-256 ${SHA}`).textContent).toBe(SHA);
    expect(screen.getByText("Datos al")).toBeDefined();
    expect(screen.getByText("Disponible hasta")).toBeDefined();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Copiar SHA-256" }));
    expect(await navigator.clipboard.readText()).toBe(SHA);
    await screen.findByText("Copiaste el SHA-256.");

    // El enlace lo sigue el navegador: la pantalla nunca pide el paquete con fetch.
    link.addEventListener("click", (event) => event.preventDefault());
    await user.click(link);
    expect(calls.some((call) => call.key.includes("/download"))).toBe(false);
    // Con un paquete vigente, descargar es la acción principal y generar, la secundaria.
    expect(screen.getByRole("button", { name: "Generar exportación" })).toBeDefined();
  });

  it("generar de nuevo con un paquete vigente pide confirmación", async () => {
    const calls = renderScreen(() => page([readyView()]), {
      "POST /api/v1/data-exports": () => ({ status: 202, body: { data: exportView() } }),
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Generar exportación" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("El paquete actual sigue disponible");
    expect(dialog.textContent).toContain("el actual caduca");
    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    expect(exportCalls(calls)).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Generar exportación" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Generar exportación",
      }),
    );
    await waitFor(() => expect(exportCalls(calls)).toHaveLength(1));
  });

  it("explica el 409 de una exportación ya en curso", async () => {
    renderScreen(() => page([]), {
      "POST /api/v1/data-exports": () => ({
        status: 409,
        body: errorBody("DATA_EXPORT_IN_PROGRESS", "Ya hay una exportación en cola."),
      }),
    });
    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Generar exportación" }));
    await screen.findByText(
      "Ya hay una exportación en cola o generándose. Espera a que termine para generar otra.",
    );
  });

  it("explica cada código de falla sin detalles internos y ofrece generar de nuevo", async () => {
    for (const code of DATA_EXPORT_FAILURE_CODES) {
      renderScreen(() =>
        page([
          exportView({ status: "FAILED", errorCode: code, finishedAt: "2026-10-08T15:10:00Z" }),
        ]),
      );
      const message = await screen.findByText(FAILURE_MESSAGES[code]);
      expect(message.textContent).not.toMatch(/DATA_EXPORT|\/|\.zip/);
      expect(screen.getAllByText("Fallida").length).toBeGreaterThan(0);
      expect(screen.getByRole("button", { name: "Generar exportación" })).toBeDefined();
      cleanup();
      vi.unstubAllGlobals();
    }
  });

  it("una falla más reciente que el paquete vigente se explica junto a él", async () => {
    renderScreen(() =>
      page([
        exportView({
          id: "f1",
          status: "FAILED",
          errorCode: "DATA_EXPORT_INSUFFICIENT_SPACE",
          finishedAt: "2026-10-08T16:00:00Z",
        }),
        readyView(),
      ]),
    );
    await screen.findByText(FAILURE_MESSAGES.DATA_EXPORT_INSUFFICIENT_SPACE);
    expect(screen.getByRole("link", { name: "Descargar paquete" })).toBeDefined();
  });

  it("la caducidad: vencida sin barrer, por vencimiento y por reemplazo", async () => {
    renderScreen(() =>
      page([
        readyView({ expiresAt: new Date(Date.now() - 1_000).toISOString() }),
        exportView({
          id: "x1",
          status: "EXPIRED",
          expiredReason: "REPLACED",
          snapshotAt: "2026-10-07T15:00:00Z",
          generatedAt: "2026-10-07T15:05:00Z",
          expiresAt: "2026-10-08T15:05:00Z",
          sizeBytes: "2048",
          sha256: SHA,
          finishedAt: "2026-10-08T10:00:00Z",
        }),
      ]),
    );
    await screen.findByText(
      "El paquete caducó 24 horas después de quedar listo. Genera una exportación nueva.",
    );
    expect(screen.queryByRole("link", { name: "Descargar paquete" })).toBeNull();
    expect(screen.getAllByText("Expirada").length).toBeGreaterThan(0);
    const history = screen.getByRole("region", { name: "Historial" });
    expect(
      (await within(history).findAllByText("Reemplazada por una más reciente")).length,
    ).toBeGreaterThan(0);
    expect(within(history).getAllByText("Caducó").length).toBeGreaterThan(0);
  });
});
