// Inicio: preparación para emitir (add-taxpayer-setup, design D9 y D14). Usuario: administrador y
// operador. Objetivo: saber si la empresa puede emitir y, si no, qué falta. Decisión: qué requisito
// resolver primero o a quién pedírselo. Acción principal: para el administrador, el enlace al primer
// requisito pendiente; el operador no tiene acción. P2: ambiente vigente.
"use client";

import { Circle, CircleCheck, TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { CompanyStatus } from "@facturador/contracts";
import { useSession } from "@/components/session";
import { ErrorState, Skeleton, StatusBadge } from "@/components/states";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/components/feedback";
import { canSee } from "@/lib/permissions";
import {
  ENVIRONMENT_LABELS,
  READINESS_COPY,
  useCompanyStatus,
} from "@/features/company/company-api";

/** Los requisitos para emitir, con el enlace al primero pendiente; también los usa el tablero. */
export function ReadinessChecks({
  status,
  canConfigure,
}: {
  status: CompanyStatus;
  canConfigure: boolean;
}) {
  const primary = status.readiness.checks.find(
    (check) => check.status === "PENDING" && READINESS_COPY[check.key].action,
  );
  return (
    <>
      <ol
        aria-label="Requisitos"
        className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface"
      >
        {status.readiness.checks.map((check) => {
          const copy = READINESS_COPY[check.key];
          const met = check.status === "MET";
          const Icon = met ? CircleCheck : Circle;
          return (
            <li key={check.key} className="flex items-start gap-3 px-4 py-3">
              <Icon
                aria-hidden="true"
                className={
                  met
                    ? "mt-1 size-5 shrink-0 text-success"
                    : "mt-1 size-5 shrink-0 text-foreground-muted"
                }
              />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="text-sm font-semibold">
                  {copy.title}
                  <span className="sr-only">{met ? ": cumplido" : ": pendiente"}</span>
                </p>
                <p className="text-sm text-foreground-muted">{met ? copy.met : copy.pending}</p>
              </div>
              {!met && canConfigure && copy.action && check.key !== primary?.key && (
                <Link
                  href={copy.action.href}
                  className="text-sm font-medium text-primary underline-offset-2 hover:underline"
                >
                  Configurar
                </Link>
              )}
            </li>
          );
        })}
      </ol>
      {canConfigure && primary && READINESS_COPY[primary.key].action && (
        <div>
          <Button asChild>
            <Link href={READINESS_COPY[primary.key].action!.href}>
              {READINESS_COPY[primary.key].action!.label}
            </Link>
          </Button>
        </div>
      )}
    </>
  );
}

export function ReadinessScreen() {
  const { me } = useSession();
  const status = useCompanyStatus();
  const canConfigure = canSee(me.role, "taxpayer.configure");

  if (status.isPending) return <ReadinessSkeleton />;
  if (status.isError) {
    return (
      <section
        aria-labelledby="inicio-titulo"
        data-page-width="reading"
        className="flex flex-col gap-6"
      >
        <h1 id="inicio-titulo" className="text-3xl font-bold">
          Preparación para emitir
        </h1>
        <ErrorState message={errorMessage(status.error)} onRetry={() => void status.refetch()} />
      </section>
    );
  }

  const { ready } = status.data.readiness;
  return (
    <section
      aria-labelledby="inicio-titulo"
      data-page-width="reading"
      className="flex flex-col gap-6"
    >
      <div className="flex flex-col gap-2">
        <h1 id="inicio-titulo" className="text-3xl font-bold">
          Preparación para emitir
        </h1>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {ready ? (
            <StatusBadge tone="success" label="Lista para emitir" icon={CircleCheck} />
          ) : (
            <StatusBadge tone="warning" label="Aún no puede emitir" icon={TriangleAlert} />
          )}
          {status.data.displayName && (
            <span className="text-foreground-muted">{status.data.displayName}</span>
          )}
        </div>
      </div>
      <ReadinessChecks status={status.data} canConfigure={canConfigure} />
      {!ready && !canConfigure && (
        <p className="text-sm text-foreground-muted">
          Pide a un administrador que complete la configuración.
        </p>
      )}
      <p className="text-sm text-foreground-muted">
        Ambiente vigente: {ENVIRONMENT_LABELS[status.data.environment]}
      </p>
    </section>
  );
}

export function ReadinessSkeleton() {
  return (
    <section aria-busy="true" data-page-width="reading" className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold">Preparación para emitir</h1>
      <Skeleton className="h-6 w-32" />
      <Skeleton className="h-48 w-full" />
    </section>
  );
}
