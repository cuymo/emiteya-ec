// Detalle de un producto en el inventario (add-minimal-inventory, design D13). Usuario: administrador
// u operador, de forma ocasional y con riesgo medio. Objetivo: ver el saldo y su historia, y
// registrar lo que pasó físicamente. Decisión: registrar una entrada, ajustar, inicializar o
// desactivar el control. Información mínima: estado, saldo y últimos movimientos. Acción principal,
// según el estado y el rol: "Inicializar inventario" (administrador, sin inicializar), "Registrar
// entrada" (activo) o "Activar control" (administrador, desactivado). P0: estado, saldo y acción
// principal; P1: kárdex; P2: ajustar y desactivar; P3 (identificadores): no se muestra. Un ajuste
// equivocado se corrige con otro ajuste, nunca editando.
"use client";

import type { ColumnDef, VisibilityState } from "@tanstack/react-table";
import {
  PAGE_SIZE_DEFAULT,
  compareDecimalStrings,
  type StockItemDetailView,
  type StockMovementType,
  type StockMovementView,
} from "@facturador/contracts";
import { PackagePlus, Power, PowerOff, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import { AsyncButton } from "@/components/async-button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { AppDataTable } from "@/components/data-table/app-data-table";
import { DatePickerField } from "@/components/date-picker-field";
import { useSession } from "@/components/session";
import { EmptyState, ErrorState, Skeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { formatDecimal } from "@/lib/decimal";
import { canSee } from "@/lib/permissions";
import { formatDateTime } from "@/features/invoices/invoice-format";
import { useSetStockTracking, useStockItem, useStockMovements } from "./inventory-api";
import { MOVEMENT_TYPE_LABELS, ORIGIN_LABELS, formatDelta } from "./inventory-format";
import { BalanceCell, StockStateBadge } from "./inventory-screen";
import {
  InitializeStockDialog,
  StockAdjustmentDialog,
  StockEntryDialog,
  type MovementTarget,
} from "./movement-dialogs";
import { useBreadcrumbLabel } from "@/components/shell/breadcrumb-label";

type OpenDialog =
  | { kind: "initialize" }
  | { kind: "entry"; idempotencyKey: string }
  | { kind: "adjust"; idempotencyKey: string }
  | { kind: "disable" };

function Note({ children }: { children: ReactNode }) {
  return (
    <p
      role="note"
      className="rounded-md border border-border bg-surface-subtle px-3 py-2 text-sm text-foreground-muted"
    >
      {children}
    </p>
  );
}

/**
 * El comprobante que originó un movimiento, según su tipo: la factura de una salida y la nota de
 * crédito de una devolución. Los demás tipos no tienen comprobante.
 */
const SOURCE_DOCUMENTS: Partial<Record<StockMovementType, { label: string; path: string }>> = {
  SALIDA_FACTURA: { label: "Factura", path: "/facturas" },
  DEVOLUCION_NC: { label: "Nota de crédito", path: "/notas-credito" },
};

/** Detalle del movimiento: el comprobante con su enlace, el motivo o la nota y quién lo registró. */
function MovementDetail({ movement }: { movement: StockMovementView }) {
  const source = SOURCE_DOCUMENTS[movement.type];
  return (
    <span className="flex flex-col">
      {source && movement.documentNumber && movement.documentId ? (
        <Link
          href={`${source.path}/${encodeURIComponent(movement.documentId)}`}
          className="tabular-nums underline-offset-2 hover:underline"
        >
          {source.label} {movement.documentNumber}
        </Link>
      ) : null}
      {movement.reason && <span className="break-words">{movement.reason}</span>}
      <span className="text-xs text-foreground-muted">
        {ORIGIN_LABELS[movement.origin]}
        {movement.actorName ? ` · ${movement.actorName}` : ""}
      </span>
    </span>
  );
}

function Kardex({ productId }: { productId: string }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE_DEFAULT);
  const [visibility] = useState<VisibilityState>({});
  const headingId = useId();
  // Un rango invertido se explica en el campo y no se consulta.
  const rangeError =
    from && to && from > to ? "La fecha final no puede ser anterior a la inicial." : null;
  const movements = useStockMovements(productId, { from, to, page, pageSize }, rangeError === null);

  const columns = useMemo<ColumnDef<StockMovementView, unknown>[]>(
    () => [
      {
        id: "date",
        header: "Fecha",
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums">
            {formatDateTime(row.original.occurredAt)}
          </span>
        ),
      },
      {
        id: "type",
        header: "Movimiento",
        cell: ({ row }) => (
          <span className="whitespace-nowrap">{MOVEMENT_TYPE_LABELS[row.original.type]}</span>
        ),
      },
      // El detalle va antes de las cifras: la última columna de la tabla es estrecha y alineada a la
      // derecha, para las cifras o las acciones.
      {
        id: "detail",
        header: "Detalle",
        cell: ({ row }) => (
          <span className="block min-w-48">
            <MovementDetail movement={row.original} />
          </span>
        ),
      },
      {
        id: "delta",
        header: () => <span className="block text-right">Variación</span>,
        cell: ({ row }) => (
          <span className="block text-right tabular-nums">{formatDelta(row.original.delta)}</span>
        ),
      },
      {
        id: "balance",
        header: () => <span className="block text-right">Saldo</span>,
        cell: ({ row }) => (
          <span className="block text-right tabular-nums">
            {formatDecimal(row.original.balanceAfter)}
          </span>
        ),
      },
    ],
    [],
  );

  const filtered = from !== "" || to !== "";
  const state = rangeError ? (
    <EmptyState
      kind="no-matches"
      title="Revisa el rango de fechas"
      description="La fecha final no puede ser anterior a la inicial."
    />
  ) : movements.isError ? (
    <ErrorState message="No pudimos cargar el kárdex." onRetry={() => void movements.refetch()} />
  ) : movements.data && movements.data.data.length === 0 ? (
    <EmptyState
      kind={filtered ? "no-matches" : "empty"}
      title={filtered ? "No hay movimientos en esas fechas" : "Todavía no hay movimientos"}
      {...(filtered ? { description: "Prueba con otro rango de fechas." } : {})}
    />
  ) : undefined;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h2 id={headingId} className="text-lg font-semibold">
        Kárdex
      </h2>
      <AppDataTable
        label="Movimientos del producto"
        columns={columns}
        data={rangeError ? [] : (movements.data?.data ?? [])}
        getRowId={(movement) => movement.id}
        total={rangeError ? 0 : (movements.data?.meta.total ?? 0)}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        columnVisibility={visibility}
        loading={!rangeError && movements.isPending}
        refreshing={movements.isFetching}
        state={state}
        toolbar={
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:max-w-xl">
            <DatePickerField
              label="Desde"
              value={from}
              max={to || undefined}
              onChange={(value) => {
                setFrom(value);
                setPage(1);
              }}
            />
            <DatePickerField
              label="Hasta"
              value={to}
              min={from || undefined}
              error={rangeError}
              onChange={(value) => {
                setTo(value);
                setPage(1);
              }}
            />
          </div>
        }
        renderCard={(movement) => (
          <div className="flex flex-col gap-2">
            <div className="flex items-start justify-between gap-2">
              <span className="font-medium">{MOVEMENT_TYPE_LABELS[movement.type]}</span>
              <span className="tabular-nums">{formatDelta(movement.delta)}</span>
            </div>
            <span className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="tabular-nums text-foreground-muted">
                {formatDateTime(movement.occurredAt)}
              </span>
              <span className="tabular-nums">Saldo {formatDecimal(movement.balanceAfter)}</span>
            </span>
            <MovementDetail movement={movement} />
          </div>
        )}
      />
    </section>
  );
}

export function StockItemDetailScreen({ productId }: { productId: string }) {
  const { me } = useSession();
  const allowed = canSee(me.role, "inventory.read");
  const canEntry = canSee(me.role, "inventory.entry");
  const canAdjust = canSee(me.role, "inventory.adjust");
  const canInitialize = canSee(me.role, "inventory.initialize");
  const canConfigure = canSee(me.role, "inventory.configure");
  const item = useStockItem(productId, allowed);
  // Miga final del shell: el número o el nombre del registro (adopt-premium-design-foundation-and-shell).
  useBreadcrumbLabel(item.data?.name);
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const summaryRef = useRef<HTMLHeadingElement>(null);
  const disableNoteId = useId();
  // Tras cada acción el foco va al saldo, que anuncia el resultado, aunque quien abrió el diálogo
  // haya cambiado o desaparecido. Al cancelar, vuelve a quien abrió el diálogo.
  const focusAfterClose = useRef(false);
  const focusSummary = () => {
    focusAfterClose.current = true;
  };
  const onDialogCloseFocus = (event: Event) => {
    if (!focusAfterClose.current) return;
    focusAfterClose.current = false;
    event.preventDefault();
    summaryRef.current?.focus();
  };
  const tracking = useSetStockTracking({
    onSuccess: () => {
      if (dialog?.kind === "disable") {
        focusSummary();
        setDialog(null);
      } else {
        // Activar no abre diálogo: su botón desaparece al cambiar el estado.
        setTimeout(() => summaryRef.current?.focus(), 0);
      }
    },
  });

  if (!allowed) {
    return (
      <section aria-labelledby="inventario-detalle-titulo" className="flex flex-col gap-6">
        <h1 id="inventario-detalle-titulo" className="text-3xl font-bold">
          Inventario
        </h1>
        <EmptyState
          kind="no-permission"
          title="No tienes acceso a Inventario"
          description="Pide a un administrador que revise tu rol."
        />
      </section>
    );
  }
  if (item.isPending) return <StockItemDetailSkeleton />;
  if (item.isError) {
    const missing = item.error instanceof ApiError && item.error.status === 404;
    return (
      <section aria-labelledby="inventario-detalle-titulo" className="flex flex-col gap-6">
        <h1 id="inventario-detalle-titulo" className="text-3xl font-bold">
          Inventario
        </h1>
        {missing ? (
          <EmptyState
            kind="empty"
            title="El producto no existe"
            description="Búscalo en la lista de inventario."
          />
        ) : (
          <ErrorState
            message="No pudimos cargar el inventario del producto."
            onRetry={() => void item.refetch()}
          />
        )}
      </section>
    );
  }

  const data: StockItemDetailView = item.data;
  const target: MovementTarget = {
    productId: data.productId,
    name: data.name,
    balance: data.balance,
  };
  const zeroBalance = data.balance !== null && compareDecimalStrings(data.balance, "0") === 0;
  const initialized = data.state === "TRACKED_INITIALIZED" || data.state === "DISABLED_INITIALIZED";

  const open = (kind: OpenDialog["kind"]) =>
    setDialog(
      kind === "entry" || kind === "adjust"
        ? { kind, idempotencyKey: crypto.randomUUID() }
        : ({ kind } as OpenDialog),
    );

  let primary: ReactNode = null;
  let note: ReactNode = null;
  if (data.state === "NOT_TRACKED") {
    note = (
      <>
        Este producto no tiene control de stock. Márcalo como controlado en{" "}
        <Link href="/productos" className="text-primary underline">
          Productos
        </Link>{" "}
        para llevar su inventario.
      </>
    );
  } else if (data.state === "TRACKED_NOT_INITIALIZED") {
    if (canInitialize) {
      primary = (
        <Button onClick={() => open("initialize")}>
          <PackagePlus aria-hidden="true" />
          Inicializar inventario
        </Button>
      );
    }
    note = canInitialize
      ? "Cuenta las existencias y registra el saldo inicial: hasta entonces las facturas no descuentan este producto."
      : "Un administrador debe inicializar el inventario de este producto: hasta entonces las facturas no lo descuentan.";
  } else if (data.state === "TRACKED_INITIALIZED") {
    if (canEntry) {
      primary = (
        <Button onClick={() => open("entry")}>
          <PackagePlus aria-hidden="true" />
          Registrar entrada
        </Button>
      );
    }
  } else if (canConfigure) {
    primary = (
      <AsyncButton
        pending={tracking.isPending}
        onClick={() => tracking.mutate({ productId: data.productId, tracked: true })}
      >
        <Power aria-hidden="true" />
        Activar control
      </AsyncButton>
    );
    note = "El control está desactivado: las facturas nuevas no descuentan este producto.";
  } else {
    note =
      "El control está desactivado: las facturas nuevas no descuentan este producto. Un administrador puede reactivarlo.";
  }

  const secondary = data.state === "TRACKED_INITIALIZED" && (canAdjust || canConfigure) && (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {canAdjust && (
          <Button variant="outline" onClick={() => open("adjust")}>
            <SlidersHorizontal aria-hidden="true" />
            Ajustar
          </Button>
        )}
        {canConfigure && (
          <Button
            variant="outline"
            disabled={!zeroBalance}
            {...(zeroBalance ? {} : { "aria-describedby": disableNoteId })}
            onClick={() => open("disable")}
          >
            <PowerOff aria-hidden="true" />
            Desactivar control
          </Button>
        )}
      </div>
      {canConfigure && !zeroBalance && (
        <p id={disableNoteId} className="text-xs text-foreground-muted">
          Para desactivar el control, el saldo debe ser cero. Registra primero un ajuste que lo deje
          en cero.
        </p>
      )}
    </div>
  );

  return (
    <section aria-labelledby="inventario-detalle-titulo" className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 id="inventario-detalle-titulo" className="text-3xl font-bold break-words">
            {data.name}
          </h1>
          <span className="flex flex-wrap items-center gap-2 text-sm text-foreground-muted">
            <StockStateBadge state={data.state} />
            {data.mainCode && <span className="tabular-nums">{data.mainCode}</span>}
            {data.productStatus === "INACTIVE" && <span>Producto inactivo</span>}
          </span>
        </div>
        {primary}
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
        <h2
          ref={summaryRef}
          tabIndex={-1}
          className="text-sm font-medium text-foreground-muted outline-none"
        >
          Saldo
        </h2>
        <p className="text-2xl font-semibold">
          {data.balance === null ? (
            <span className="text-base font-normal text-foreground-muted">
              Sin inicializar: todavía no hay saldo.
            </span>
          ) : (
            <BalanceCell item={data} />
          )}
        </p>
        {initialized && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {data.initializedAt && (
              <>
                <dt className="text-foreground-muted">Inicializado</dt>
                <dd>
                  {formatDateTime(data.initializedAt)}
                  {data.initializedByName ? ` · ${data.initializedByName}` : ""}
                </dd>
              </>
            )}
            {data.lastMovementAt && (
              <>
                <dt className="text-foreground-muted">Último movimiento</dt>
                <dd>{formatDateTime(data.lastMovementAt)}</dd>
              </>
            )}
          </dl>
        )}
        <p className="text-xs text-foreground-muted">
          Stock contabilizado: las facturas descuentan al autorizarse. No reserva existencias.
        </p>
      </div>

      {note && <Note>{note}</Note>}
      {secondary}

      {initialized && <Kardex productId={data.productId} />}

      <InitializeStockDialog
        target={dialog?.kind === "initialize" ? target : null}
        onClose={() => setDialog(null)}
        onDone={focusSummary}
        onCloseAutoFocus={onDialogCloseFocus}
      />
      <StockEntryDialog
        target={dialog?.kind === "entry" ? target : null}
        idempotencyKey={dialog?.kind === "entry" ? dialog.idempotencyKey : ""}
        onClose={() => setDialog(null)}
        onDone={focusSummary}
        onCloseAutoFocus={onDialogCloseFocus}
      />
      <StockAdjustmentDialog
        target={dialog?.kind === "adjust" ? target : null}
        idempotencyKey={dialog?.kind === "adjust" ? dialog.idempotencyKey : ""}
        onClose={() => setDialog(null)}
        onDone={focusSummary}
        onCloseAutoFocus={onDialogCloseFocus}
      />
      <ConfirmDialog
        open={dialog?.kind === "disable"}
        onOpenChange={(next) => (next ? undefined : setDialog(null))}
        title="¿Desactivar el control de stock?"
        description={
          <div className="flex flex-col gap-2">
            <p>
              Las facturas nuevas de {data.name} dejarán de descontar su inventario. El kárdex se
              conserva y puedes reactivar el control después.
            </p>
            <p>
              Las facturas ya emitidas con el control activo aún pueden descontar su salida cuando
              el SRI las autorice, aunque el saldo quede negativo.
            </p>
          </div>
        }
        confirmLabel="Desactivar control"
        pending={tracking.isPending}
        onCloseAutoFocus={onDialogCloseFocus}
        onConfirm={() => tracking.mutate({ productId: data.productId, tracked: false })}
      />
    </section>
  );
}

export function StockItemDetailSkeleton() {
  return (
    <section aria-busy="true" className="flex flex-col gap-6">
      <Skeleton className="h-10 w-80" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-60 w-full" />
    </section>
  );
}
