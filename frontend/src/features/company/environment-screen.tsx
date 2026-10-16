// Ambiente (add-taxpayer-setup, design D6 y D14). Usuario: administrador. Objetivo: pasar de
// Pruebas a Producción cuando la empresa está lista, o volver a Pruebas. Decisión: si emitir con
// validez tributaria desde ahora. Acción principal: Cambiar a Producción o Volver a Pruebas.
// Riesgo crítico: pasar a Producción exige escribir el RUC de la empresa (CTX §6), y su botón es
// rojo sólido, aquí y en la confirmación. Un recuadro centrado bajo las pestañas reúne el ambiente,
// la preparación para emitir y, al pie, la acción.
"use client";

import { CircleCheck, FlaskConical, ShieldAlert, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { errorMessage } from "@/components/feedback";
import { useSession } from "@/components/session";
import { EmptyState, ErrorState, Skeleton, StatusBadge } from "@/components/states";
import { Button } from "@/components/ui/button";
import { canSee } from "@/lib/permissions";
import {
  ENVIRONMENT_LABELS,
  READINESS_COPY,
  useChangeEnvironment,
  useCompanyStatus,
  useTaxpayer,
} from "./company-api";

export function EnvironmentScreen() {
  const { me } = useSession();
  const allowed = canSee(me.role, "environment.change");
  const taxpayer = useTaxpayer(allowed);
  const status = useCompanyStatus();
  const [confirming, setConfirming] = useState(false);
  const change = useChangeEnvironment({ onSuccess: () => setConfirming(false) });

  if (!allowed) {
    return (
      <EnvironmentFrame>
        <EmptyState
          kind="no-permission"
          title="No tienes permiso para ver esta sección"
          description="Solo un administrador cambia el ambiente."
        />
      </EnvironmentFrame>
    );
  }
  if (taxpayer.isPending || status.isPending) return <EnvironmentSkeleton />;
  if (taxpayer.isError || status.isError) {
    const error = taxpayer.error ?? status.error;
    return (
      <EnvironmentFrame>
        <ErrorState
          message={errorMessage(error)}
          onRetry={() => void Promise.all([taxpayer.refetch(), status.refetch()])}
        />
      </EnvironmentFrame>
    );
  }

  const view = taxpayer.data;
  const production = view.environment === "PRODUCTION";
  const target = production ? "TEST" : "PRODUCTION";
  const pending = status.data.readiness.checks.filter((check) => check.status === "PENDING");

  return (
    <EnvironmentFrame>
      <div className="flex flex-col rounded-lg border border-border bg-surface">
        <div className="flex flex-col gap-4 p-4">
          <div className="flex flex-col gap-2">
            <div>
              {production ? (
                <StatusBadge tone="success" label="Producción" icon={CircleCheck} />
              ) : (
                <StatusBadge tone="warning" label="Pruebas" icon={TriangleAlert} />
              )}
            </div>
            <p className="text-sm">
              {production
                ? "Los comprobantes autorizados tienen validez tributaria."
                : "Los comprobantes que se emitan no tienen validez tributaria. En Producción, los comprobantes autorizados la tienen."}
            </p>
          </div>
          <div className="flex flex-col gap-1 text-sm">
            <p className="font-medium">
              {status.data.readiness.ready ? "Lista para emitir" : "Aún no puede emitir"}
            </p>
            {pending.length > 0 && (
              <p className="text-foreground-muted">
                Pendiente: {pending.map((check) => READINESS_COPY[check.key].title).join(", ")}.
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 rounded-b-lg border-t border-border bg-surface-subtle px-4 py-3">
          {view.configured ? (
            // Pasar a Producción es la acción de mayor riesgo: rojo sólido, aquí y al confirmar.
            <Button
              size="default"
              variant={production ? "outline" : "danger"}
              onClick={() => setConfirming(true)}
            >
              {production ? (
                <FlaskConical aria-hidden="true" />
              ) : (
                <ShieldAlert aria-hidden="true" />
              )}
              {production ? "Volver a Pruebas" : "Cambiar a Producción"}
            </Button>
          ) : (
            <>
              <p id="ambiente-sin-datos" className="mr-auto text-sm text-foreground-muted">
                Registra primero los datos de la empresa.{" "}
                <Link
                  href="/configuracion/empresa"
                  className="font-medium text-primary underline-offset-2 hover:underline"
                >
                  Ir a Empresa
                </Link>
              </p>
              <Button
                size="default"
                variant="danger"
                disabled
                aria-describedby="ambiente-sin-datos"
              >
                <ShieldAlert aria-hidden="true" />
                Cambiar a Producción
              </Button>
            </>
          )}
        </div>
      </div>

      {view.configured && view.profile && view.version !== null && (
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title={production ? "Volver a Pruebas" : "Cambiar a Producción"}
          description={
            production
              ? "Los comprobantes que se emitan después no tendrán validez tributaria."
              : "Desde ahora, los comprobantes autorizados tendrán validez tributaria. Escribe el RUC de la empresa para confirmar."
          }
          confirmLabel={production ? "Volver a Pruebas" : "Cambiar a Producción"}
          tone={production ? "primary" : "danger"}
          pending={change.isPending}
          {...(production
            ? {}
            : { typedConfirmation: { label: "RUC de la empresa", expected: view.profile.ruc } })}
          onConfirm={() =>
            change.mutate({ environment: target, expectedVersion: view.version as number })
          }
        />
      )}
      <span className="sr-only" aria-live="polite">
        {`Ambiente vigente: ${ENVIRONMENT_LABELS[view.environment]}`}
      </span>
    </EnvironmentFrame>
  );
}

/**
 * Columna centrada bajo las pestañas, que ya nombran la pantalla: el título queda para los lectores
 * de pantalla.
 */
function EnvironmentFrame({ busy = false, children }: { busy?: boolean; children: ReactNode }) {
  return (
    <section
      aria-labelledby="ambiente-titulo"
      aria-busy={busy || undefined}
      data-panel-width="reading"
      data-panel-align="center"
      className="flex flex-col gap-6"
    >
      <h1 id="ambiente-titulo" className="sr-only">
        Ambiente
      </h1>
      {children}
    </section>
  );
}

export function EnvironmentSkeleton() {
  return (
    <EnvironmentFrame busy>
      <Skeleton className="h-40 w-full" />
    </EnvironmentFrame>
  );
}
