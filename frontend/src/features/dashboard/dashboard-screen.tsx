// Tablero de Inicio (decisión del propietario, 2026-10-16). Usuario: administrador u operador, al
// abrir el sistema. Objetivo: saber de un vistazo cómo va el mes y qué pide atención. Decisión: qué
// revisar o qué hacer a continuación. Composición de tarjetas de la plantilla «Studio Admin» (MIT;
// frontend/THIRD_PARTY_NOTICES.md), con los datos del servidor (`GET /dashboard`) en el ambiente
// vigente:
// - si la empresa todavía no puede emitir, primero sus requisitos;
// - cuatro indicadores: ventas autorizadas, facturas, lo que requiere atención y borradores;
// - con los charts de shadcn/ui (`dashboard-charts.tsx`), cada uno con su tabla para la asistencia:
//   las ventas de los seis últimos meses en una línea con área, los mejores clientes en una dona con
//   su leyenda y los productos más vendidos en columnas con su código;
// - los comprobantes del mes por tipo, en barras apiladas de lo autorizado sobre lo emitido, también
//   con su tabla para la asistencia;
// - el estado del sistema (firma, ambiente y existencias): cuatro estados distintos, en una lista con
//   icono y texto, no en un gráfico, cada uno con un acceso rápido «Ir» a su sección si el rol la ve;
// - los últimos comprobantes, enlazados a su detalle.
// Las ventas son las facturas autorizadas; los importes son los del servidor, sin cálculos aquí.
"use client";

import { DOCUMENT_TYPE_LABELS, type DashboardView } from "@facturador/contracts";
import {
  ArrowRight,
  CircleAlert,
  CircleCheck,
  FileClock,
  FilePen,
  FileText,
  KeyRound,
  Plus,
  ReceiptText,
  TriangleAlert,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { ReactNode } from "react";
import { useSession } from "@/components/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDecimal, formatUsd } from "@/lib/decimal";
import { resolveRoute } from "@/lib/navigation/routes";
import { canSee } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { DOCUMENT_KINDS } from "@/features/archive/document-kinds";
import { ENVIRONMENT_LABELS, useCompanyStatus } from "@/features/company/company-api";
import { DocumentStatusBadge } from "@/features/documents/document-status-badge";
import { ReadinessChecks } from "@/features/home/readiness-screen";
import { formatIssueDate } from "@/features/invoices/invoice-format";
import { useCertificateValidity } from "@/features/signing/signing-api";
import { useDashboard } from "./dashboard-api";
import type { DocumentTypeRow, RankingRow } from "./dashboard-charts";
import { monthName } from "./dashboard-format";
import { DocumentsTable, RankingTable, SalesTable } from "./dashboard-tables";

// Los gráficos traen Recharts: se cargan aparte, después de los indicadores, y solo en el cliente.
const SalesChart = dynamic(() => import("./dashboard-charts").then((module) => module.SalesChart), {
  ssr: false,
  loading: () => <Skeleton className="h-64 w-full" />,
});
const ShareChart = dynamic(() => import("./dashboard-charts").then((module) => module.ShareChart), {
  ssr: false,
  loading: () => <Skeleton className="h-72 w-full" />,
});
const ColumnChart = dynamic(
  () => import("./dashboard-charts").then((module) => module.ColumnChart),
  { ssr: false, loading: () => <Skeleton className="h-60 w-full" /> },
);
const DocumentsChart = dynamic(
  () => import("./dashboard-charts").then((module) => module.DocumentsChart),
  { ssr: false, loading: () => <Skeleton className="h-64 w-full" /> },
);

/** Un indicador: su cifra, una línea de contexto y, si aplica, adónde ir. */
function Metric({
  title,
  icon: Icon,
  value,
  detail,
  href,
  hrefLabel,
  tone = "neutral",
}: {
  title: string;
  icon: LucideIcon;
  value: string;
  detail: ReactNode;
  href?: string;
  hrefLabel?: string;
  tone?: "neutral" | "warning";
}) {
  return (
    <Card size="sm" data-slot="dashboard-metric">
      <CardHeader>
        <CardDescription className="flex items-center gap-2">
          <Icon
            aria-hidden="true"
            className={cn("size-4", tone === "warning" ? "text-warning" : "text-foreground-muted")}
          />
          {title}
        </CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums">{value}</CardTitle>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-2 text-xs text-foreground-muted">
        <span>{detail}</span>
        {href && hrefLabel && (
          <Link href={href} className="shrink-0 font-medium text-primary hover:underline">
            {hrefLabel}
          </Link>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Un dato del estado del sistema: su nombre, debajo su valor con icono y tono, y a la derecha el
 * acceso rápido «Ir» a su sección (decisión del propietario, 2026-10-22). El botón solo aparece si
 * el rol puede abrir esa sección, con el permiso que exige la navegación.
 */
function StatusRow({
  icon: Icon,
  label,
  value,
  tone,
  href,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone: "success" | "warning" | "danger" | "neutral";
  /** La sección del dato, como `/inventario`. */
  href: string;
}) {
  const { me } = useSession();
  const route = resolveRoute(href);
  const reachable =
    route !== null && (route.permission === null || canSee(me.role, route.permission));
  const ToneIcon = tone === "success" ? CircleCheck : tone === "neutral" ? null : TriangleAlert;
  return (
    <li className="flex items-center gap-3 py-2.5">
      <Icon aria-hidden="true" className="size-4 shrink-0 text-foreground-muted" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm">{label}</span>
        <span
          className={cn(
            "flex items-center gap-1 text-sm font-medium",
            tone === "success" && "text-success",
            tone === "warning" && "text-foreground",
            tone === "danger" && "text-danger",
          )}
        >
          {ToneIcon && (
            <ToneIcon
              aria-hidden="true"
              className={cn("size-4 shrink-0", tone === "warning" && "text-warning")}
            />
          )}
          {value}
        </span>
      </div>
      {reachable && (
        <Button asChild variant="outline" size="sm" className="shrink-0">
          <Link href={href} aria-label={`Ir a ${route.destination.label}`}>
            Ir
            <ArrowRight aria-hidden="true" data-icon="inline-end" />
          </Link>
        </Button>
      )}
    </li>
  );
}

function Dashboard({ data }: { data: DashboardView }) {
  const { me } = useSession();
  const status = useCompanyStatus();
  const validity = useCertificateValidity(true);
  const canCreate = canSee(me.role, "invoices.draft");
  const canConfigure = canSee(me.role, "taxpayer.configure");
  const currentMonth = data.today.slice(0, 7);
  const previousMonth = data.monthly.at(-2)?.month;
  const invoices = data.month.invoices;
  const hasActivity = data.recent.length > 0;
  const environment = ENVIRONMENT_LABELS[data.environment];
  const readiness = status.data?.readiness;
  const certificate = validity.data;
  const customerRows: RankingRow[] = data.topCustomers.map((customer) => ({
    key: customer.identification,
    name: customer.name,
    detail: `${customer.identification} · ${
      customer.invoices === 1 ? "1 factura" : `${customer.invoices} facturas`
    }`,
    value: customer.authorizedTotal,
  }));
  const typeRows: DocumentTypeRow[] = data.month.byType.map((row) => ({
    key: row.documentType,
    name: DOCUMENT_TYPE_LABELS[row.documentType],
    issued: row.issued,
    authorized: row.authorized,
    amount: row.authorizedTotal,
  }));
  const productRows: RankingRow[] = data.topProducts.map((product) => ({
    key: `${product.mainCode ?? ""}-${product.description}`,
    name: product.description,
    detail: `${product.mainCode ? `${product.mainCode} · ` : ""}${formatDecimal(product.quantity)} unidades`,
    value: product.total,
    // Bajo cada columna cabe el código; sin código, el comienzo de la descripción.
    short:
      product.mainCode ??
      (product.description.length > 8
        ? `${product.description.slice(0, 7)}…`
        : product.description),
  }));

  const certificateRow = !certificate
    ? { value: "Consultando…", tone: "neutral" as const }
    : certificate.state === "NONE"
      ? { value: "Sin cargar", tone: "danger" as const }
      : certificate.state === "EXPIRED"
        ? { value: "Vencida", tone: "danger" as const }
        : certificate.state === "KEY_UNAVAILABLE"
          ? { value: "No utilizable", tone: "danger" as const }
          : certificate.state === "EXPIRING"
            ? { value: `Vence en ${certificate.daysToExpiry ?? 0} días`, tone: "warning" as const }
            : {
                value:
                  certificate.daysToExpiry !== null
                    ? `Vigente · ${certificate.daysToExpiry} días`
                    : "Vigente",
                tone: "success" as const,
              };

  return (
    <section aria-labelledby="inicio-titulo" className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 id="inicio-titulo" className="text-3xl font-bold">
            Resumen
          </h1>
          <p className="text-sm text-foreground-muted">
            {status.data?.displayName ? `${status.data.displayName} · ` : ""}
            Actividad de {monthName(currentMonth)} hasta el {formatIssueDate(data.today)}, en{" "}
            {environment}.
          </p>
        </div>
        {canCreate && (
          <Button asChild size="default">
            <Link href="/borradores/nuevo">
              <Plus aria-hidden="true" data-icon="inline-start" />
              Nueva factura
            </Link>
          </Button>
        )}
      </header>

      {readiness && !readiness.ready && status.data && (
        <Card data-slot="dashboard-readiness" className="ring-warning/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TriangleAlert aria-hidden="true" className="size-4 text-warning" />
              Tu empresa todavía no puede emitir
            </CardTitle>
            <CardDescription>
              {canConfigure
                ? "Completa estos requisitos para emitir comprobantes."
                : "Pide a un administrador que complete la configuración."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <ReadinessChecks status={status.data} canConfigure={canConfigure} />
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          title={`Ventas autorizadas de ${monthName(currentMonth)}`}
          icon={ReceiptText}
          value={formatUsd(invoices.authorizedTotal)}
          detail={
            previousMonth
              ? `En ${monthName(previousMonth)}: ${formatUsd(invoices.previousAuthorizedTotal)}`
              : null
          }
        />
        <Metric
          title="Facturas del mes"
          icon={FileText}
          value={formatDecimal(String(invoices.issuedCount))}
          detail={
            invoices.authorizedCount === 1
              ? "1 autorizada"
              : `${formatDecimal(String(invoices.authorizedCount))} autorizadas`
          }
          href="/facturas"
          hrefLabel="Ver facturas"
        />
        <Metric
          title="Requieren atención"
          icon={data.attention.count > 0 ? CircleAlert : CircleCheck}
          tone={data.attention.count > 0 ? "warning" : "neutral"}
          value={formatDecimal(String(data.attention.count))}
          detail={
            data.attention.rejectedLast30Days > 0
              ? `${data.attention.rejectedLast30Days} devueltos o no autorizados en 30 días`
              : "Sin rechazos en 30 días"
          }
          href="/comprobantes"
          hrefLabel="Revisar"
        />
        <Metric
          title="Borradores de facturas"
          icon={FilePen}
          value={formatDecimal(String(data.drafts.invoices))}
          detail={data.drafts.invoices > 0 ? "Pendientes de emitir" : "Ninguno pendiente"}
          href="/facturas?estado=borradores"
          hrefLabel="Ver borradores"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="border-b">
            <CardTitle>Ventas autorizadas</CardTitle>
            <CardDescription>Facturas autorizadas de los seis últimos meses.</CardDescription>
            <CardAction>
              <Badge variant="neutral">{environment}</Badge>
            </CardAction>
          </CardHeader>
          <CardContent>
            <SalesChart monthly={data.monthly} />
            <SalesTable monthly={data.monthly} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b">
            <CardTitle>Comprobantes del mes</CardTitle>
            <CardDescription>Emitidos y autorizados, por tipo.</CardDescription>
          </CardHeader>
          <CardContent>
            {typeRows.length === 0 ? (
              <p className="text-sm text-foreground-muted">Todavía no hay comprobantes este mes.</p>
            ) : (
              <div data-slot="documents-chart">
                <DocumentsChart rows={typeRows} />
                <DocumentsTable rows={typeRows} />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="border-b">
            <CardTitle>Mejores clientes</CardTitle>
            <CardDescription>Por lo facturado y autorizado en el mes.</CardDescription>
          </CardHeader>
          <CardContent>
            {data.topCustomers.length === 0 ? (
              <p className="text-sm text-foreground-muted">
                Aún no hay facturas autorizadas este mes.
              </p>
            ) : (
              <div data-slot="ranking-chart">
                <ShareChart rows={customerRows} />
                <RankingTable
                  rows={customerRows}
                  caption="Mejores clientes del mes"
                  nameHeader="Cliente"
                  detailHeader="Identificación y facturas"
                />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b">
            <CardTitle>Productos más vendidos</CardTitle>
            <CardDescription>Por subtotal facturado y autorizado en el mes.</CardDescription>
          </CardHeader>
          <CardContent>
            {data.topProducts.length === 0 ? (
              <p className="text-sm text-foreground-muted">
                Aún no hay facturas autorizadas este mes.
              </p>
            ) : (
              <div data-slot="ranking-chart">
                <ColumnChart rows={productRows} />
                <RankingTable
                  rows={productRows}
                  caption="Productos más vendidos del mes"
                  nameHeader="Producto"
                  detailHeader="Código y unidades"
                />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b">
            <CardTitle>Estado del sistema</CardTitle>
            <CardDescription>Lo que permite seguir emitiendo.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y divide-border">
              <StatusRow
                icon={KeyRound}
                label="Firma electrónica"
                value={certificateRow.value}
                tone={certificateRow.tone}
                href="/configuracion/firma"
              />
              <StatusRow
                icon={FileClock}
                label="Ambiente"
                value={environment}
                tone={data.environment === "TEST" ? "warning" : "neutral"}
                href="/configuracion/ambiente"
              />
              <StatusRow
                icon={Warehouse}
                label="Productos agotados"
                value={String(data.inventory.outOfStock)}
                tone={data.inventory.outOfStock > 0 ? "warning" : "success"}
                href="/inventario"
              />
              <StatusRow
                icon={CircleAlert}
                label="Comprobantes con atención"
                value={String(data.attention.count)}
                tone={data.attention.count > 0 ? "warning" : "success"}
                href="/comprobantes"
              />
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="border-b">
          <CardTitle>Últimos comprobantes</CardTitle>
          <CardDescription>Los más recientes de cualquier tipo, con su estado.</CardDescription>
          <CardAction>
            <Button asChild variant="outline" size="sm">
              <Link href="/comprobantes">Ver todos</Link>
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="px-0">
          {hasActivity ? (
            <Table aria-label="Últimos comprobantes">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Comprobante</TableHead>
                  <TableHead className="max-md:hidden">Contraparte</TableHead>
                  <TableHead className="max-sm:hidden">Fecha</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="pr-4 text-right">Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recent.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="pl-4">
                      <Link
                        href={`${DOCUMENT_KINDS[row.documentType].detailPath}/${row.id}`}
                        className="font-medium tabular-nums hover:underline"
                      >
                        {row.documentNumber}
                      </Link>
                      <span className="block text-xs text-foreground-muted">
                        {DOCUMENT_TYPE_LABELS[row.documentType]}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-56 truncate max-md:hidden">
                      {row.counterpart ?? "—"}
                    </TableCell>
                    <TableCell className="tabular-nums max-sm:hidden">
                      {formatIssueDate(row.issueDate)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.total === null ? "—" : formatUsd(row.total)}
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <DocumentStatusBadge state={row.state} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
              <FileText aria-hidden="true" className="size-6 text-foreground-muted" />
              <p className="text-sm text-foreground-muted">
                Todavía no hay comprobantes en {environment}. Cuando emitas, aparecerán aquí.
              </p>
              {canCreate && (
                <Button asChild variant="outline" size="default">
                  <Link href="/borradores/nuevo">Nueva factura</Link>
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

/** Carga sin saltos: la misma rejilla del tablero. */
export function DashboardSkeleton() {
  return (
    <section aria-busy="true" aria-labelledby="inicio-titulo" className="flex flex-col gap-6">
      <span className="sr-only" role="status">
        Cargando el resumen
      </span>
      <h1 id="inicio-titulo" className="text-3xl font-bold">
        Resumen
      </h1>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((key) => (
          <Skeleton key={key} className="h-28 rounded-xl" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-72 rounded-xl lg:col-span-2" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    </section>
  );
}

export function DashboardScreen() {
  const { me } = useSession();
  const allowed = canSee(me.role, "invoices.read");
  const dashboard = useDashboard(allowed);

  if (!allowed) return null;
  if (dashboard.isPending) return <DashboardSkeleton />;
  if (dashboard.isError) {
    return (
      <section aria-labelledby="inicio-titulo" className="flex flex-col gap-6">
        <h1 id="inicio-titulo" className="text-3xl font-bold">
          Resumen
        </h1>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-6 text-center">
            <CircleAlert aria-hidden="true" className="size-6 text-danger" />
            <p className="text-sm" role="alert">
              No pudimos cargar el resumen.
            </p>
            <Button variant="outline" size="default" onClick={() => void dashboard.refetch()}>
              Intentar de nuevo
            </Button>
          </CardContent>
        </Card>
      </section>
    );
  }
  return <Dashboard data={dashboard.data} />;
}
