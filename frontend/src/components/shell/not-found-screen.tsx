// Dirección inexistente (add-shell-not-found-page). Con sesión, la 404 se muestra dentro del shell,
// con la barra lateral y la barra superior, como cualquier pantalla; sin sesión, sola, sin pedir
// datos de la empresa ni llevar al inicio de sesión. Vive en la 404 raíz de Next y no en una ruta
// comodín: `/api/:path*` se reescribe como `fallback`, después de las rutas dinámicas, y un comodín
// taparía la API.
"use client";

import { RouteNotFound } from "@/components/route-states/route-states";
import { SessionGate, useMe } from "@/components/session";
import { EnvironmentBanner } from "@/features/company/environment-notice";
import { ShellCompanyContext } from "@/features/company/shell-company-context";
import { CertificateNotice } from "@/features/signing/certificate-notice";
import { AppShell, ShellSkeleton } from "./app-shell";

export function NotFoundScreen({ sidebarDefaultOpen }: { sidebarDefaultOpen: boolean }) {
  const me = useMe();
  if (me.isPending) return <ShellSkeleton />;
  if (me.data) {
    return (
      <SessionGate fallback={<ShellSkeleton />}>
        <AppShell
          sidebarDefaultOpen={sidebarDefaultOpen}
          company={<ShellCompanyContext />}
          environment={<EnvironmentBanner />}
          notices={<CertificateNotice />}
        >
          <RouteNotFound />
        </AppShell>
      </SessionGate>
    );
  }
  return (
    <main
      id="contenido"
      className="flex min-h-dvh items-center justify-center bg-linear-to-b from-primary/8 via-background to-background px-4 py-12"
    >
      <RouteNotFound />
    </main>
  );
}
