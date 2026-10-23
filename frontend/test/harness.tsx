// Utilidades de prueba: proveedores reales de la aplicación, navegación simulada y un fetch que
// responde por método y ruta, como lo haría el backend.
import { render, screen, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import type { ReactNode } from "react";
import { vi } from "vitest";
import { SemanticToaster } from "@/components/feedback";
import { QueryProvider } from "@/components/session";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/menu-and-tooltip";

export { navigation } from "./navigation";

export type Route = (init: RequestInit & { body?: string }) => { status: number; body?: unknown };

/** Responde a `${method} ${path}`; la ruta puede incluir la consulta o no. */
export function mockApi(routes: Record<string, Route>) {
  const calls: { key: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string, init: RequestInit = {}) => {
      const method = (init.method ?? "GET").toUpperCase();
      const path = String(input);
      const key = routes[`${method} ${path}`]
        ? `${method} ${path}`
        : `${method} ${path.split("?")[0]}`;
      const route = routes[key];
      const body = typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
      calls.push({ key: `${method} ${path}`, body });
      if (!route) return Promise.resolve(new Response(JSON.stringify({}), { status: 404 }));
      const result = route(init as RequestInit & { body?: string });
      return Promise.resolve(
        new Response(result.body === undefined ? null : JSON.stringify(result.body), {
          status: result.status,
          headers: { "content-type": "application/json" },
        }),
      );
    }),
  );
  return calls;
}

export function renderApp(ui: ReactNode) {
  const wrap = (node: ReactNode) => (
    <ThemeProvider>
      <QueryProvider>
        <TooltipProvider delayDuration={0}>
          {node}
          <SemanticToaster />
        </TooltipProvider>
      </QueryProvider>
    </ThemeProvider>
  );
  const view = render(wrap(ui));
  /** Vuelve a dibujar con los mismos proveedores y la misma caché, como tras navegar. */
  return Object.assign(view, { rerenderApp: (next: ReactNode) => view.rerender(wrap(next)) });
}

export const ADMIN_ME = { name: "Ana Admin", email: "ana@empresa.ec", role: "ADMIN" } as const;
export const OPERATOR_ME = {
  name: "Óscar Operador",
  email: "oscar@empresa.ec",
  role: "OPERATOR",
} as const;

export function errorBody(code: string, message: string) {
  return { error: { code, message, requestId: "req-prueba-1" } };
}

const monthName = new Intl.DateTimeFormat("es-EC", { month: "long" });

/** El nombre accesible de un día del calendario, como «15 de octubre de 2026», sin el día de la semana. */
export const calendarDay = (iso: string) => {
  const [year, month, day] = iso.split("-").map(Number);
  const name = monthName.format(new Date(year!, month! - 1, 1));
  return new RegExp(`\\b${day} de ${name} de ${year}`);
};

/** Abre el calendario de un `DatePickerField`, va al año y al mes de la fecha, y devuelve el calendario. */
export async function openCalendar(user: UserEvent, label: string, iso: string) {
  const [year, month] = iso.split("-").map(Number);
  await user.click(screen.getByLabelText(label));
  const calendar = await screen.findByRole("dialog");
  await user.selectOptions(
    within(calendar).getByRole("combobox", { name: "Elegir el año" }),
    String(year),
  );
  await user.selectOptions(
    within(calendar).getByRole("combobox", { name: "Elegir el mes" }),
    String(month! - 1),
  );
  return calendar;
}

/** Elige una fecha en un `DatePickerField` como lo haría el usuario: con su calendario. */
export async function chooseDate(user: UserEvent, label: string, iso: string) {
  const calendar = await openCalendar(user, label, iso);
  await user.click(within(calendar).getByRole("button", { name: calendarDay(iso) }));
}
