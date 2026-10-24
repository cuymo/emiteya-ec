// Avisos de la barra superior (decisión del propietario, 2026-10-22): la campana cuenta los avisos
// pendientes y abre su lista; cada aviso sale de una condición del servidor (firma, preparación para
// emitir y resumen del tablero), primero los que impiden emitir, y lleva a su sección solo si el rol
// la abre. Con el correo (add-email-delivery, tarea 11.2): los comprobantes sin enviar por correo,
// con el enlace a la bandeja filtrada.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionGate } from "@/components/session";
import { NotificationsMenu } from "@/features/notifications/notifications-menu";
import { ADMIN_ME, OPERATOR_ME, mockApi, navigation, renderApp, type Route } from "./harness";

const months = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
const summary = (signals: {
  attention?: number;
  rejected?: number;
  outOfStock?: number;
  emailFailed?: number;
}): Route => {
  const data = {
    environment: "TEST",
    today: "2026-10-22",
    month: {
      start: "2026-10-01",
      invoices: {
        authorizedTotal: "0.00",
        authorizedCount: 0,
        issuedCount: 0,
        previousAuthorizedTotal: "0.00",
        previousChangePercent: null,
      },
      byType: [],
    },
    monthly: months.map((month) => ({ month, authorizedTotal: "0.00", authorizedCount: 0 })),
    attention: {
      count: signals.attention ?? 0,
      rejectedLast30Days: signals.rejected ?? 0,
      emailFailed: signals.emailFailed ?? 0,
    },
    email: { pending: 0 },
    sri: { transmissionEnabled: true, lastContact: null },
    drafts: { invoices: 0 },
    inventory: { outOfStock: signals.outOfStock ?? 0 },
    topCustomers: [],
    topProducts: [],
    recent: [],
  };
  return () => ({ status: 200, body: { data } });
};
const validity = (state: string, daysToExpiry: number | null = null): Route => {
  const data = {
    state,
    usable: state === "VALID" || state === "EXPIRING",
    notAfter: state === "NONE" ? null : "2026-11-12T23:59:59.000Z",
    daysToExpiry,
  };
  return () => ({ status: 200, body: { data } });
};
const status = (pending: string[] = []): Route => {
  const data = {
    environment: "TEST",
    displayName: "Ferretería Andina",
    readiness: {
      ready: pending.length === 0,
      checks: ["TAXPAYER_DATA", "EMISSION_POINT", "SIGNING_CERTIFICATE"].map((key) => ({
        key,
        status: pending.includes(key) ? "PENDING" : "MET",
      })),
    },
  };
  return () => ({ status: 200, body: { data } });
};

function renderMenu(
  routes: Record<string, Route>,
  me: typeof ADMIN_ME | typeof OPERATOR_ME = ADMIN_ME,
) {
  mockApi({
    "GET /api/v1/me": () => ({ status: 200, body: { data: me } }),
    "GET /api/v1/signing-certificate/validity": validity("VALID", 200),
    "GET /api/v1/company/status": status(),
    "GET /api/v1/dashboard": summary({}),
    ...routes,
  });
  renderApp(
    <SessionGate fallback={<p>cargando</p>}>
      <NotificationsMenu />
    </SessionGate>,
  );
}

const bell = (name: string | RegExp) => screen.findByRole("button", { name });
const open = async (name: string | RegExp) => {
  await userEvent.setup().click(await bell(name));
  return screen.findByRole("list", { name: "Avisos pendientes" });
};

beforeEach(() => {
  navigation.pathname = "/";
  navigation.search = new URLSearchParams();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("avisos de la barra superior", () => {
  it("cuenta los avisos y los lista, primero lo que impide emitir, cada uno con su sección", async () => {
    renderMenu({
      "GET /api/v1/signing-certificate/validity": validity("EXPIRING", 21),
      "GET /api/v1/company/status": status(["EMISSION_POINT"]),
      "GET /api/v1/dashboard": summary({ attention: 3, rejected: 2, outOfStock: 1 }),
    });
    await waitFor(async () => expect(await bell("Avisos: 5 pendientes")).toBeDefined());
    // El contador va siempre en verde (decisión del propietario, 2026-10-22); lo que impide emitir
    // va primero en la lista.
    expect(document.querySelector("[data-slot=notifications-count]")?.className).toContain(
      "bg-success",
    );
    const list = await open("Avisos: 5 pendientes");
    const items = within(list).getAllByRole("listitem");
    expect(items.map((item) => item.getAttribute("data-tone"))).toEqual([
      "danger",
      "warning",
      "warning",
      "warning",
      "warning",
    ]);
    expect(items[0]!.textContent).toContain("Tu empresa todavía no puede emitir");
    expect(items[0]!.textContent).toContain("Falta: punto de emisión.");
    expect(
      within(items[0]!)
        .getByRole("link", { name: "Crear un punto de emisión" })
        .getAttribute("href"),
    ).toBe("/configuracion/establecimientos");
    expect(items[1]!.textContent).toContain("La firma electrónica vence pronto");
    expect(items[1]!.textContent).toContain("(faltan 21 días)");
    expect(
      within(items[1]!).getByRole("link", { name: "Ir a Firma electrónica" }).getAttribute("href"),
    ).toBe("/configuracion/firma");
    expect(items[2]!.textContent).toContain("3 comprobantes requieren atención");
    expect(items[3]!.textContent).toContain("2 comprobantes devueltos o no autorizados");
    expect(items[4]!.textContent).toContain("1 producto agotado");
    expect(
      within(items[4]!).getByRole("link", { name: "Ir a Inventario" }).getAttribute("href"),
    ).toBe("/inventario");
  });

  it("avisa de los comprobantes sin enviar por correo y lleva a la bandeja filtrada", async () => {
    renderMenu({ "GET /api/v1/dashboard": summary({ emailFailed: 2 }) }, OPERATOR_ME);
    const list = await open("Avisos: 1 pendiente");
    const [item] = within(list).getAllByRole("listitem");
    expect(item!.getAttribute("data-tone")).toBe("warning");
    expect(item!.textContent).toContain("2 comprobantes sin enviar por correo");
    expect(item!.textContent).toContain("Su último envío falló.");
    expect(
      within(item!).getByRole("link", { name: "Ver los correos no enviados" }).getAttribute("href"),
    ).toBe("/comprobantes?correo=no-enviado");
  });

  it("un solo comprobante sin enviar se dice en singular", async () => {
    renderMenu({ "GET /api/v1/dashboard": summary({ emailFailed: 1 }) });
    const list = await open("Avisos: 1 pendiente");
    expect(within(list).getByText("1 comprobante sin enviar por correo")).toBeDefined();
  });

  it("al operador le dice a quién pedir lo que no puede resolver, sin enlace a Configuración", async () => {
    renderMenu(
      {
        "GET /api/v1/signing-certificate/validity": validity("EXPIRING", 1),
        "GET /api/v1/company/status": status(["TAXPAYER_DATA"]),
      },
      OPERATOR_ME,
    );
    const list = await open("Avisos: 2 pendientes");
    const [readiness, signing] = within(list).getAllByRole("listitem");
    expect(signing!.textContent).toContain(
      "(falta 1 día). Pide a un administrador que la renueve.",
    );
    expect(readiness!.textContent).toContain(
      "Pide a un administrador que complete la configuración.",
    );
    expect(within(list).queryAllByRole("link")).toEqual([]);
  });

  it("la firma vencida no se repite entre los requisitos para emitir", async () => {
    renderMenu({
      "GET /api/v1/signing-certificate/validity": validity("EXPIRED", null),
      "GET /api/v1/company/status": status(["SIGNING_CERTIFICATE"]),
    });
    const list = await open("Avisos: 1 pendiente");
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(list.textContent).toContain("La firma electrónica venció");
    expect(list.textContent).toContain("no se puede emitir");
  });

  it("sin avisos, la campana no lleva contador y dice que todo está en orden", async () => {
    renderMenu({});
    const button = await bell("Avisos: ninguno pendiente");
    expect(document.querySelector("[data-slot=notifications-count]")).toBeNull();
    await userEvent.setup().click(button);
    expect(await screen.findByText("Todo en orden: no hay avisos pendientes.")).toBeDefined();
  });

  it("elegir un aviso cierra la lista", async () => {
    renderMenu({ "GET /api/v1/dashboard": summary({ outOfStock: 2 }) });
    const list = await open("Avisos: 1 pendiente");
    await userEvent.setup().click(within(list).getByRole("link", { name: "Ir a Inventario" }));
    await waitFor(() =>
      expect(screen.queryByRole("list", { name: "Avisos pendientes" })).toBeNull(),
    );
  });
});
