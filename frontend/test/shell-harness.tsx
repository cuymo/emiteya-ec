// Montaje del shell autenticado para las pruebas (spec web-application-shell): la misma composición
// que `app/(app)/layout.tsx`, con la API simulada de la sesión, la empresa y la firma.
import type { ReactNode } from "react";
import { AppShell, ShellSkeleton } from "@/components/shell/app-shell";
import { SessionGate } from "@/components/session";
import { EnvironmentBadge, EnvironmentNotice } from "@/features/company/environment-notice";
import { ShellCompanyContext } from "@/features/company/shell-company-context";
import { CertificateNotice } from "@/features/signing/certificate-notice";
import { ADMIN_ME, OPERATOR_ME, errorBody, mockApi, renderApp, type Route } from "./harness";

export const TEST_NOTICE = "Ambiente de Pruebas: los comprobantes no tienen validez tributaria.";

export type ShellOptions = {
  me?: typeof ADMIN_ME | typeof OPERATOR_ME;
  environment?: "TEST" | "PRODUCTION";
  displayName?: string | null;
  companyFails?: boolean;
  validity?: Record<string, unknown>;
  sidebarDefaultOpen?: boolean;
  children?: ReactNode;
  routes?: Record<string, Route>;
};

export function api({
  me = ADMIN_ME,
  environment = "TEST",
  displayName = "Ferretería Andina",
  companyFails = false,
  validity = {
    state: "VALID",
    usable: true,
    notAfter: "2027-06-30T23:59:59.000Z",
    daysToExpiry: 259,
  },
}: ShellOptions = {}) {
  return mockApi({
    "GET /api/v1/me": () => ({ status: 200, body: { data: me } }),
    "GET /api/v1/company/status": () =>
      companyFails
        ? { status: 503, body: errorBody("UNAVAILABLE", "x") }
        : {
            status: 200,
            body: {
              data: {
                environment,
                displayName,
                readiness: { ready: false, checks: [{ key: "TAXPAYER_DATA", status: "MET" }] },
              },
            },
          },
    "GET /api/v1/signing-certificate/validity": () => ({ status: 200, body: { data: validity } }),
    "POST /api/auth/sign-out": () => ({ status: 200, body: { success: true } }),
  });
}

export function renderShell(options: ShellOptions = {}) {
  return renderApp(
    <SessionGate fallback={<ShellSkeleton />}>
      <AppShell
        sidebarDefaultOpen={options.sidebarDefaultOpen ?? true}
        company={<ShellCompanyContext />}
        environment={<EnvironmentBadge />}
        notices={
          <>
            <EnvironmentNotice />
            <CertificateNotice />
          </>
        }
      >
        {options.children ?? <p>contenido</p>}
      </AppShell>
    </SessionGate>,
  );
}
