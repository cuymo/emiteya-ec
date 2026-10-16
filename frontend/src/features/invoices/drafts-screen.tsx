// Borradores (add-invoice-emission, design D15). Usuario: administrador u operador, a diario.
// Objetivo: retomar o descartar trabajo pendiente. Decisión: qué borrador continuar. Información
// mínima: comprador, total previo, punto y última actualización. Acción principal: Nueva factura.
// P1: total previo; P2: número de líneas; P3 (autor, versión): fuera.
"use client";

import type { ColumnDef, VisibilityState } from "@tanstack/react-table";
import { PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX, type DraftSummaryView } from "@facturador/contracts";
import { Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { AppDataTable } from "@/components/data-table/app-data-table";
import { DataTableCard } from "@/components/data-table/data-table-card";
import { RowActionButton } from "@/components/data-table/table-controls";
import { useSession } from "@/components/session";
import { EmptyState, ErrorState, Skeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { formatUsd } from "@/lib/decimal";
import { canSee } from "@/lib/permissions";
import { buyerLabel, formatDateTime } from "./invoice-format";
import { useDeleteDraft, useDrafts } from "./invoices-api";

function usePaging() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const page = Math.max(1, Number.parseInt(params.get("pagina") ?? "1", 10) || 1);
  const sizeParam = Number.parseInt(params.get("filas") ?? "", 10);
  const pageSize = sizeParam >= 1 && sizeParam <= PAGE_SIZE_MAX ? sizeParam : PAGE_SIZE_DEFAULT;
  function update(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }
  return { page, pageSize, update };
}

const buyerOf = (draft: DraftSummaryView) =>
  draft.buyer ? buyerLabel(draft.buyer) : "Sin comprador";
const pointOf = (draft: DraftSummaryView) =>
  draft.emissionPoint
    ? `${draft.emissionPoint.establishmentCode}-${draft.emissionPoint.code}`
    : "—";
const totalOf = (draft: DraftSummaryView) =>
  draft.previewTotal ? formatUsd(draft.previewTotal) : "Incompleto";

const CARD = {
  title: "Borradores de facturas",
  titleId: "borradores-titulo",
  description: "Las facturas que preparaste y todavía no emitiste.",
};

export function DraftsScreen() {
  const { me } = useSession();
  const allowed = canSee(me.role, "invoices.draft");
  const router = useRouter();
  const paging = usePaging();
  const [visibility] = useState<VisibilityState>({});
  const [deleting, setDeleting] = useState<DraftSummaryView | null>(null);
  const drafts = useDrafts({ page: paging.page, pageSize: paging.pageSize }, allowed);
  const remove = useDeleteDraft({ onSuccess: () => setDeleting(null) });
  const forbidden = drafts.error instanceof ApiError && drafts.error.status === 403;

  const actions = (draft: DraftSummaryView) => (
    <div className="inline-flex items-center gap-1">
      <RowActionButton
        icon={Pencil}
        label={`Corregir el borrador de ${buyerOf(draft)}`}
        onClick={() => router.push(`/borradores/${draft.id}`)}
      />
      <RowActionButton
        icon={Trash2}
        label={`Eliminar el borrador de ${buyerOf(draft)}`}
        onClick={() => setDeleting(draft)}
      />
    </div>
  );

  const columns = useMemo<ColumnDef<DraftSummaryView, unknown>[]>(
    () => [
      {
        id: "buyer",
        header: "Comprador",
        cell: ({ row }) => (
          <Link
            href={`/borradores/${row.original.id}`}
            className="font-medium break-words underline-offset-2 hover:underline"
          >
            {buyerOf(row.original)}
          </Link>
        ),
      },
      { id: "point", header: "Punto", cell: ({ row }) => pointOf(row.original) },
      {
        id: "total",
        header: () => <span className="block text-right">Total previo</span>,
        cell: ({ row }) => (
          <span className="block text-right tabular-nums">{totalOf(row.original)}</span>
        ),
      },
      {
        id: "updatedAt",
        header: "Última actualización",
        cell: ({ row }) => formatDateTime(row.original.updatedAt),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Acciones</span>,
        cell: ({ row }) => actions(row.original),
      },
    ],
    // Las acciones solo dependen del enrutador, estable entre renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  if (!allowed || forbidden) {
    return (
      <DataTableCard {...CARD}>
        <div className="px-4 pb-4">
          <EmptyState
            kind="no-permission"
            title="No tienes acceso a Borradores de facturas"
            description="Pide a un administrador que revise tu rol."
          />
        </div>
      </DataTableCard>
    );
  }

  const tableState = drafts.isError ? (
    <ErrorState message="No pudimos cargar los borradores." onRetry={() => void drafts.refetch()} />
  ) : drafts.data && drafts.data.data.length === 0 ? (
    <EmptyState
      kind="empty"
      title="No tienes borradores pendientes"
      description="Una factura se prepara como borrador y se emite cuando está lista."
      action={
        <Button asChild variant="outline">
          <Link href="/borradores/nuevo">Nueva factura</Link>
        </Button>
      }
    />
  ) : undefined;

  return (
    <>
      <DataTableCard
        {...CARD}
        actions={
          <Button asChild size="sm">
            <Link href="/borradores/nuevo">
              <Plus aria-hidden="true" />
              Nueva factura
            </Link>
          </Button>
        }
      >
        <AppDataTable
          label="Borradores de factura pendientes"
          columns={columns}
          data={drafts.data?.data ?? []}
          getRowId={(draft) => draft.id}
          total={drafts.data?.meta.total ?? 0}
          page={paging.page}
          pageSize={paging.pageSize}
          onPageChange={(page) => paging.update({ pagina: String(page) })}
          onPageSizeChange={(size) => paging.update({ filas: String(size), pagina: null })}
          columnVisibility={visibility}
          loading={drafts.isPending}
          refreshing={drafts.isFetching}
          state={tableState}
          renderCard={(draft) => (
            <div className="flex flex-col gap-2">
              <Link
                href={`/borradores/${draft.id}`}
                className="font-medium break-words underline-offset-2 hover:underline"
              >
                {buyerOf(draft)}
              </Link>
              <span className="text-sm text-foreground-muted tabular-nums">
                {totalOf(draft)} · Punto {pointOf(draft)} · {formatDateTime(draft.updatedAt)}
              </span>
              <div className="-ml-2">{actions(draft)}</div>
            </div>
          )}
        />
      </DataTableCard>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title="Eliminar borrador"
        description={
          deleting
            ? `Eliminarás el borrador de ${buyerOf(deleting)}. No se puede recuperar; no tiene número ni datos fiscales.`
            : ""
        }
        confirmLabel="Eliminar borrador"
        tone="destructive"
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </>
  );
}

/** Geometría de la pantalla mientras se leen los parámetros de la URL. */
export function DraftsSkeleton() {
  return (
    <DataTableCard {...CARD} busy>
      <div className="px-4 pb-4">
        <Skeleton className="h-64 w-full" />
      </div>
    </DataTableCard>
  );
}
