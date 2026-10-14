// Secuenciales (add-fiscal-numbering, design D14). Usuario: administrador. Objetivo: revisar desde
// qué número sigue cada tipo de comprobante en cada punto y fijarlo cuando haga falta. Decisión: si
// ajustar el siguiente secuencial de un contador. Acción principal: Ajustar, en la fila del contador.
// P0: ambiente y lista por punto. P1: estado del punto y contadores agotados. P2 y P3: fuera.
"use client";

import {
  DOCUMENT_TYPE_LABELS,
  documentNumber,
  formatSequential,
  type Environment,
  type FiscalSequenceView,
} from "@facturador/contracts";
import { Pencil } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { RowActionButton } from "@/components/data-table/table-controls";
import { errorMessage } from "@/components/feedback";
import { SegmentedControl } from "@/components/segmented-control";
import { useSession } from "@/components/session";
import { EmptyState, ErrorState, Skeleton, StatusBadge } from "@/components/states";
import { Button } from "@/components/ui/button";
import { canSee } from "@/lib/permissions";
import { useCompanyStatus } from "@/features/company/company-api";
import { AdjustSequenceDialog } from "./adjust-dialog";
import { pointLabel, sequenceKey, useSequences } from "./sequences-api";

const ENVIRONMENT_OPTIONS = [
  { value: "TEST", label: "Pruebas" },
  { value: "PRODUCTION", label: "Producción" },
] as const;

/** Agrupa la lista plana por punto, conservando el orden de la API. */
function byPoint(views: FiscalSequenceView[]) {
  const groups = new Map<string, FiscalSequenceView[]>();
  for (const view of views) {
    groups.set(view.emissionPoint.id, [...(groups.get(view.emissionPoint.id) ?? []), view]);
  }
  return [...groups.values()];
}

function CounterRow({ view, onAdjust }: { view: FiscalSequenceView; onAdjust: () => void }) {
  const label = DOCUMENT_TYPE_LABELS[view.documentType];
  return (
    <li className="flex items-center justify-between gap-2 px-3 py-2">
      <div className="flex min-w-0 flex-col gap-1 text-sm">
        <span className="font-medium">{label}</span>
        {view.nextNumber === null ? (
          <span className="flex flex-wrap items-center gap-2 text-foreground-muted">
            <StatusBadge tone="danger" label="Agotado" />
            No admite más comprobantes de este tipo en este punto.
          </span>
        ) : (
          <span>
            <span className="text-foreground-muted">Siguiente </span>
            <span className="tabular-nums">
              {documentNumber(view.establishment.code, view.emissionPoint.code, view.nextNumber)}
            </span>
          </span>
        )}
        <span className="text-foreground-muted">
          Último reservado{" "}
          <span className="tabular-nums">
            {view.lastReserved === null ? "—" : formatSequential(view.lastReserved)}
          </span>
        </span>
      </div>
      <RowActionButton
        icon={Pencil}
        label={`Ajustar el siguiente secuencial de ${label.toLowerCase()}`}
        disabled={view.exhausted}
        onClick={onAdjust}
      />
    </li>
  );
}

export function SequencesScreen() {
  const { me } = useSession();
  const allowed = canSee(me.role, "sequences.read");
  const status = useCompanyStatus();
  const [chosen, setChosen] = useState<Environment | null>(null);
  // Parte del ambiente vigente; sin él (error), de Pruebas.
  const environment = chosen ?? status.data?.environment ?? (status.isError ? "TEST" : null);
  const sequences = useSequences(environment, allowed);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const editing = sequences.data?.find((view) => sequenceKey(view) === editingKey) ?? null;

  const heading = (
    <h1 id="secuenciales-titulo" className="text-3xl font-bold">
      Secuenciales
    </h1>
  );
  if (!allowed) {
    return (
      <section aria-labelledby="secuenciales-titulo" className="flex flex-col gap-6">
        {heading}
        <EmptyState
          kind="no-permission"
          title="No tienes permiso para ver esta sección"
          description="Solo un administrador consulta y ajusta los secuenciales."
        />
      </section>
    );
  }

  let content;
  if (environment === null || sequences.isPending) {
    content = (
      <div aria-busy="true" className="flex flex-col gap-2">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  } else if (sequences.isError) {
    content = (
      <ErrorState
        message={errorMessage(sequences.error)}
        onRetry={() => void sequences.refetch()}
      />
    );
  } else if (sequences.data.length === 0) {
    content = (
      <EmptyState
        kind="empty"
        title="Crea un establecimiento con un punto de emisión para ver sus secuenciales"
        action={
          <Button asChild variant="outline">
            <Link href="/configuracion/establecimientos">Ir a Establecimientos</Link>
          </Button>
        }
      />
    );
  } else {
    content = (
      <ul aria-label="Puntos de emisión" className="flex flex-col gap-3">
        {byPoint(sequences.data).map((views) => {
          const first = views[0]!;
          return (
            <li key={first.emissionPoint.id} className="rounded-lg border border-border bg-surface">
              <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                <h2 className="font-semibold">Punto {pointLabel(first)}</h2>
                {!first.emissionPoint.available && (
                  <>
                    <StatusBadge tone="neutral" label="No disponible" />
                    <span className="text-xs text-foreground-muted">
                      {first.emissionPoint.status === "INACTIVE"
                        ? "El punto está inactivo"
                        : "El establecimiento está inactivo"}
                    </span>
                  </>
                )}
              </div>
              <ul
                aria-label={`Secuenciales del punto ${pointLabel(first)}`}
                className="divide-y divide-border border-t border-border"
              >
                {views.map((view) => (
                  <CounterRow
                    key={view.documentType}
                    view={view}
                    onAdjust={() => setEditingKey(sequenceKey(view))}
                  />
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <section aria-labelledby="secuenciales-titulo" className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        {heading}
        <div className="flex items-center gap-2">
          <span id="ambiente-secuenciales" className="text-sm text-foreground-muted">
            Ambiente
          </span>
          <SegmentedControl
            options={ENVIRONMENT_OPTIONS}
            value={environment ?? undefined}
            onChange={setChosen}
            aria-labelledby="ambiente-secuenciales"
          />
        </div>
      </div>
      {content}
      <AdjustSequenceDialog
        view={editing}
        onOpenChange={(open) => !open && setEditingKey(null)}
        onReload={() => sequences.refetch()}
      />
    </section>
  );
}

export function SequencesSkeleton() {
  return (
    <section aria-busy="true" className="flex max-w-3xl flex-col gap-6">
      <h1 className="text-3xl font-bold">Secuenciales</h1>
      <Skeleton className="h-32 w-full" />
    </section>
  );
}
