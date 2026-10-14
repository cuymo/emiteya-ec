// Punto de emisión predeterminado propio en Mi cuenta (add-taxpayer-setup, design D8 y D14). Cada
// usuario elige entre los puntos disponibles de su empresa; solo se preselecciona al emitir y no
// limita desde dónde emite. Un predeterminado que dejó de estar disponible se indica, sin ofrecerlo.
"use client";

import { useQuery } from "@tanstack/react-query";
import {
  defaultEmissionPointViewSchema,
  type DefaultEmissionPointView,
} from "@facturador/contracts";
import { useState } from "react";
import { AsyncButton } from "@/components/async-button";
import { errorMessage, useMutationFeedback } from "@/components/feedback";
import { ErrorState, Skeleton } from "@/components/states";
import { Select } from "@/components/ui/select";
import { apiFetch } from "@/lib/api";
import {
  DEFAULT_POINT_KEY,
  ESTABLISHMENTS_KEY,
  pointLabel,
  useEstablishments,
} from "@/features/establishments/establishments-api";

const NONE = "";

function useDefaultPoint() {
  return useQuery({
    queryKey: DEFAULT_POINT_KEY,
    queryFn: ({ signal }) =>
      apiFetch("/me/default-emission-point", { schema: defaultEmissionPointViewSchema, signal }),
  });
}

function useSetDefaultPoint() {
  return useMutationFeedback({
    mutationFn: (emissionPointId: string | null) =>
      apiFetch("/me/default-emission-point", {
        method: "PUT",
        json: { emissionPointId },
        schema: defaultEmissionPointViewSchema,
      }),
    success: (saved: DefaultEmissionPointView) =>
      saved
        ? `Guardaste tu punto predeterminado: ${pointLabel(saved.establishment, saved.emissionPoint)}.`
        : "Quitaste tu punto predeterminado.",
    invalidate: [DEFAULT_POINT_KEY, ESTABLISHMENTS_KEY],
  });
}

function DefaultPointForm({ current }: { current: DefaultEmissionPointView }) {
  const establishments = useEstablishments();
  const save = useSetDefaultPoint();
  const initial = current?.emissionPoint.id ?? NONE;
  const [value, setValue] = useState(initial);

  if (establishments.isPending) return <Skeleton className="h-10 w-full max-w-sm" />;
  if (establishments.isError) {
    return (
      <ErrorState
        message={errorMessage(establishments.error)}
        onRetry={() => void establishments.refetch()}
      />
    );
  }
  const groups = establishments.data
    .map((establishment) => ({
      establishment,
      points: establishment.emissionPoints.filter((point) => point.available),
    }))
    .filter((group) => group.points.length > 0);

  if (groups.length === 0 && !current) {
    return (
      <p className="text-sm text-foreground-muted">Aún no hay puntos de emisión disponibles.</p>
    );
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate(value === NONE ? null : value);
      }}
      className="flex flex-col gap-2"
    >
      {current && !current.available && (
        <p role="status" className="text-sm">
          Tu punto predeterminado ({pointLabel(current.establishment, current.emissionPoint)}) no
          está disponible; elige otro.
        </p>
      )}
      <div className="flex flex-col gap-1">
        <label htmlFor="default-point" className="text-sm font-medium">
          Punto de emisión
        </label>
        <Select
          id="default-point"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="max-w-sm"
        >
          <option value={NONE}>Sin predeterminado</option>
          {current && !current.available && (
            <option value={current.emissionPoint.id} disabled>
              {pointLabel(current.establishment, current.emissionPoint)} (no disponible)
            </option>
          )}
          {groups.map(({ establishment, points }) => (
            <optgroup
              key={establishment.id}
              label={`${establishment.code} · ${establishment.address}`}
            >
              {points.map((point) => (
                <option key={point.id} value={point.id}>
                  {pointLabel(establishment, point)}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      </div>
      <div>
        <AsyncButton
          type="submit"
          variant="outline"
          pending={save.isPending}
          pendingLabel="Guardando el punto predeterminado"
          disabled={value === initial}
        >
          Guardar punto predeterminado
        </AsyncButton>
      </div>
    </form>
  );
}

export function DefaultPointSection() {
  const current = useDefaultPoint();
  return (
    <section aria-labelledby="punto-titulo" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="punto-titulo" className="text-lg font-semibold">
          Punto de emisión predeterminado
        </h2>
        <p className="text-sm text-foreground-muted">
          Se preselecciona al emitir. No limita desde dónde puedes emitir.
        </p>
      </div>
      {current.isPending ? (
        <Skeleton className="h-10 w-full max-w-sm" />
      ) : current.isError ? (
        <ErrorState message={errorMessage(current.error)} onRetry={() => void current.refetch()} />
      ) : (
        <DefaultPointForm key={current.data?.emissionPoint.id ?? NONE} current={current.data} />
      )}
    </section>
  );
}
