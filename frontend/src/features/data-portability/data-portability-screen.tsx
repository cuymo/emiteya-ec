// Portabilidad de datos (add-data-portability, design D23). Usuario: administrador. Objetivo:
// llevarse los datos de su empresa fuera del sistema. Decisión: generar un paquete y descargarlo
// antes de que caduque. Acción principal: Generar exportación o Descargar paquete, según el estado.
// P0: el estado de la exportación vigente con su acción. P1: el momento de los datos, la caducidad,
// el tamaño y el SHA-256. P2: lo incluido y lo excluido, y la historia. P3: los identificadores
// internos, que no se muestran.
"use client";

import { useQueryClient } from "@tanstack/react-query";
import type { ColumnDef, VisibilityState } from "@tanstack/react-table";
import {
  DATA_EXPORT_PHASE_LABELS,
  DATA_EXPORT_STATUS_LABELS,
  PAGE_SIZE_DEFAULT,
  type DataExportFailureCode,
  type DataExportStatus,
  type DataExportView,
} from "@facturador/contracts";
import { Check, Copy, Download } from "lucide-react";
import { useMemo, useState } from "react";
import { AsyncButton } from "@/components/async-button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { AppDataTable } from "@/components/data-table/app-data-table";
import { errorMessage, toast } from "@/components/feedback";
import { useSession } from "@/components/session";
import {
  EmptyState,
  ErrorState,
  Skeleton,
  StatusBadge,
  type StatusTone,
} from "@/components/states";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/features/invoices/invoice-format";
import { ApiError } from "@/lib/api";
import { canSee } from "@/lib/permissions";
import {
  DATA_EXPORTS_KEY,
  downloadHref,
  useCurrentExports,
  useExportHistory,
  useRequestExport,
} from "./data-portability-api";

const TONES: Record<DataExportStatus, StatusTone> = {
  QUEUED: "info",
  GENERATING: "info",
  READY: "success",
  FAILED: "danger",
  EXPIRED: "neutral",
};

/** La falla explicada sin detalles internos, con lo que la persona puede hacer. */
export const FAILURE_MESSAGES: Record<DataExportFailureCode, string> = {
  DATA_EXPORT_ARTIFACT_INTEGRITY:
    "Un archivo guardado de un comprobante no pasó la verificación de integridad, así que el paquete no se generó. Genera la exportación de nuevo; si se repite, avisa al responsable de la instalación.",
  DATA_EXPORT_ARTIFACT_MISSING:
    "Falta un archivo que un comprobante debería tener, así que el paquete no se generó. Genera la exportación de nuevo; si se repite, avisa al responsable de la instalación.",
  DATA_EXPORT_INSUFFICIENT_SPACE:
    "El servidor no tiene espacio suficiente para el paquete. Pide al responsable de la instalación que libere espacio y genera la exportación de nuevo.",
  DATA_EXPORT_SNAPSHOT_TIMEOUT:
    "La lectura de los datos tardó más de lo permitido. Genera la exportación de nuevo en un momento de menos uso.",
  DATA_EXPORT_LIMIT:
    "Los datos superan un límite del formato del paquete. Avisa al responsable de la instalación.",
  DATA_EXPORT_FAILED:
    "La exportación no pudo completarse después de varios intentos. Genera la exportación de nuevo.",
  DATA_EXPORT_PACKAGE_MISSING:
    "El paquete ya no está disponible en el servidor. Genera una exportación nueva.",
  DATA_EXPORT_PACKAGE_INTEGRITY:
    "El paquete guardado no pasó la verificación de integridad y no se entregó. Genera una exportación nueva.",
};

const SHORT_FAILURES: Record<DataExportFailureCode, string> = {
  DATA_EXPORT_ARTIFACT_INTEGRITY: "Un archivo no pasó la verificación",
  DATA_EXPORT_ARTIFACT_MISSING: "Faltó un archivo de un comprobante",
  DATA_EXPORT_INSUFFICIENT_SPACE: "Sin espacio en el servidor",
  DATA_EXPORT_SNAPSHOT_TIMEOUT: "La lectura tardó demasiado",
  DATA_EXPORT_LIMIT: "Superó un límite del formato",
  DATA_EXPORT_FAILED: "No se completó tras varios intentos",
  DATA_EXPORT_PACKAGE_MISSING: "El paquete ya no estaba disponible",
  DATA_EXPORT_PACKAGE_INTEGRITY: "El paquete no pasó la verificación",
};

const IN_PROGRESS =
  "Ya hay una exportación en cola o generándose. Espera a que termine para generar otra.";

const number = new Intl.NumberFormat("es-EC");
const decimal = new Intl.NumberFormat("es-EC", { maximumFractionDigits: 1 });

/** Tamaño legible, en unidades de 1024 bytes. */
export function formatSize(sizeBytes: string): string {
  const bytes = Number(sizeBytes);
  const units = ["bytes", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${number.format(bytes)} bytes` : `${decimal.format(value)} ${units[unit]}`;
}

/** Una exportación lista cuya caducidad ya pasó se muestra caducada aunque el barrido no pasó. */
function displayStatus(row: DataExportView, now: number): DataExportStatus {
  return row.status === "READY" && row.expiresAt && Date.parse(row.expiresAt) <= now
    ? "EXPIRED"
    : row.status;
}

function ExportStatus({ row, now }: { row: DataExportView; now: number }) {
  const status = displayStatus(row, now);
  return <StatusBadge tone={TONES[status]} label={DATA_EXPORT_STATUS_LABELS[status]} />;
}

/** La fase y, solo cuando se conoce el total, los comprobantes agregados: nunca un porcentaje. */
function progressText(row: DataExportView): string {
  if (row.status === "QUEUED") return "Esperando su turno para generarse.";
  const phase = row.phase ? DATA_EXPORT_PHASE_LABELS[row.phase] : "Generando";
  return row.progress
    ? `${phase}: ${number.format(row.progress.done)} de ${number.format(row.progress.total)} comprobantes.`
    : `${phase}.`;
}

function expiredText(row: DataExportView): string {
  return row.expiredReason === "REPLACED"
    ? "Se reemplazó por un paquete más reciente."
    : "El paquete caducó 24 horas después de quedar listo. Genera una exportación nueva.";
}

function Sha256({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const groups = value.match(/.{1,16}/g) ?? [value];
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success("Copiaste el SHA-256.", { id: "sha256" });
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      toast.error("No pudimos copiarlo. Selecciona el texto y cópialo.", { id: "sha256" });
    }
  }
  return (
    <div className="flex items-start gap-1">
      <code
        aria-label={`SHA-256 ${value}`}
        className="font-mono text-sm leading-relaxed break-all tabular-nums"
      >
        {groups.map((group, index) => (
          <span key={index} className="inline-block pr-1">
            {group}
          </span>
        ))}
      </code>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Copiar SHA-256"
        onClick={() => void copy()}
        className="shrink-0"
      >
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      </Button>
    </div>
  );
}

function ReadyPackage({
  row,
  primary,
  onDownload,
}: {
  row: DataExportView;
  primary: boolean;
  onDownload: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <dl className="grid grid-cols-1 gap-x-3 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-foreground-muted">Datos al</dt>
        <dd className="tabular-nums">{formatDateTime(row.snapshotAt!)}</dd>
        <dt className="text-foreground-muted">Disponible hasta</dt>
        <dd className="tabular-nums">{formatDateTime(row.expiresAt!)}</dd>
        <dt className="text-foreground-muted">Tamaño</dt>
        <dd className="tabular-nums">
          {formatSize(row.sizeBytes!)}
          <span className="text-foreground-muted">
            {" "}
            · {number.format(Number(row.sizeBytes))} bytes
          </span>
        </dd>
        <dt className="text-foreground-muted">SHA-256</dt>
        <dd>
          <Sha256 value={row.sha256!} />
        </dd>
      </dl>
      <div className="flex flex-wrap items-center gap-1">
        <Button asChild variant={primary ? "primary" : "outline"}>
          {/* Navegación del navegador al mismo origen: el paquete nunca pasa por la página. */}
          <a href={downloadHref(row.id)} download onClick={onDownload}>
            <Download aria-hidden="true" />
            Descargar paquete
          </a>
        </Button>
        <p className="text-xs text-foreground-muted">
          Al terminar, compara el SHA-256 del archivo con este.
        </p>
      </div>
    </div>
  );
}

function Explanation() {
  return (
    <section aria-labelledby="portabilidad-contenido" className="flex flex-col gap-1.5">
      <h2 id="portabilidad-contenido" className="text-lg font-semibold">
        Qué contiene el paquete
      </h2>
      <div className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
        <div className="flex flex-col gap-0.5">
          <h3 className="font-medium">Incluye</h3>
          <ul className="list-disc pl-2.5 marker:text-foreground-muted">
            <li>
              Los datos de la empresa, sus establecimientos y puntos de emisión, con su historia.
            </li>
            <li>
              Los comprobantes de Pruebas y de Producción en todos sus estados, con su XML, su RIDE
              y las respuestas del SRI guardadas.
            </li>
            <li>Terceros, productos e inventario, también los inactivos.</li>
            <li>Los usuarios con su nombre, correo y rol, y el historial de auditoría.</li>
            <li>
              Los datos en libros de Excel, un manifiesto y la lista SHA256SUMS para verificar cada
              archivo.
            </li>
          </ul>
        </div>
        <div className="flex flex-col gap-0.5">
          <h3 className="font-medium">No incluye</h3>
          <ul className="list-disc pl-2.5 marker:text-foreground-muted">
            <li>La firma electrónica, su contraseña ni ningún otro secreto.</li>
            <li>Las contraseñas, las sesiones ni los datos de inicio de sesión de los usuarios.</li>
            <li>Los borradores sin emitir, que siguen en el sistema.</li>
          </ul>
        </div>
      </div>
      <p className="max-w-prose text-sm text-foreground-muted">
        No es un respaldo: no se puede importar ni restaurar en esta aplicación. Cada paquete caduca
        24 horas después de quedar listo; después puedes generar uno nuevo.
      </p>
    </section>
  );
}

/** Lo que resultó de una exportación, en una línea de la historia. */
function resultText(row: DataExportView, now: number): string {
  const status = displayStatus(row, now);
  if (status === "QUEUED" || status === "GENERATING") return progressText(row);
  if (status === "READY") return `Disponible hasta ${formatDateTime(row.expiresAt!)}`;
  if (status === "FAILED") return row.errorCode ? SHORT_FAILURES[row.errorCode] : "Falló";
  return row.expiredReason === "REPLACED" ? "Reemplazada por una más reciente" : "Caducó";
}

function History({ polling, now, current }: { polling: boolean; now: number; current: string }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE_DEFAULT);
  const [visibility] = useState<VisibilityState>({});
  const history = useExportHistory({ page, pageSize }, { enabled: true, polling, current });

  const columns = useMemo<ColumnDef<DataExportView, unknown>[]>(
    () => [
      {
        id: "requestedAt",
        header: "Solicitada",
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums">
            {formatDateTime(row.original.requestedAt)}
          </span>
        ),
      },
      {
        id: "requestedBy",
        header: "Por",
        cell: ({ row }) => <span className="break-words">{row.original.requestedBy.name}</span>,
      },
      {
        id: "status",
        header: "Estado",
        cell: ({ row }) => <ExportStatus row={row.original} now={now} />,
      },
      { id: "result", header: "Resultado", cell: ({ row }) => resultText(row.original, now) },
      {
        id: "size",
        header: "Tamaño",
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums">
            {row.original.sizeBytes ? formatSize(row.original.sizeBytes) : "—"}
          </span>
        ),
      },
    ],
    [now],
  );

  const state = history.isError ? (
    <ErrorState message={errorMessage(history.error)} onRetry={() => void history.refetch()} />
  ) : undefined;

  return (
    <section aria-labelledby="portabilidad-historial" className="flex flex-col gap-1">
      <h2 id="portabilidad-historial" className="text-lg font-semibold">
        Historial
      </h2>
      <AppDataTable
        label="Historial de exportaciones"
        columns={columns}
        data={history.data?.data ?? []}
        getRowId={(row) => row.id}
        total={history.data?.meta.total ?? 0}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        columnVisibility={visibility}
        loading={history.isPending}
        refreshing={history.isFetching}
        state={state}
        renderCard={(row) => (
          <div className="flex flex-col gap-1">
            <div className="flex items-start justify-between gap-1">
              <span className="tabular-nums">{formatDateTime(row.requestedAt)}</span>
              <ExportStatus row={row} now={now} />
            </div>
            <span className="text-sm">{resultText(row, now)}</span>
            <span className="flex flex-wrap justify-between gap-1 text-sm text-foreground-muted">
              <span className="break-words">{row.requestedBy.name}</span>
              {row.sizeBytes && <span className="tabular-nums">{formatSize(row.sizeBytes)}</span>}
            </span>
          </div>
        )}
      />
    </section>
  );
}

export function DataPortabilityScreen() {
  const { me } = useSession();
  const allowed = canSee(me.role, "dataPortability.export");
  const queryClient = useQueryClient();
  const current = useCurrentExports(allowed);
  const [confirming, setConfirming] = useState(false);
  const request = useRequestExport({
    onError: (error) => {
      // Otra persona pudo solicitarla al mismo tiempo: se muestra la que está en curso.
      if (error instanceof ApiError && error.code === "DATA_EXPORT_IN_PROGRESS") {
        toast.error(IN_PROGRESS, { id: IN_PROGRESS });
        void queryClient.invalidateQueries({ queryKey: DATA_EXPORTS_KEY });
        return true;
      }
      return false;
    },
  });
  const heading = (
    <h1 id="portabilidad-titulo" className="text-3xl font-bold">
      Portabilidad de datos
    </h1>
  );
  const forbidden = current.error instanceof ApiError && current.error.status === 403;

  if (!allowed || forbidden) {
    return (
      <section aria-labelledby="portabilidad-titulo" className="flex flex-col gap-3">
        {heading}
        <EmptyState
          kind="no-permission"
          title="No tienes permiso para ver esta sección"
          description="Solo un administrador exporta los datos de la empresa."
        />
      </section>
    );
  }
  if (current.isPending) {
    return (
      <section
        aria-labelledby="portabilidad-titulo"
        aria-busy="true"
        className="flex max-w-5xl flex-col gap-3"
      >
        {heading}
        <Skeleton className="h-32 w-full" />
      </section>
    );
  }
  if (current.isError) {
    return (
      <section aria-labelledby="portabilidad-titulo" className="flex max-w-5xl flex-col gap-3">
        {heading}
        <ErrorState message={errorMessage(current.error)} onRetry={() => void current.refetch()} />
      </section>
    );
  }

  const now = current.dataUpdatedAt;
  const { latest, active } = current.data;
  const ready =
    current.data.ready && displayStatus(current.data.ready, now) === "READY"
      ? current.data.ready
      : null;
  const generate = () => {
    if (ready) setConfirming(true);
    else request.mutate();
  };
  // Tras pedir la descarga se vuelve a consultar: un paquete que no pasó la verificación aparece
  // como fallido con su explicación.
  const afterDownload = () => {
    setTimeout(() => void queryClient.invalidateQueries({ queryKey: DATA_EXPORTS_KEY }), 2_000);
  };
  const generateButton = !active && (
    <AsyncButton
      pending={request.isPending}
      pendingLabel="Solicitando la exportación"
      variant={ready ? "outline" : "primary"}
      onClick={generate}
    >
      Generar exportación
    </AsyncButton>
  );
  // La última exportación terminada sin un paquete vigente propio: su falla o su caducidad. Una
  // falla más reciente que el paquete vigente se explica junto a él.
  const outcome = !active && latest && latest.id !== ready?.id ? latest : null;

  return (
    <section aria-labelledby="portabilidad-titulo" className="flex max-w-5xl flex-col gap-3">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {heading}
          {latest && generateButton}
        </div>
        <p className="max-w-prose text-sm text-foreground-muted">
          Descarga en un solo archivo los datos y los comprobantes de tu empresa para llevarlos a
          otro sistema.
        </p>
      </div>

      {!latest ? (
        <EmptyState
          kind="empty"
          title="Todavía no generaste una exportación"
          description="El paquete se genera en segundo plano; puedes salir de esta pantalla mientras tanto."
          action={generateButton}
        />
      ) : (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-2">
          {active && (
            <div className="flex flex-col gap-0.5" aria-live="polite">
              <div className="flex flex-wrap items-center gap-1">
                <ExportStatus row={active} now={now} />
                <p className="text-sm">{progressText(active)}</p>
              </div>
              <p className="text-xs text-foreground-muted">
                {ready
                  ? "El paquete actual sigue disponible hasta que el nuevo quede listo."
                  : "Puedes salir de esta pantalla: la exportación sigue generándose."}
              </p>
            </div>
          )}
          {ready && (
            <div className="flex flex-col gap-1">
              <div>
                <ExportStatus row={ready} now={now} />
              </div>
              <ReadyPackage row={ready} primary onDownload={afterDownload} />
            </div>
          )}
          {outcome && (
            <div role="status" className="flex flex-col gap-0.5">
              <div>
                <ExportStatus row={outcome} now={now} />
              </div>
              <p className="text-sm">
                {outcome.status === "FAILED" && outcome.errorCode
                  ? FAILURE_MESSAGES[outcome.errorCode]
                  : expiredText(outcome)}
              </p>
            </div>
          )}
        </div>
      )}

      <Explanation />
      {latest && (
        <History
          polling={Boolean(active)}
          now={now}
          current={`${latest.id}:${displayStatus(latest, now)}:${ready?.id ?? ""}`}
        />
      )}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="¿Generar una exportación nueva?"
        description="El paquete actual sigue disponible mientras se genera el nuevo. Cuando el nuevo quede listo, el actual caduca y ya no se podrá descargar."
        confirmLabel="Generar exportación"
        pending={request.isPending}
        onConfirm={() => request.mutate(undefined, { onSettled: () => setConfirming(false) })}
      />
    </section>
  );
}
