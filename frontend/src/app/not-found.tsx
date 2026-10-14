// Dirección inexistente (adopt-premium-design-foundation-and-shell, design D16). Fuera del shell y sin
// pedir datos de la empresa. No hay una ruta comodín: `next.config.ts` reescribe `/api/:path*` como
// `fallback` después de las rutas dinámicas, y un comodín taparía la API.
import type { Metadata } from "next";
import { RouteNotFound } from "@/components/route-states/route-states";

export const metadata: Metadata = { title: "Página no encontrada · EmiteYa" };

export default function NotFound() {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex h-12 items-center border-b px-4">
        <span className="text-base font-semibold">EmiteYa</span>
      </header>
      <main id="contenido" className="flex flex-1 items-center justify-center px-4 py-6">
        <RouteNotFound />
      </main>
    </div>
  );
}
