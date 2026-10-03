// Rutas autenticadas: el shell solo se muestra con sesión y membresía activa (design D12).
import { Suspense, type ReactNode } from "react";
import { AppShell, ShellSkeleton } from "@/components/app-shell";
import { SessionGate } from "@/components/session";
import { EnvironmentBadge, EnvironmentNotice } from "@/features/company/environment-notice";
import { CertificateNotice } from "@/features/signing/certificate-notice";

export default function AuthenticatedLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <SessionGate fallback={<ShellSkeleton />}>
        <AppShell
          notice={
            <>
              <EnvironmentNotice />
              <CertificateNotice />
            </>
          }
          status={<EnvironmentBadge />}
        >
          {children}
        </AppShell>
      </SessionGate>
    </Suspense>
  );
}
