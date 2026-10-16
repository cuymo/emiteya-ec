// Establecimientos (add-taxpayer-setup, design D7 y D14). Usuario: administrador. Objetivo:
// mantener los locales y puntos desde los que se emite. Decisión: qué crear, corregir, desactivar o
// reactivar. Volumen pequeño: lista agrupada por establecimiento, sin tabla paginada, centrada bajo
// las pestañas. La pestaña ya nombra la pantalla: el título queda solo para los lectores de
// pantalla, y crear un establecimiento es la tarjeta punteada que cierra la lista, donde irá el
// nuevo. Cada punto despliega sus secuenciales del ambiente vigente, que antes tenían su propia
// pestaña (point-sequences.tsx). P2 (fechas) y P3 (identificadores): fuera.
"use client";

import type {
  EmissionPointView,
  EstablishmentView,
  FiscalSequenceView,
} from "@facturador/contracts";
import { ChevronDown, ListOrdered, MapPin, Plus, Power, PowerOff } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { errorMessage } from "@/components/feedback";
import { useSession } from "@/components/session";
import { EmptyState, ErrorState, Skeleton, StatusBadge } from "@/components/states";
import { Button } from "@/components/ui/button";
import { canSee } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { useCompanyStatus } from "@/features/company/company-api";
import { AdjustSequenceDialog } from "@/features/sequences/adjust-dialog";
import { sequenceKey, useSequences } from "@/features/sequences/sequences-api";
import {
  AddPointDialog,
  CreateEstablishmentDialog,
  EditAddressDialog,
} from "./establishment-dialogs";
import {
  pointLabel,
  useChangeEmissionPointStatus,
  useChangeEstablishmentStatus,
  useEstablishments,
} from "./establishments-api";
import { PointSequences, type SequencesState } from "./point-sequences";

function PointStatus({ point }: { point: EmissionPointView }) {
  if (point.available) return <StatusBadge tone="success" label="Disponible" />;
  if (point.status === "INACTIVE") return <StatusBadge tone="neutral" label="Inactivo" />;
  return <StatusBadge tone="neutral" label="No disponible" />;
}

/**
 * Crear un establecimiento, al final de la lista: una tarjeta punteada en lugar de un botón en el
 * encabezado. Con la lista vacía es más alta y explica para qué sirve el primero.
 */
function AddEstablishmentCard({ first, onClick }: { first: boolean; onClick: () => void }) {
  const labelId = useId();
  const hintId = useId();
  return (
    <button
      type="button"
      aria-labelledby={labelId}
      aria-describedby={hintId}
      onClick={onClick}
      className={`group flex w-full gap-3 rounded-lg border border-dashed border-border text-left transition-colors outline-none hover:border-primary hover:bg-primary/5 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring ${
        first ? "flex-col items-center px-4 py-10 text-center" : "items-center px-3 py-3"
      }`}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-subtle text-foreground-muted transition-colors group-hover:text-primary">
        <Plus aria-hidden="true" className="size-4" />
      </span>
      <span className="flex flex-col gap-0.5">
        <span id={labelId} className="text-sm font-medium">
          {first ? "Crea tu primer establecimiento para poder emitir" : "Agregar establecimiento"}
        </span>
        <span id={hintId} className="text-xs text-foreground-muted">
          {first
            ? "Cada establecimiento necesita al menos un punto de emisión activo."
            : "Con el código de tres dígitos con que está registrado en el SRI."}
        </span>
      </span>
    </button>
  );
}

/** Agregar un punto, al final de los puntos del establecimiento: la misma forma punteada. */
function AddPointRow({ code, onClick }: { code: string; onClick: () => void }) {
  return (
    <div className="border-t border-border p-2">
      <button
        type="button"
        aria-label={`Agregar punto de emisión al establecimiento ${code}`}
        onClick={onClick}
        className="group flex w-full items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-left text-sm font-medium text-foreground-muted transition-colors outline-none hover:border-primary hover:bg-primary/5 hover:text-primary focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Plus aria-hidden="true" className="size-4" />
        Agregar punto de emisión
      </button>
    </div>
  );
}

/** Un punto de emisión: su estado, sus acciones y, al desplegarlos, sus secuenciales. */
function PointRow({
  establishment,
  point,
  sequences,
}: {
  establishment: EstablishmentView;
  point: EmissionPointView;
  sequences: SequencesState | null;
}) {
  const changePoint = useChangeEmissionPointStatus();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const label = pointLabel(establishment, point);
  const pointActive = point.status === "ACTIVE";
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
      <span className="flex flex-wrap items-center gap-2 text-sm">
        <span>Punto {label}</span>
        <PointStatus point={point} />
        {pointActive && establishment.status !== "ACTIVE" && (
          <span className="text-xs text-foreground-muted">El establecimiento está inactivo</span>
        )}
      </span>
      <span className="flex flex-wrap items-center gap-2">
        {sequences && (
          <Button
            variant="outline"
            size="sm"
            aria-label={`Secuenciales del punto ${label}`}
            aria-expanded={open}
            aria-controls={open ? panelId : undefined}
            onClick={() => setOpen((current) => !current)}
          >
            <ListOrdered aria-hidden="true" />
            Secuenciales
            <ChevronDown
              aria-hidden="true"
              className={cn("transition-transform", open && "rotate-180")}
            />
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          aria-label={`${pointActive ? "Desactivar" : "Reactivar"} el punto ${label}`}
          disabled={changePoint.isPending}
          onClick={() =>
            changePoint.mutate({
              establishment,
              point,
              status: pointActive ? "INACTIVE" : "ACTIVE",
            })
          }
        >
          {pointActive ? <PowerOff aria-hidden="true" /> : <Power aria-hidden="true" />}
          {pointActive ? "Desactivar" : "Reactivar"}
        </Button>
      </span>
      {sequences && open && (
        <PointSequences id={panelId} pointId={point.id} point={label} state={sequences} />
      )}
    </li>
  );
}

function EstablishmentItem({
  establishment,
  sequences,
  onEdit,
  onAddPoint,
}: {
  establishment: EstablishmentView;
  sequences: SequencesState | null;
  onEdit: () => void;
  onAddPoint: () => void;
}) {
  const changeStatus = useChangeEstablishmentStatus();
  const active = establishment.status === "ACTIVE";
  const code = establishment.code;
  return (
    <li className="rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">Establecimiento {code}</span>
            {active ? (
              <StatusBadge tone="success" label="Activo" />
            ) : (
              <StatusBadge tone="neutral" label="Inactivo" />
            )}
          </span>
          <span className="text-sm break-words text-foreground-muted">{establishment.address}</span>
        </div>
        {/* Acciones con su nombre a la vista: un ícono suelto no se reconoce como botón. */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            aria-label={`Corregir dirección del establecimiento ${code}`}
            onClick={onEdit}
          >
            <MapPin aria-hidden="true" />
            Corregir dirección
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-label={`${active ? "Desactivar" : "Reactivar"} el establecimiento ${code}`}
            disabled={changeStatus.isPending}
            onClick={() =>
              changeStatus.mutate({
                id: establishment.id,
                status: active ? "INACTIVE" : "ACTIVE",
              })
            }
          >
            {active ? <PowerOff aria-hidden="true" /> : <Power aria-hidden="true" />}
            {active ? "Desactivar" : "Reactivar"}
          </Button>
        </div>
      </div>
      {establishment.emissionPoints.length === 0 ? (
        <p className="border-t border-border px-4 py-3 text-sm text-foreground-muted">
          Sin puntos de emisión. Agrega uno para emitir desde este establecimiento.
        </p>
      ) : (
        <ul
          aria-label={`Puntos de emisión del establecimiento ${code}`}
          className="divide-y divide-border border-t border-border"
        >
          {establishment.emissionPoints.map((point) => (
            <PointRow
              key={point.id}
              establishment={establishment}
              point={point}
              sequences={sequences}
            />
          ))}
        </ul>
      )}
      <AddPointRow code={code} onClick={onAddPoint} />
    </li>
  );
}

export function EstablishmentsScreen() {
  const { me } = useSession();
  const allowed = canSee(me.role, "establishments.manage");
  const establishments = useEstablishments(allowed);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<EstablishmentView | null>(null);
  const [adding, setAdding] = useState<EstablishmentView | null>(null);

  // Secuenciales del ambiente vigente, una sola consulta para todos los puntos.
  const showSequences = allowed && canSee(me.role, "sequences.read");
  const status = useCompanyStatus();
  const environment = status.data?.environment ?? null;
  const sequences = useSequences(environment, showSequences);
  const [adjustingKey, setAdjustingKey] = useState<string | null>(null);
  const adjusting = sequences.data?.find((view) => sequenceKey(view) === adjustingKey) ?? null;
  const byPoint = useMemo(() => {
    const groups = new Map<string, FiscalSequenceView[]>();
    for (const view of sequences.data ?? []) {
      groups.set(view.emissionPoint.id, [...(groups.get(view.emissionPoint.id) ?? []), view]);
    }
    return groups;
  }, [sequences.data]);
  const sequencesState: SequencesState | null = showSequences
    ? {
        environment,
        loading: status.isPending || sequences.isPending,
        error: status.isError
          ? errorMessage(status.error)
          : sequences.isError
            ? errorMessage(sequences.error)
            : null,
        retry: () => void (status.isError ? status.refetch() : sequences.refetch()),
        canAdjust: canSee(me.role, "sequences.adjust"),
        onAdjust: (view) => setAdjustingKey(sequenceKey(view)),
        byPoint,
      }
    : null;

  // La pestaña ya nombra la pantalla: el título queda para los lectores de pantalla.
  const heading = (
    <h1 id="establecimientos-titulo" className="sr-only">
      Establecimientos
    </h1>
  );
  if (!allowed) {
    return (
      <section
        aria-labelledby="establecimientos-titulo"
        data-panel-width="form"
        data-panel-align="center"
        className="flex flex-col gap-6"
      >
        {heading}
        <EmptyState
          kind="no-permission"
          title="No tienes permiso para ver esta sección"
          description="Pide a un administrador que gestione los establecimientos."
        />
      </section>
    );
  }

  let content;
  if (establishments.isPending) {
    content = (
      <div aria-busy="true" className="flex flex-col gap-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  } else if (establishments.isError) {
    content = (
      <ErrorState
        message={errorMessage(establishments.error)}
        onRetry={() => void establishments.refetch()}
      />
    );
  } else if (establishments.data.length === 0) {
    content = <AddEstablishmentCard first onClick={() => setCreating(true)} />;
  } else {
    content = (
      <div className="flex flex-col gap-3">
        <ul aria-label="Establecimientos" className="flex flex-col gap-3">
          {establishments.data.map((establishment) => (
            <EstablishmentItem
              key={establishment.id}
              establishment={establishment}
              sequences={sequencesState}
              onEdit={() => setEditing(establishment)}
              onAddPoint={() => setAdding(establishment)}
            />
          ))}
        </ul>
        <AddEstablishmentCard first={false} onClick={() => setCreating(true)} />
      </div>
    );
  }

  return (
    <section
      aria-labelledby="establecimientos-titulo"
      data-panel-width="form"
      data-panel-align="center"
      className="flex flex-col gap-6"
    >
      {heading}
      {content}
      <CreateEstablishmentDialog open={creating} onOpenChange={setCreating} />
      <EditAddressDialog
        establishment={editing}
        onOpenChange={(open) => !open && setEditing(null)}
      />
      <AddPointDialog establishment={adding} onOpenChange={(open) => !open && setAdding(null)} />
      {showSequences && (
        <AdjustSequenceDialog
          view={adjusting}
          onOpenChange={(open) => !open && setAdjustingKey(null)}
          onReload={() => sequences.refetch()}
        />
      )}
    </section>
  );
}
