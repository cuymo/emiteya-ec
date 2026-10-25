// Dirección inexistente (adopt-premium-design-foundation-and-shell, design D16; add-shell-not-found-page).
// Con sesión monta el shell; sin sesión, la página sola (`NotFoundScreen`). No hay una ruta comodín:
// `next.config.ts` reescribe `/api/:path*` como `fallback` después de las rutas dinámicas, y un
// comodín taparía la API.
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { ShellSkeleton } from "@/components/shell/app-shell";
import { NotFoundScreen } from "@/components/shell/not-found-screen";
import { SIDEBAR_COOKIE_NAME, sidebarDefaultOpen } from "@/lib/navigation/sidebar-state";

export const metadata: Metadata = { title: "Página no encontrada · EmiteYa" };

export default async function NotFound() {
  const open = sidebarDefaultOpen((await cookies()).get(SIDEBAR_COOKIE_NAME)?.value);
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <NotFoundScreen sidebarDefaultOpen={open} />
    </Suspense>
  );
}
