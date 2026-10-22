// Establecimiento y punto de emisión en dos selectores dependientes, mitad y mitad (decisiones del
// propietario, 2026-10-17 en la factura y 2026-10-22 en la nota de débito): el punto se elige entre
// los del establecimiento elegido. Solo se ofrecen los puntos disponibles, más el guardado aunque
// haya dejado de estarlo. Con un solo punto en la empresa no hay nada que decidir: se muestran como
// datos, sin selectores.
"use client";

import type { EstablishmentView } from "@facturador/contracts";
import { useState } from "react";
import { fieldAria, FormField } from "@/components/form-dialog";
import { Select } from "@/components/ui/select";
import { pointLabel } from "./establishments-api";

const establishmentText = (establishment: { code: string; address: string }) =>
  `${establishment.code} · ${establishment.address}`;

export function EstablishmentPointFields({
  establishments,
  pointId,
  onPointChange,
  problem,
}: {
  establishments: readonly EstablishmentView[];
  pointId: string;
  onPointChange: (pointId: string) => void;
  /** Un problema del servidor sobre el punto, junto a él. */
  problem?: string | undefined;
}) {
  // El establecimiento elegido mientras todavía no hay punto; con un punto, manda el suyo.
  const [choice, setChoice] = useState("");
  const choices = establishments
    .map((establishment) => ({
      establishment,
      points: establishment.emissionPoints.filter(
        (point) => point.available || point.id === pointId,
      ),
    }))
    .filter(({ points }) => points.length > 0);
  const establishmentId =
    choices.find(({ points }) => points.some((point) => point.id === pointId))?.establishment.id ??
    (choice || (choices.length === 1 ? choices[0]!.establishment.id : ""));
  const chosen = choices.find(({ establishment }) => establishment.id === establishmentId);

  const chooseEstablishment = (id: string) => {
    setChoice(id);
    const points = choices.find(({ establishment }) => establishment.id === id)?.points;
    if (points?.some((point) => point.id === pointId)) return;
    // Con un solo punto disponible no hay nada que decidir: queda elegido.
    onPointChange(points?.length === 1 ? points[0]!.id : "");
  };

  const only = choices.length === 1 && choices[0]!.points.length === 1 ? choices[0]! : null;
  if (only && only.points[0]!.id === pointId) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">Establecimiento</span>
          <p className="text-sm text-foreground-muted">{establishmentText(only.establishment)}</p>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">Punto de emisión</span>
          <p className="text-sm text-foreground-muted tabular-nums">
            {pointLabel(only.establishment, only.points[0]!)}
          </p>
          {problem && <p className="text-xs text-danger">{problem}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <FormField id="establecimiento" label="Establecimiento">
        <Select
          id="establecimiento"
          value={establishmentId}
          onChange={(event) => chooseEstablishment(event.target.value)}
        >
          <option value="">Elige un establecimiento</option>
          {choices.map(({ establishment }) => (
            <option key={establishment.id} value={establishment.id}>
              {establishmentText(establishment)}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField id="punto" label="Punto de emisión" problem={problem}>
        <Select
          {...fieldAria("punto", undefined, undefined, problem)}
          value={pointId}
          disabled={!chosen}
          onChange={(event) => onPointChange(event.target.value)}
        >
          <option value="">{chosen ? "Elige un punto" : "Elige primero el establecimiento"}</option>
          {chosen?.points.map((point) => (
            <option key={point.id} value={point.id}>
              {pointLabel(chosen.establishment, point)}
              {point.available ? "" : " (no disponible)"}
            </option>
          ))}
        </Select>
      </FormField>
    </div>
  );
}
