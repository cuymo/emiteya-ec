// Establecimientos (add-taxpayer-setup, design D7 y D14). Usuario: administrador. Objetivo:
// mantener los locales y puntos desde los que se emite. Decisión: qué crear, corregir, desactivar o
// reactivar. Acción principal: Crear establecimiento. Volumen pequeño: lista agrupada por
// establecimiento, sin tabla paginada. P2 (fechas) y P3 (identificadores): fuera.
"use client";

import type { EmissionPointView, EstablishmentView } from "@facturador/contracts";
import { CircleSlash, MapPin, Plus, RotateCcw } from "lucide-react";
import { useState } from "react";
import { RowActionButton } from "@/components/data-table/table-controls";
import { errorMessage } from "@/components/feedback";
import { useSession } from "@/components/session";
import { EmptyState, ErrorState, Skeleton, StatusBadge } from "@/components/states";
import { Button } from "@/components/ui/button";
import { canSee } from "@/lib/permissions";
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

function PointStatus({ point }: { point: EmissionPointView }) {
  if (point.available) return <StatusBadge tone="success" label="Disponible" />;
  if (point.status === "INACTIVE") return <StatusBadge tone="neutral" label="Inactivo" />;
  return <StatusBadge tone="neutral" label="No disponible" />;
}

function EstablishmentItem({
  establishment,
  onEdit,
  onAddPoint,
}: {
  establishment: EstablishmentView;
  onEdit: () => void;
  onAddPoint: () => void;
}) {
  const changeStatus = useChangeEstablishmentStatus();
  const changePoint = useChangeEmissionPointStatus();
  const active = establishment.status === "ACTIVE";
  return (
    <li className="rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-2 px-3 py-2">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">Establecimiento {establishment.code}</span>
            {active ? (
              <StatusBadge tone="success" label="Activo" />
            ) : (
              <StatusBadge tone="neutral" label="Inactivo" />
            )}
          </span>
          <span className="text-sm break-words text-foreground-muted">{establishment.address}</span>
        </div>
        <div className="flex items-center gap-1">
          <RowActionButton icon={MapPin} label="Corregir la dirección" onClick={onEdit} />
          <RowActionButton icon={Plus} label="Agregar punto de emisión" onClick={onAddPoint} />
          {active ? (
            <RowActionButton
              icon={CircleSlash}
              label="Desactivar establecimiento"
              disabled={changeStatus.isPending}
              onClick={() => changeStatus.mutate({ id: establishment.id, status: "INACTIVE" })}
            />
          ) : (
            <RowActionButton
              icon={RotateCcw}
              label="Reactivar establecimiento"
              disabled={changeStatus.isPending}
              onClick={() => changeStatus.mutate({ id: establishment.id, status: "ACTIVE" })}
            />
          )}
        </div>
      </div>
      {establishment.emissionPoints.length === 0 ? (
        <p className="border-t border-border px-3 py-2 text-sm text-foreground-muted">
          Sin puntos de emisión. Agrega uno para emitir desde este establecimiento.
        </p>
      ) : (
        <ul
          aria-label={`Puntos de emisión del establecimiento ${establishment.code}`}
          className="divide-y divide-border border-t border-border"
        >
          {establishment.emissionPoints.map((point) => (
            <li
              key={point.id}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-1"
            >
              <span className="flex flex-wrap items-center gap-2 text-sm">
                <span>Punto {pointLabel(establishment, point)}</span>
                <PointStatus point={point} />
                {point.status === "ACTIVE" && !active && (
                  <span className="text-xs text-foreground-muted">
                    El establecimiento está inactivo
                  </span>
                )}
              </span>
              {point.status === "ACTIVE" ? (
                <RowActionButton
                  icon={CircleSlash}
                  label={`Desactivar el punto ${pointLabel(establishment, point)}`}
                  disabled={changePoint.isPending}
                  onClick={() => changePoint.mutate({ establishment, point, status: "INACTIVE" })}
                />
              ) : (
                <RowActionButton
                  icon={RotateCcw}
                  label={`Reactivar el punto ${pointLabel(establishment, point)}`}
                  disabled={changePoint.isPending}
                  onClick={() => changePoint.mutate({ establishment, point, status: "ACTIVE" })}
                />
              )}
            </li>
          ))}
        </ul>
      )}
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

  const heading = (
    <h1 id="establecimientos-titulo" className="text-3xl font-bold">
      Establecimientos
    </h1>
  );
  if (!allowed) {
    return (
      <section
        aria-labelledby="establecimientos-titulo"
        data-panel-width="form"
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

  const create = (
    <Button onClick={() => setCreating(true)}>
      <Plus aria-hidden="true" />
      Crear establecimiento
    </Button>
  );

  let content;
  if (establishments.isPending) {
    content = (
      <div aria-busy="true" className="flex flex-col gap-2">
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
    content = (
      <EmptyState
        kind="empty"
        title="Crea tu primer establecimiento para poder emitir"
        description="Cada establecimiento necesita al menos un punto de emisión activo."
      />
    );
  } else {
    content = (
      <ul aria-label="Establecimientos" className="flex flex-col gap-3">
        {establishments.data.map((establishment) => (
          <EstablishmentItem
            key={establishment.id}
            establishment={establishment}
            onEdit={() => setEditing(establishment)}
            onAddPoint={() => setAdding(establishment)}
          />
        ))}
      </ul>
    );
  }

  return (
    <section
      aria-labelledby="establecimientos-titulo"
      data-panel-width="form"
      className="flex flex-col gap-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        {heading}
        {create}
      </div>
      {content}
      <CreateEstablishmentDialog open={creating} onOpenChange={setCreating} />
      <EditAddressDialog
        establishment={editing}
        onOpenChange={(open) => !open && setEditing(null)}
      />
      <AddPointDialog establishment={adding} onOpenChange={(open) => !open && setAdding(null)} />
    </section>
  );
}
