// Correos (add-email-delivery, design D14). Usuario: administrador. Objetivo: que los comprobantes
// autorizados salgan por el servidor de correo de la empresa. Va en un recuadro centrado bajo las
// pestañas, que ya nombran la pantalla (el título queda para los lectores de pantalla).
"use client";

import type { ReactNode } from "react";
import { errorMessage } from "@/components/feedback";
import { useSession } from "@/components/session";
import { EmptyState, ErrorState, Skeleton } from "@/components/states";
import { canSee } from "@/lib/permissions";
import { useEmailSettings } from "./email-api";

export function EmailScreen() {
  const { me } = useSession();
  const allowed = canSee(me.role, "email.configure");
  const query = useEmailSettings(allowed);
  const frame = (children: ReactNode, busy = false) => (
    <section
      aria-labelledby="correos-titulo"
      aria-busy={busy || undefined}
      data-panel-width="form"
      data-panel-align="center"
      className="flex flex-col gap-6"
    >
      <h1 id="correos-titulo" className="sr-only">
        Correos
      </h1>
      {children}
    </section>
  );

  if (!allowed) {
    return frame(
      <EmptyState
        kind="no-permission"
        title="No tienes permiso para ver esta sección"
        description="Solo un administrador configura el servidor de correo de la empresa."
      />,
    );
  }
  if (query.isPending) return frame(<Skeleton className="h-96 w-full" />, true);
  if (query.isError) {
    return frame(
      <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />,
    );
  }
  return frame(null);
}
