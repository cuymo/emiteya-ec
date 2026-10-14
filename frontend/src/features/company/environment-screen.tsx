// Ambiente (add-taxpayer-setup, design D6 y D14). Usuario: administrador. Objetivo: pasar de
// Pruebas a Producción cuando la empresa está lista, o volver a Pruebas. Decisión: si emitir con
// validez tributaria desde ahora. Acción principal: Cambiar a Producción o Volver a Pruebas.
// Riesgo crítico: pasar a Producción exige escribir el RUC de la empresa (CTX §6).
"use client";

import { CircleCheck, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
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

  const heading = (
    <h1 id="ambiente-titulo" className="text-3xl font-bold">
      Ambiente
    </h1>
  );
  if (!allowed) {
    return (
      <section aria-labelledby="ambiente-titulo" className="flex flex-col gap-6">
        {heading}
        <EmptyState
          kind="no-permission"
          title="No tienes permiso para ver esta sección"
          description="Solo un administrador cambia el ambiente."
        />
      </section>
    );
  }
  if (taxpayer.isPending || status.isPending) return <EnvironmentSkeleton />;
  if (taxpayer.isError || status.isError) {
    const error = taxpayer.error ?? status.error;
    return (
      <section aria-labelledby="ambiente-titulo" className="flex flex-col gap-6">
        {heading}
        <ErrorState
          message={errorMessage(error)}
          onRetry={() => void Promise.all([taxpayer.refetch(), status.refetch()])}
        />
      </section>
    );
  }

  const view = taxpayer.data;
  const production = view.environment === "PRODUCTION";
  const target = production ? "TEST" : "PRODUCTION";
  const pending = status.data.readiness.checks.filter((check) => check.status === "PENDING");

  return (
    <section aria-labelledby="ambiente-titulo" className="flex max-w-2xl flex-col gap-6">
      {heading}
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

      {view.configured ? (
        <div>
          <Button variant={production ? "outline" : "primary"} onClick={() => setConfirming(true)}>
            {production ? "Volver a Pruebas" : "Cambiar a Producción"}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div>
            <Button disabled aria-describedby="ambiente-sin-datos">
              Cambiar a Producción
            </Button>
          </div>
          <p id="ambiente-sin-datos" className="text-sm text-foreground-muted">
            Registra primero los datos de la empresa.{" "}
            <Link
              href="/configuracion/empresa"
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              Ir a Empresa
            </Link>
          </p>
        </div>
      )}

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
    </section>
  );
}

export function EnvironmentSkeleton() {
  return (
    <section aria-busy="true" className="flex max-w-2xl flex-col gap-6">
      <h1 className="text-3xl font-bold">Ambiente</h1>
      <Skeleton className="h-6 w-24" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-10 w-48" />
    </section>
  );
}
