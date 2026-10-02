// Utilidades de prueba: proveedores reales de la aplicación, navegación simulada y un fetch que
// responde por método y ruta, como lo haría el backend.
import { render } from "@testing-library/react";
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
  return render(
    <ThemeProvider>
      <QueryProvider>
        <TooltipProvider delayDuration={0}>
          {ui}
          <SemanticToaster />
        </TooltipProvider>
      </QueryProvider>
    </ThemeProvider>,
  );
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
