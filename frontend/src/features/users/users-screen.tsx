// Usuarios (design D12). Usuario: administrador. Objetivo: encontrar a una persona, entender su
// acceso y ajustarlo. Información mínima: nombre, correo, rol y estado. Acción principal: Crear
// usuario. P1: búsqueda y estado; P2: fecha de alta como columna opcional; P3: fuera de la pantalla.
"use client";

import type { ColumnDef, VisibilityState } from "@tanstack/react-table";
import {
  USERS_PAGE_SIZE_DEFAULT,
  USERS_PAGE_SIZE_MAX,
  type MembershipStatus,
  type UserView,
} from "@facturador/contracts";
import { Info, KeyRound, Plus, UserCheck, UserCog, UserX } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AppDataTable } from "@/components/data-table/app-data-table";
import { DataTableCard } from "@/components/data-table/data-table-card";
import { DataTableSelectFilter } from "@/components/data-table/data-table-select-filter";
import {
  ColumnVisibilityMenu,
  RowActionButton,
  SearchInput,
} from "@/components/data-table/table-controls";
import { useSession } from "@/components/session";
import { EmptyState, ErrorState, Skeleton, StatusBadge } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/menu-and-tooltip";
import { ApiError } from "@/lib/api";
import { canSee, ROLE_LABELS } from "@/lib/permissions";
import { ChangeRoleDialog, CreateUserDialog, SetPasswordDialog } from "./user-dialogs";
import { useChangeStatus, useUsers } from "./users-api";

type StatusFilter = "todos" | "activos" | "desactivados";
const STATUS_FILTERS: readonly { value: StatusFilter; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "activos", label: "Activos" },
  { value: "desactivados", label: "Desactivados" },
];
const FILTER_TO_STATUS: Record<StatusFilter, MembershipStatus | undefined> = {
  todos: undefined,
  activos: "ACTIVE",
  desactivados: "DEACTIVATED",
};
const OPTIONAL_COLUMNS = [{ id: "createdAt", label: "Fecha de alta" }] as const;
const OWN_ACCESS = "No puedes cambiar tu propio acceso";

const dateFormat = new Intl.DateTimeFormat("es-EC", { dateStyle: "medium" });

const CARD = {
  title: "Usuarios",
  titleId: "usuarios-titulo",
  description: "Las personas con acceso a la empresa, su rol y su estado.",
};
function useUrlState() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const statusParam = params.get("estado");
  const filter: StatusFilter =
    statusParam === "activos" || statusParam === "desactivados" ? statusParam : "todos";
  const page = Math.max(1, Number.parseInt(params.get("pagina") ?? "1", 10) || 1);
  const sizeParam = Number.parseInt(params.get("filas") ?? "", 10);
  const pageSize =
    sizeParam >= 1 && sizeParam <= USERS_PAGE_SIZE_MAX ? sizeParam : USERS_PAGE_SIZE_DEFAULT;
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

  return { filter, page, pageSize, search, update };
}

function StatusCell({ user }: { user: UserView }) {
  return user.status === "ACTIVE" ? (
    <StatusBadge tone="success" label="Activo" />
  ) : (
    <StatusBadge tone="neutral" label="Desactivado" />
  );
}

function RowActions({
  user,
  isSelf,
  busy,
  onChangeRole,
  onSetPassword,
  onToggleStatus,
}: {
  user: UserView;
  isSelf: boolean;
  busy: boolean;
  onChangeRole: () => void;
  onSetPassword: () => void;
  onToggleStatus: () => void;
}) {
  if (isSelf) {
    return (
      <Tooltip label={OWN_ACCESS}>
        <button
          type="button"
          aria-label={OWN_ACCESS}
          className="inline-flex size-10 items-center justify-center rounded-md text-foreground-muted hover:bg-surface-subtle max-md:size-11"
        >
          <Info aria-hidden="true" className="size-5" />
        </button>
      </Tooltip>
    );
  }
  const active = user.status === "ACTIVE";
  return (
    <div className="inline-flex items-center gap-1">
      <RowActionButton
        icon={UserCog}
        label={`Cambiar rol de ${user.name}`}
        onClick={onChangeRole}
        disabled={busy}
      />
      <RowActionButton
        icon={KeyRound}
        label={`Establecer contraseña de ${user.name}`}
        onClick={onSetPassword}
        disabled={busy}
      />
      <RowActionButton
        icon={active ? UserX : UserCheck}
        label={active ? `Desactivar a ${user.name}` : `Reactivar a ${user.name}`}
        onClick={onToggleStatus}
        disabled={busy}
      />
    </div>
  );
}

export function UsersScreen() {
  const { me } = useSession();
  const allowed = canSee(me.role, "users.read");
  const url = useUrlState();
  const [searchDraft, setSearchDraft] = useState(url.search);
  const [visibility, setVisibility] = useState<VisibilityState>({ createdAt: false });
  const [creating, setCreating] = useState(false);
  const [roleTarget, setRoleTarget] = useState<UserView | null>(null);
  const [passwordTarget, setPasswordTarget] = useState<UserView | null>(null);
  const status = useChangeStatus();

  // La búsqueda libre consulta al servidor tras una pausa; los chips filtran al instante.
  useEffect(() => {
    if (searchDraft.trim() === url.search) return;
    const timer = setTimeout(() => url.update({ q: searchDraft.trim() }), 300);
    return () => clearTimeout(timer);
  }, [searchDraft, url]);

  const query = {
    search: url.search,
    status: FILTER_TO_STATUS[url.filter],
    page: url.page,
    pageSize: url.pageSize,
  };
  const users = useUsers(query, allowed);
  const total = users.data?.meta.total;
  const lastPage = total ? Math.ceil(total / url.pageSize) : 1;

  // Una página que ya no existe (por ejemplo, tras desactivar o filtrar) lleva a la última.
  useEffect(() => {
    if (total !== undefined && total > 0 && url.page > lastPage)
      url.update({ pagina: String(lastPage) }, false);
  }, [total, lastPage, url]);
  const forbidden = users.error instanceof ApiError && users.error.status === 403;
  const filtersActive = url.search !== "" || url.filter !== "todos";
  const isSelf = (user: UserView) => user.email === me.email;

  const columns = useMemo<ColumnDef<UserView, unknown>[]>(
    () => [
      {
        id: "name",
        header: "Nombre",
        cell: ({ row }) => <span className="font-medium break-words">{row.original.name}</span>,
      },
      {
        id: "email",
        header: "Correo",
        cell: ({ row }) => <span className="break-words">{row.original.email}</span>,
      },
      { id: "role", header: "Rol", cell: ({ row }) => ROLE_LABELS[row.original.role] },
      { id: "status", header: "Estado", cell: ({ row }) => <StatusCell user={row.original} /> },
      {
        id: "createdAt",
        header: "Fecha de alta",
        cell: ({ row }) => (
          <span className="whitespace-nowrap">
            {dateFormat.format(new Date(row.original.createdAt))}
          </span>
        ),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Acciones</span>,
        cell: ({ row }) => (
          <RowActions
            user={row.original}
            isSelf={isSelf(row.original)}
            busy={status.isPending && status.variables?.user.id === row.original.id}
            onChangeRole={() => setRoleTarget(row.original)}
            onSetPassword={() => setPasswordTarget(row.original)}
            onToggleStatus={() =>
              status.mutate({
                user: row.original,
                status: row.original.status === "ACTIVE" ? "DEACTIVATED" : "ACTIVE",
              })
            }
          />
        ),
      },
    ],
    // isSelf depende solo del correo de la sesión.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [me.email, status.isPending, status.variables],
  );

  if (!allowed || forbidden) {
    return (
      <DataTableCard {...CARD}>
        <div className="px-4 pb-4">
          <EmptyState
            kind="no-permission"
            title="No tienes acceso a Usuarios"
            description="Solo un administrador puede gestionar los usuarios de la empresa."
          />
        </div>
      </DataTableCard>
    );
  }

  const tableState = users.isError ? (
    <ErrorState message="No pudimos cargar los usuarios." onRetry={() => void users.refetch()} />
  ) : users.data && users.data.data.length === 0 ? (
    filtersActive ? (
      <EmptyState
        kind="no-matches"
        title="No hay usuarios que coincidan"
        description="Prueba con otra búsqueda o quita el filtro de estado."
        action={
          <Button
            variant="outline"
            onClick={() => {
              setSearchDraft("");
              url.update({ q: null, estado: null });
            }}
          >
            Limpiar filtros
          </Button>
        }
      />
    ) : (
      <EmptyState
        kind="empty"
        title="Todavía no hay otros usuarios"
        description="Crea el primero para darle acceso a la empresa."
      />
    )
  ) : undefined;

  return (
    <>
      <DataTableCard
        {...CARD}
        search={
          <SearchInput
            value={searchDraft}
            onChange={setSearchDraft}
            label="Buscar por nombre o correo"
            placeholder="Nombre o correo"
          />
        }
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" />
            Crear usuario
          </Button>
        }
        filters={
          <>
            <DataTableSelectFilter
              label="Estado"
              value={url.filter}
              options={STATUS_FILTERS}
              onChange={(value) => url.update({ estado: value === "todos" ? null : value })}
            />
          </>
        }
        filtersEnd={
          <div className="hidden md:block">
            <ColumnVisibilityMenu
              columns={OPTIONAL_COLUMNS}
              visibility={visibility}
              onChange={(id, visible) =>
                setVisibility((current) => ({ ...current, [id]: visible }))
              }
            />
          </div>
        }
      >
        <AppDataTable
          label="Usuarios de la empresa"
          columns={columns}
          data={users.data?.data ?? []}
          getRowId={(user) => user.id}
          total={users.data?.meta.total ?? 0}
          page={url.page}
          pageSize={url.pageSize}
          onPageChange={(page) => url.update({ pagina: String(page) }, false)}
          onPageSizeChange={(size) => url.update({ filas: String(size) })}
          columnVisibility={visibility}
          loading={users.isPending}
          refreshing={users.isFetching}
          state={tableState}
          renderCard={(user) => (
            <div className="flex flex-col gap-2">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="font-medium break-words">{user.name}</span>
                <span className="text-sm break-words text-foreground-muted">{user.email}</span>
                <span className="flex flex-wrap items-center gap-2 text-sm">
                  {ROLE_LABELS[user.role]}
                  <StatusCell user={user} />
                </span>
              </div>
              <div className="-ml-2">
                <RowActions
                  user={user}
                  isSelf={isSelf(user)}
                  busy={status.isPending && status.variables?.user.id === user.id}
                  onChangeRole={() => setRoleTarget(user)}
                  onSetPassword={() => setPasswordTarget(user)}
                  onToggleStatus={() =>
                    status.mutate({
                      user,
                      status: user.status === "ACTIVE" ? "DEACTIVATED" : "ACTIVE",
                    })
                  }
                />
              </div>
            </div>
          )}
        />
      </DataTableCard>

      <CreateUserDialog open={creating} onOpenChange={setCreating} />
      <ChangeRoleDialog user={roleTarget} onClose={() => setRoleTarget(null)} />
      <SetPasswordDialog user={passwordTarget} onClose={() => setPasswordTarget(null)} />
    </>
  );
}

/** Geometría de la pantalla mientras se leen los parámetros de la URL. */
export function UsersSkeleton() {
  return (
    <DataTableCard {...CARD} busy>
      <div className="flex flex-col gap-3 px-4 pb-4">
        <Skeleton className="h-10 w-full max-w-md" />
        <Skeleton className="h-64 w-full" />
      </div>
    </DataTableCard>
  );
}
