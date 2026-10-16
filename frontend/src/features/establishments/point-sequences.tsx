// Secuenciales de un punto de emisión, dentro de Establecimientos (decisión del propietario,
// 2026-10-16: la pestaña Secuenciales pasó aquí). Solo los del ambiente vigente de la empresa: en
// Pruebas, los de Pruebas; en Producción, los de Producción. Cada contador muestra el siguiente
// número completo y el último reservado, y «Ajustar» abre el diálogo de siempre (add-fiscal-numbering,
// design D14). Un contador agotado no se ajusta.
"use client";

import {
  DOCUMENT_TYPE_LABELS,
  documentNumber,
  formatSequential,
  type Environment,
  type FiscalSequenceView,
} from "@facturador/contracts";
import { Pencil } from "lucide-react";
import { ErrorState, Skeleton, StatusBadge } from "@/components/states";
import { Button } from "@/components/ui/button";
import { ENVIRONMENT_LABELS } from "@/features/company/company-api";

/** Lo que la pantalla sabe de los secuenciales del ambiente vigente, común a todos los puntos. */
export type SequencesState = {
  environment: Environment | null;
  loading: boolean;
  /** El mensaje del error de carga, del ambiente o de la lista. */
  error: string | null;
  retry: () => void;
  canAdjust: boolean;
  onAdjust: (view: FiscalSequenceView) => void;
  byPoint: ReadonlyMap<string, FiscalSequenceView[]>;
};

function CounterRow({
  view,
  point,
  canAdjust,
  onAdjust,
}: {
  view: FiscalSequenceView;
  point: string;
  canAdjust: boolean;
  onAdjust: () => void;
}) {
  const label = DOCUMENT_TYPE_LABELS[view.documentType];
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
      <div className="flex min-w-0 flex-col gap-0.5 text-sm">
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
        <span className="text-xs text-foreground-muted">
          Último reservado{" "}
          <span className="tabular-nums">
            {view.lastReserved === null ? "—" : formatSequential(view.lastReserved)}
          </span>
        </span>
      </div>
      {canAdjust && (
        <Button
          variant="outline"
          size="sm"
          aria-label={`Ajustar el siguiente secuencial de ${label.toLowerCase()} del punto ${point}`}
          disabled={view.exhausted}
          onClick={onAdjust}
        >
          <Pencil aria-hidden="true" />
          Ajustar
        </Button>
      )}
    </li>
  );
}

export function PointSequences({
  id,
  pointId,
  point,
  state,
}: {
  id: string;
  pointId: string;
  /** La etiqueta del punto, por ejemplo 001-002. */
  point: string;
  state: SequencesState;
}) {
  const views = state.byPoint.get(pointId);
  let body;
  if (state.error) {
    body = <ErrorState message={state.error} onRetry={state.retry} />;
  } else if (state.loading || state.environment === null) {
    body = (
      <div aria-busy="true" className="flex flex-col gap-2 p-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  } else if (!views || views.length === 0) {
    body = (
      <p className="px-3 py-2 text-sm text-foreground-muted">
        Este punto todavía no tiene secuenciales en este ambiente.
      </p>
    );
  } else {
    body = (
      <ul aria-label={`Secuenciales del punto ${point}`} className="divide-y divide-border">
        {views.map((view) => (
          <CounterRow
            key={view.documentType}
            view={view}
            point={point}
            canAdjust={state.canAdjust}
            onAdjust={() => state.onAdjust(view)}
          />
        ))}
      </ul>
    );
  }
  return (
    <div id={id} className="basis-full rounded-md border border-border bg-background">
      {state.environment !== null && (
        <p className="border-b border-border px-3 py-2 text-xs text-foreground-muted">
          Secuenciales de {ENVIRONMENT_LABELS[state.environment]}, el ambiente vigente.
        </p>
      )}
      {body}
    </div>
  );
}
