// Rutas autenticadas: el shell solo se muestra con sesión y membresía activa (design D12 de
// add-user-access; adopt-premium-design-foundation-and-shell, design D11 y D12). El estado de la barra
// lateral se lee aquí de su cookie para renderizarlo en el servidor sin parpadeo.
import { cookies } from "next/headers";
import { Suspense, type ReactNode } from "react";
import { AppShell, ShellSkeleton } from "@/components/shell/app-shell";
import { SessionGate } from "@/components/session";
import { EnvironmentBadge, EnvironmentNotice } from "@/features/company/environment-notice";
import { ShellCompanyContext } from "@/features/company/shell-company-context";
import { CertificateNotice } from "@/features/signing/certificate-notice";
import { SIDEBAR_COOKIE_NAME, sidebarDefaultOpen } from "@/lib/navigation/sidebar-state";

export default async function AuthenticatedLayout({ children }: { children: ReactNode }) {
  const open = sidebarDefaultOpen((await cookies()).get(SIDEBAR_COOKIE_NAME)?.value);
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <SessionGate fallback={<ShellSkeleton />}>
        <AppShell
          sidebarDefaultOpen={open}
          company={<ShellCompanyContext />}
          environment={<EnvironmentBadge />}
          notices={
            <>
              <EnvironmentNotice />
              <CertificateNotice />
            </>
          }
        >
          {children}
        </AppShell>
      </SessionGate>
    </Suspense>
  );
}
