// Tablero de Inicio (decisión del propietario, 2026-10-16). Usuario: administrador u operador, al
// abrir el sistema. Objetivo: saber de un vistazo cómo va el mes y qué pide atención. Decisión: qué
// revisar o qué hacer a continuación. Composición de tarjetas de la plantilla «Studio Admin» (MIT;
// frontend/THIRD_PARTY_NOTICES.md), con los datos del servidor (`GET /dashboard`) en el ambiente
// vigente:
// - si la empresa todavía no puede emitir, primero sus requisitos;
// - cuatro indicadores comerciales (redesign-dashboard-indicators): ventas autorizadas con su
//   variación, facturas autorizadas sobre las emitidas, problemas de autorización y borradores;
// - con los charts de shadcn/ui (`dashboard-charts.tsx`), cada uno con su tabla para la asistencia:
//   las ventas de los seis últimos meses en una línea con área, los mejores clientes en una dona con
//   su leyenda y los productos más vendidos en columnas con su código;
// - los comprobantes del mes por tipo, en barras apiladas de lo autorizado sobre lo emitido, también
//   con su tabla para la asistencia;
// - el estado de facturación electrónica (firma, conexión con el SRI y entrega de comprobantes), en
//   una lista con su estado en texto, cada fila enlazada a su sección si el rol la ve;
// - los últimos comprobantes, enlazados a su detalle.
// Las ventas son las facturas autorizadas; los importes son los del servidor, sin cálculos aquí.
"use client";

import {
  DOCUMENT_TYPE_LABELS,
  type CertificateValidityView,
  type DashboardView,
  type EmailAvailability,
} from "@facturador/contracts";
import {
  ArrowUpRight,
  ChevronRight,
  CircleAlert,
  FileCheck2,
  FilePen,
  FileText,
  KeyRound,
  Mail,
  Minus,
  Plus,
  RadioTower,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Wallet,
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
import { useEmailAvailability } from "@/features/email/email-api";
import { ReadinessChecks } from "@/features/home/readiness-screen";
import { formatDateTime, formatIssueDate } from "@/features/invoices/invoice-format";
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

type Tone = "success" | "warning" | "danger" | "neutral" | "info";

const ICON_TONES = {
  primary: "border-primary/20 bg-primary/10 text-primary",
  warning: "border-warning/30 bg-warning/10 text-warning",
  neutral: "border-border bg-muted text-foreground-muted",
} as const;

/**
 * Un indicador (redesign-dashboard-indicators, design D4): el icono en su caja, un enlace con flecha
 * a su lista arriba a la derecha, el título, la cifra con su insignia y una línea de contexto. Un
 * degradado azul suave sube desde el pie de la tarjeta.
 */
function Metric({
  title,
  icon: Icon,
  tone = "primary",
  value,
  of,
  badge,
  detail,
  href,
  hrefLabel,
}: {
  title: string;
  icon: LucideIcon;
  tone?: keyof typeof ICON_TONES;
  value: string;
  /** El total del que forma parte la cifra, como «15 / 18». */
  of?: string;
  badge?: ReactNode;
  detail: ReactNode;
  href: string;
  hrefLabel: string;
}) {
  return (
    <Card
      size="sm"
      data-slot="dashboard-metric"
      className="bg-linear-to-t from-primary/8 to-card dark:from-primary/15"
    >
      <CardContent className="flex flex-1 flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <span
            aria-hidden="true"
            data-slot="dashboard-metric-icon"
            className={cn(
              "flex size-8 items-center justify-center rounded-lg border",
              ICON_TONES[tone],
            )}
          >
            <Icon className="size-4" />
          </span>
          <Link
            href={href}
            aria-label={hrefLabel}
            title={hrefLabel}
            className="-m-1 rounded-md p-1 text-foreground-muted transition-colors hover:bg-muted hover:text-foreground max-md:p-2.5"
          >
            <ArrowUpRight aria-hidden="true" className="size-4" />
          </Link>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <CardDescription>{title}</CardDescription>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <CardTitle className="text-2xl font-semibold tabular-nums">
              {value}
              {of !== undefined && (
                <span className="text-base font-medium text-foreground-muted"> / {of}</span>
              )}
            </CardTitle>
            {badge}
          </div>
          <p className="text-xs text-foreground-muted">{detail}</p>
        </div>
      </CardContent>
    </Card>
  );
}

/** La variación de las ventas, que calcula el servidor: con signo y flecha, nunca solo color. */
function TrendBadge({ percent }: { percent: string }) {
  const negative = percent.startsWith("-");
  const zero = Number(percent) === 0;
  const Icon = zero ? Minus : negative ? TrendingDown : TrendingUp;
  const text = formatDecimal(negative ? percent.slice(1) : percent, { minFractionDigits: 1 });
  return (
    <Badge
      data-slot="dashboard-trend"
      variant={zero ? "neutral" : negative ? "destructive" : "success"}
      className="tabular-nums"
    >
      <Icon aria-hidden="true" />
      {zero ? "" : negative ? "−" : "+"}
      {text} %
    </Badge>
  );
}

const STATUS_BADGES: Record<Tone, "success" | "warning" | "destructive" | "neutral" | "info"> = {
  success: "success",
  warning: "warning",
  danger: "destructive",
  neutral: "neutral",
  info: "info",
};

/**
 * Una fila del estado de facturación electrónica (design D2, D3 y D5): su nombre, el detalle debajo
 * y el estado en texto a la derecha. Enlaza a su sección solo si el rol puede abrirla, con el permiso
 * que exige la navegación.
 */
function InvoicingRow({
  icon: Icon,
  label,
  detail,
  status,
  tone,
  href,
}: {
  icon: LucideIcon;
  label: string;
  detail: string;
  status: string;
  tone: Tone;
  /** La sección de la fila, como `/configuracion/firma`. */
  href?: string;
}) {
  const { me } = useSession();
  const route = href ? resolveRoute(href.split("?")[0]!) : null;
  const reachable =
    href !== undefined &&
    route !== null &&
    (route.permission === null || canSee(me.role, route.permission));
  const content = (
    <>
      <span
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-foreground-muted"
      >
        <Icon className="size-4" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-foreground-muted">{detail}</span>
      </span>
      <Badge variant={STATUS_BADGES[tone]} className="shrink-0">
        {status}
      </Badge>
    </>
  );
  return (
    <li data-slot="invoicing-status" className="py-1">
      {reachable ? (
        <Link
          href={href}
          className="group/status -mx-2 flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted"
        >
          {content}
          <ChevronRight
            aria-hidden="true"
            className="size-4 shrink-0 text-foreground-muted transition-transform group-hover/status:translate-x-0.5"
          />
        </Link>
      ) : (
        <div className="flex items-center gap-3 py-2">{content}</div>
      )}
    </li>
  );
}

type RowState = { detail: string; status: string; tone: Tone; href?: string };

function certificateState(certificate: CertificateValidityView | undefined): RowState {
  if (!certificate)
    return { detail: "Consultando la firma…", status: "Consultando", tone: "neutral" };
  switch (certificate.state) {
    case "NONE":
      return {
        detail: "Todavía no cargas la firma electrónica",
        status: "Sin cargar",
        tone: "danger",
      };
    case "EXPIRED":
      return { detail: "La firma venció: no puedes emitir", status: "Vencida", tone: "danger" };
    case "KEY_UNAVAILABLE":
      return {
        detail: "La clave guardada no se puede usar",
        status: "No utilizable",
        tone: "danger",
      };
    case "EXPIRING":
      return {
        detail: `Vence en ${certificate.daysToExpiry ?? 0} días`,
        status: "Por vencer",
        tone: "warning",
      };
    default:
      return {
        detail:
          certificate.daysToExpiry !== null
            ? `Vigente · Vence en ${certificate.daysToExpiry} días`
            : "Vigente",
        status: "Activa",
        tone: "success",
      };
  }
}

/** Design D2: de los intentos guardados; el tablero nunca contacta al SRI. */
function sriState(sri: DashboardView["sri"]): RowState {
  if (!sri.transmissionEnabled) {
    return {
      detail: "El envío al SRI está apagado en este servidor",
      status: "Apagado",
      tone: "neutral",
    };
  }
  if (!sri.lastContact) {
    return {
      detail: "Todavía no hay comunicaciones con el SRI",
      status: "Sin datos",
      tone: "neutral",
    };
  }
  const at = formatDateTime(sri.lastContact.at);
  return sri.lastContact.reached
    ? { detail: `Última comunicación correcta: ${at}`, status: "Disponible", tone: "success" }
    : {
        detail: `La última comunicación no tuvo respuesta: ${at}`,
        status: "Sin respuesta",
        tone: "danger",
      };
}

const emails = (count: number) =>
  count === 1 ? "1 correo" : `${formatDecimal(String(count))} correos`;

/** Design D3: la disponibilidad del correo y los envíos del resumen, en ese orden. */
function deliveryState(
  availability: EmailAvailability | undefined,
  failed: number,
  pending: number,
): RowState {
  if (availability && !availability.deliveryEnabled) {
    return { detail: "El envío por correo está apagado", status: "Apagado", tone: "neutral" };
  }
  if (availability && !availability.configured) {
    return {
      detail: "Falta configurar el servidor de correo",
      status: "Configurar",
      tone: "warning",
      href: "/configuracion/correos",
    };
  }
  if (failed > 0) {
    return {
      detail: `${emails(failed)} sin enviar`,
      status: "Revisar",
      tone: "warning",
      href: "/comprobantes?correo=no-enviado",
    };
  }
  if (pending > 0) {
    return { detail: `${emails(pending)} en cola`, status: "Enviando", tone: "info" };
  }
  return { detail: "Los correos están al día", status: "Al día", tone: "success" };
}

/** «83,3 %»: la parte de las facturas del mes que ya están autorizadas, de dos conteos. */
function shareOf(part: number, whole: number): string {
  return `${formatDecimal(String(Math.round((part * 1000) / whole) / 10))} %`;
}

function Dashboard({ data }: { data: DashboardView }) {
  const { me } = useSession();
  const status = useCompanyStatus();
  const validity = useCertificateValidity(true);
  const availability = useEmailAvailability(true);
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

  const certificateRow = certificateState(certificate);
  const sriRow = sriState(data.sri);
  const deliveryRow = deliveryState(
    availability.data,
    data.attention.emailFailed,
    data.email.pending,
  );
  const rejected = data.attention.rejectedLast30Days;

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
          title={`Ventas autorizadas · ${monthName(currentMonth)}`}
          icon={Wallet}
          value={formatUsd(invoices.authorizedTotal)}
          badge={
            invoices.previousChangePercent !== null && (
              <TrendBadge percent={invoices.previousChangePercent} />
            )
          }
          detail={
            previousMonth
              ? `Frente a ${formatUsd(invoices.previousAuthorizedTotal)} en ${monthName(previousMonth)}`
              : "Sin un mes anterior para comparar"
          }
          href="/facturas?estado=autorizadas"
          hrefLabel="Ver facturas autorizadas"
        />
        <Metric
          title="Facturas autorizadas"
          icon={FileCheck2}
          value={formatDecimal(String(invoices.authorizedCount))}
          of={formatDecimal(String(invoices.issuedCount))}
          detail={
            invoices.issuedCount > 0
              ? `${shareOf(invoices.authorizedCount, invoices.issuedCount)} de las facturas del mes`
              : "Todavía no hay facturas este mes"
          }
          href="/facturas"
          hrefLabel="Ver facturas"
        />
        <Metric
          title="Problemas de autorización"
          icon={TriangleAlert}
          tone={rejected > 0 ? "warning" : "neutral"}
          value={formatDecimal(String(rejected))}
          detail="Devueltos o no autorizados en 30 días"
          href="/comprobantes?estado=devueltos"
          hrefLabel="Ver comprobantes devueltos"
        />
        <Metric
          title="Facturas en borrador"
          icon={FilePen}
          tone="neutral"
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
          {/* `relative`: la tabla para la asistencia, fuera de la vista, no ensancha la página. */}
          <CardContent className="relative">
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
              <div data-slot="documents-chart" className="relative">
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
              <div data-slot="ranking-chart" className="relative">
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
              <div data-slot="ranking-chart" className="relative">
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
            <CardTitle>Estado de facturación electrónica</CardTitle>
            <CardDescription>
              Lo que necesitas para emitir y entregar tus comprobantes.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y divide-border">
              <InvoicingRow
                icon={KeyRound}
                label="Firma electrónica"
                {...certificateRow}
                href="/configuracion/firma"
              />
              <InvoicingRow icon={RadioTower} label="Conexión con SRI" {...sriRow} />
              <InvoicingRow icon={Mail} label="Entrega de comprobantes" {...deliveryRow} />
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
