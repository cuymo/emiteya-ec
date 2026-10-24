// Terceros (add-parties-and-products, design D17). Usuario: administrador u operador. Objetivo:
// encontrar o registrar a quien se le vende, compra o encarga un traslado, con su identificación
// correcta. Decisión: ¿ya existe o lo registro? Información mínima: identificación con su tipo,
// razón social, roles y estado. Acción principal: Nuevo tercero. P1: filtros de estado y rol y
// corrección, en su propia página; P2: contacto, en el formulario; P3 (historial): fuera.
"use client";

import type { ColumnDef, VisibilityState } from "@tanstack/react-table";
import {
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  PARTY_ROLE_LABELS,
  PARTY_ROLES,
  type PartyRole,
  type PartyView,
  type RecordStatus,
} from "@facturador/contracts";
import { Lock, Pencil, Plus, UserCheck, UserX } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AppDataTable } from "@/components/data-table/app-data-table";
import { DataTableCard } from "@/components/data-table/data-table-card";
import { DataTableSelectFilter } from "@/components/data-table/data-table-select-filter";
import {
  RowActionButton,
  RowActionLink,
  SearchInput,
} from "@/components/data-table/table-controls";
import { useSession } from "@/components/session";
import { EmptyState, ErrorState, Skeleton, StatusBadge } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MutedCell } from "@/components/data-table/data-table-cells";
import { ApiError } from "@/lib/api";
import { canSee } from "@/lib/permissions";
import { useChangePartyStatus, useParties } from "./parties-api";

type StatusFilter = "activos" | "desactivados" | "todos";
const STATUS_FILTERS: readonly { value: StatusFilter; label: string }[] = [
  { value: "activos", label: "Activos" },
  { value: "desactivados", label: "Desactivados" },
  { value: "todos", label: "Todos" },
];
const FILTER_TO_STATUS: Record<StatusFilter, RecordStatus | "ALL"> = {
  activos: "ACTIVE",
  desactivados: "INACTIVE",
  todos: "ALL",
};
type RoleFilter = "todos" | PartyRole;
const ROLE_FILTERS: readonly { value: RoleFilter; label: string }[] = [
  { value: "todos", label: "Todos los roles" },
  ...PARTY_ROLES.map((role) => ({ value: role, label: PARTY_ROLE_LABELS[role] })),
];

const CARD = {
  title: "Clientes y proveedores",
  titleId: "terceros-titulo",
  description: "Tus clientes, proveedores y transportistas, para usarlos en los comprobantes.",
};
function useUrlState() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const statusParam = params.get("estado");
  const filter: StatusFilter =
    statusParam === "desactivados" || statusParam === "todos" ? statusParam : "activos";
  const roleParam = params.get("rol");
  const role: RoleFilter = (PARTY_ROLES as readonly string[]).includes(roleParam ?? "")
    ? (roleParam as PartyRole)
    : "todos";
  const page = Math.max(1, Number.parseInt(params.get("pagina") ?? "1", 10) || 1);
  const sizeParam = Number.parseInt(params.get("filas") ?? "", 10);
  const pageSize = sizeParam >= 1 && sizeParam <= PAGE_SIZE_MAX ? sizeParam : PAGE_SIZE_DEFAULT;
  const search = params.get("q") ?? "";

  function update(changes: Record<string, string | null>, resetPage = true) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    if (resetPage) next.delete("pagina");
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return { filter, role, page, pageSize, search, update };
}

function StatusCell({ party }: { party: PartyView }) {
  if (party.systemRecord) return <StatusBadge tone="info" label="Del sistema" icon={Lock} />;
  return party.status === "ACTIVE" ? (
    <StatusBadge tone="success" label="Activo" />
  ) : (
    <StatusBadge tone="neutral" label="Desactivado" />
  );
}

/** Los roles como insignias, para leerlos de un vistazo; sin rol, atenuado. */
const roles = (party: PartyView) =>
  party.roles.length > 0 ? (
    <span className="flex flex-wrap gap-1">
      {party.roles.map((role) => (
        <Badge key={role} variant="outline">
          {PARTY_ROLE_LABELS[role]}
        </Badge>
      ))}
    </span>
  ) : (
    <MutedCell>Sin rol</MutedCell>
  );

function RowActions({
  party,
  canChangeStatus,
  busy,
  onToggleStatus,
}: {
  party: PartyView;
  canChangeStatus: boolean;
  busy: boolean;
  onToggleStatus: () => void;
}) {
  // El consumidor final es un registro del sistema: sin acciones.
  if (party.systemRecord) return null;
  const active = party.status === "ACTIVE";
  return (
    <div className="inline-flex items-center gap-1">
      <RowActionLink
        icon={Pencil}
        label={`Corregir a ${party.legalName}`}
        href={`/terceros/${encodeURIComponent(party.id)}`}
      />
      {canChangeStatus && (
        <RowActionButton
          icon={active ? UserX : UserCheck}
          label={active ? `Desactivar a ${party.legalName}` : `Reactivar a ${party.legalName}`}
          onClick={onToggleStatus}
          disabled={busy}
        />
      )}
    </div>
  );
}

export function PartiesScreen() {
  const { me } = useSession();
  const allowed = canSee(me.role, "parties.read");
  const canManage = canSee(me.role, "parties.manage");
  const canChangeStatus = canSee(me.role, "parties.changeStatus");
  const url = useUrlState();
  const [searchDraft, setSearchDraft] = useState(url.search);
  const [visibility] = useState<VisibilityState>({});
  const status = useChangePartyStatus();

  // La búsqueda libre consulta al servidor tras una pausa; los chips filtran al instante.
  useEffect(() => {
    if (searchDraft.trim() === url.search) return;
    const timer = setTimeout(() => url.update({ q: searchDraft.trim() }), 300);
    return () => clearTimeout(timer);
  }, [searchDraft, url]);

  const parties = useParties(
    {
      search: url.search,
      status: FILTER_TO_STATUS[url.filter],
      role: url.role === "todos" ? undefined : url.role,
      page: url.page,
      pageSize: url.pageSize,
    },
    allowed,
  );
  const total = parties.data?.meta.total;
  const lastPage = total ? Math.ceil(total / url.pageSize) : 1;
  useEffect(() => {
    if (total !== undefined && total > 0 && url.page > lastPage)
      url.update({ pagina: String(lastPage) }, false);
  }, [total, lastPage, url]);
  const forbidden = parties.error instanceof ApiError && parties.error.status === 403;
  const filtersActive = url.search !== "" || url.filter !== "activos" || url.role !== "todos";

  const toggle = (party: PartyView) =>
    status.mutate({ party, status: party.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" });
  const actions = (party: PartyView) => (
    <RowActions
      party={party}
      canChangeStatus={canChangeStatus}
      busy={status.isPending && status.variables?.party.id === party.id}
      onToggleStatus={() => toggle(party)}
    />
  );

  const columns = useMemo<ColumnDef<PartyView, unknown>[]>(
    () => [
      {
        id: "identification",
        header: "Identificación",
        cell: ({ row }) => (
          <span className="flex flex-col">
            <span className="tabular-nums">{row.original.identification}</span>
            <span className="text-xs text-foreground-muted">
              {row.original.identificationTypeLabel ?? row.original.identificationType}
            </span>
          </span>
        ),
      },
      {
        id: "legalName",
        header: "Razón social",
        cell: ({ row }) => (
          <span className="font-semibold break-words">{row.original.legalName}</span>
        ),
      },
      { id: "roles", header: "Roles", cell: ({ row }) => roles(row.original) },
      { id: "status", header: "Estado", cell: ({ row }) => <StatusCell party={row.original} /> },
      {
        id: "actions",
        header: () => <span className="sr-only">Acciones</span>,
        cell: ({ row }) => (canManage ? actions(row.original) : null),
      },
    ],
    // Las acciones dependen del permiso y de la mutación en curso.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canManage, canChangeStatus, status.isPending, status.variables],
  );

  if (!allowed || forbidden) {
    return (
      <DataTableCard {...CARD}>
        <div className="px-4 pb-4">
          <EmptyState
            kind="no-permission"
            title="No tienes acceso a Clientes y proveedores"
            description="Pide a un administrador que revise tu rol."
          />
        </div>
      </DataTableCard>
    );
  }

  const tableState = parties.isError ? (
    <ErrorState message="No pudimos cargar los terceros." onRetry={() => void parties.refetch()} />
  ) : parties.data && parties.data.data.length === 0 ? (
    filtersActive ? (
      <EmptyState
        kind="no-matches"
        title="No hay terceros que coincidan"
        description="Prueba con otra búsqueda o quita los filtros."
        action={
          <Button
            variant="outline"
            onClick={() => {
              setSearchDraft("");
              url.update({ q: null, estado: null, rol: null });
            }}
          >
            Limpiar filtros
          </Button>
        }
      />
    ) : (
      <EmptyState
        kind="empty"
        title="Todavía no hay terceros"
        description="Registra a tus clientes, proveedores y transportistas para usarlos en los comprobantes."
      />
    )
  ) : undefined;

  return (
    <DataTableCard
      {...CARD}
      search={
        <SearchInput
          value={searchDraft}
          onChange={setSearchDraft}
          label="Buscar por identificación o razón social"
          placeholder="Identificación o nombre"
        />
      }
      actions={
        canManage && (
          <Button size="sm" asChild>
            <Link href="/terceros/nuevo">
              <Plus aria-hidden="true" />
              Nuevo tercero
            </Link>
          </Button>
        )
      }
      filters={
        <>
          <DataTableSelectFilter
            label="Estado"
            value={url.filter}
            options={STATUS_FILTERS}
            onChange={(value) => url.update({ estado: value === "activos" ? null : value })}
          />
          <DataTableSelectFilter
            label="Rol"
            value={url.role}
            options={ROLE_FILTERS}
            onChange={(value) => url.update({ rol: value === "todos" ? null : value })}
          />
        </>
      }
    >
      <AppDataTable
        label="Clientes y proveedores de la empresa"
        columns={columns}
        data={parties.data?.data ?? []}
        getRowId={(party) => party.id}
        total={parties.data?.meta.total ?? 0}
        page={url.page}
        pageSize={url.pageSize}
        onPageChange={(page) => url.update({ pagina: String(page) }, false)}
        onPageSizeChange={(size) => url.update({ filas: String(size) })}
        columnVisibility={visibility}
        loading={parties.isPending}
        refreshing={parties.isFetching}
        state={tableState}
        renderCard={(party) => (
          <div className="flex flex-col gap-2">
            <div className="flex min-w-0 flex-col gap-1">
              <span className="font-semibold break-words">{party.legalName}</span>
              <span className="text-sm text-foreground-muted tabular-nums">
                {party.identificationTypeLabel ?? party.identificationType} · {party.identification}
              </span>
              <span className="flex flex-wrap items-center gap-2 text-sm">
                {roles(party)}
                <StatusCell party={party} />
              </span>
            </div>
            {canManage && <div className="-ml-2">{actions(party)}</div>}
          </div>
        )}
      />
    </DataTableCard>
  );
}

/** Geometría de la pantalla mientras se leen los parámetros de la URL. */
export function PartiesSkeleton() {
  return (
    <DataTableCard {...CARD} busy>
      <div className="flex flex-col gap-3 px-4 pb-4">
        <Skeleton className="h-10 w-full max-w-md" />
        <Skeleton className="h-64 w-full" />
      </div>
    </DataTableCard>
  );
}
