// Tablero de Inicio (decisión del propietario, 2026-10-16). Usuario: administrador u operador, al
// abrir el sistema. Objetivo: saber de un vistazo cómo va el mes y qué pide atención. Decisión: qué
// revisar o qué hacer a continuación. Composición de tarjetas de la plantilla «Studio Admin» (MIT;
// frontend/THIRD_PARTY_NOTICES.md), con los datos del servidor (`GET /dashboard`) en el ambiente
// vigente:
// - si la empresa todavía no puede emitir, primero sus requisitos;
// - cuatro indicadores: ventas autorizadas, facturas, lo que requiere atención y borradores;
// - las ventas de los seis últimos meses, en barras SVG con una tabla para la asistencia;
// - los comprobantes del mes por tipo, los mejores clientes, los productos más vendidos y el estado
//   del sistema (firma, ambiente y existencias);
// - los últimos comprobantes, enlazados a su detalle.
// Las ventas son las facturas autorizadas; los importes son los del servidor, sin cálculos aquí.
"use client";

import { DOCUMENT_TYPE_LABELS, type DashboardView } from "@facturador/contracts";
import {
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
import Link from "next/link";
import type { ReactNode } from "react";
import { useSession } from "@/components/session";
import { Avatar, AvatarFallback, initials } from "@/components/ui/avatar";
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
import { canSee } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { DOCUMENT_KINDS } from "@/features/archive/document-kinds";
import { ENVIRONMENT_LABELS, useCompanyStatus } from "@/features/company/company-api";
import { DocumentStatusBadge } from "@/features/documents/document-status-badge";
import { ReadinessChecks } from "@/features/home/readiness-screen";
import { formatIssueDate } from "@/features/invoices/invoice-format";
import { useCertificateValidity } from "@/features/signing/signing-api";
import { useDashboard } from "./dashboard-api";

const MONTH = new Intl.DateTimeFormat("es-EC", { month: "long", timeZone: "UTC" });
const MONTH_SHORT = new Intl.DateTimeFormat("es-EC", { month: "short", timeZone: "UTC" });
const COMPACT = new Intl.NumberFormat("es-EC", { notation: "compact", maximumFractionDigits: 1 });

/** «2026-09» → «septiembre». */
const monthName = (month: string, format = MONTH) =>
  format.format(new Date(`${month}-01T12:00:00Z`)).replace(".", "");

/** Tonos de las iniciales, de los tokens del tema: el mismo nombre, el mismo tono. */
const AVATAR_TONES = [
  "bg-primary/10 text-primary",
  "bg-success/10 text-success",
  "bg-info/10 text-info",
  "bg-warning/15 text-foreground",
  "bg-danger/10 text-danger",
];
const avatarTone = (name: string) =>
  AVATAR_TONES[[...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % AVATAR_TONES.length];

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

/** Ventas autorizadas de los seis últimos meses: barras SVG y su tabla para la asistencia. */
function SalesChart({ monthly }: { monthly: DashboardView["monthly"] }) {
  // Solo para la altura de las barras: los importes se muestran como los da el servidor.
  const values = monthly.map((month) => Number(month.authorizedTotal));
  const max = Math.max(...values, 1);
  const width = 100 / monthly.length;
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-6 gap-2 text-center text-xs text-foreground-muted tabular-nums">
        {monthly.map((month, index) => (
          <span key={month.month} aria-hidden="true">
            {values[index]! > 0 ? COMPACT.format(values[index]!) : "—"}
          </span>
        ))}
      </div>
      <svg
        aria-hidden="true"
        viewBox="0 0 100 50"
        preserveAspectRatio="none"
        className="h-40 w-full"
      >
        {monthly.map((month, index) => {
          const height = Math.max((values[index]! / max) * 48, values[index]! > 0 ? 1 : 0.4);
          const current = index === monthly.length - 1;
          return (
            <rect
              key={month.month}
              x={index * width + width * 0.18}
              y={50 - height}
              width={width * 0.64}
              height={height}
              rx={0.8}
              className={current ? "fill-primary" : "fill-primary/35"}
            >
              <title>{`${monthName(month.month)}: ${formatUsd(month.authorizedTotal)}`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="grid grid-cols-6 gap-2 text-center text-xs text-foreground-muted capitalize">
        {monthly.map((month) => (
          <span key={month.month} aria-hidden="true">
            {monthName(month.month, MONTH_SHORT)}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>Ventas autorizadas por mes</caption>
        <thead>
          <tr>
            <th scope="col">Mes</th>
            <th scope="col">Facturas autorizadas</th>
            <th scope="col">Total</th>
          </tr>
        </thead>
        <tbody>
          {monthly.map((month) => (
            <tr key={month.month}>
              <th scope="row">{monthName(month.month)}</th>
              <td>{month.authorizedCount}</td>
              <td>{formatUsd(month.authorizedTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Una lista de la tarjeta, o el texto que explica por qué está vacía. */
function ListOrEmpty({ empty, children }: { empty: string | null; children: ReactNode }) {
  if (empty) return <p className="text-sm text-foreground-muted">{empty}</p>;
  return <ul className="flex flex-col divide-y divide-border">{children}</ul>;
}

/** Un dato del estado del sistema: su nombre, su valor y su tono, con icono y texto. */
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
  href?: string;
}) {
  const ToneIcon = tone === "success" ? CircleCheck : tone === "neutral" ? null : TriangleAlert;
  return (
    <li className="flex items-center gap-3 py-2.5">
      <Icon aria-hidden="true" className="size-4 shrink-0 text-foreground-muted" />
      <span className="min-w-0 flex-1 text-sm">{label}</span>
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
            className={cn("size-4", tone === "warning" && "text-warning")}
          />
        )}
        {href ? (
          <Link href={href} className="hover:underline">
            {value}
          </Link>
        ) : (
          value
        )}
      </span>
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
          href="/borradores"
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b">
            <CardTitle>Comprobantes del mes</CardTitle>
            <CardDescription>Emitidos y autorizados, por tipo.</CardDescription>
          </CardHeader>
          <CardContent>
            <ListOrEmpty
              empty={
                data.month.byType.length === 0 ? "Todavía no hay comprobantes este mes." : null
              }
            >
              {data.month.byType.map((row) => (
                <li key={row.documentType} className="flex items-center gap-3 py-2.5">
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="text-sm font-medium">
                      {DOCUMENT_TYPE_LABELS[row.documentType]}
                    </span>
                    <span className="text-xs text-foreground-muted tabular-nums">
                      {row.issued} emitidos · {row.authorized} autorizados
                    </span>
                  </div>
                  <span className="text-sm font-medium tabular-nums">
                    {row.authorizedTotal === null ? "—" : formatUsd(row.authorizedTotal)}
                  </span>
                </li>
              ))}
            </ListOrEmpty>
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
            <ListOrEmpty
              empty={
                data.topCustomers.length === 0 ? "Aún no hay facturas autorizadas este mes." : null
              }
            >
              {data.topCustomers.map((customer) => (
                <li key={customer.identification} className="flex items-center gap-3 py-2.5">
                  <Avatar size="lg">
                    <AvatarFallback
                      className={cn("text-xs font-semibold", avatarTone(customer.name))}
                    >
                      {initials(customer.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium" title={customer.name}>
                      {customer.name}
                    </span>
                    <span className="text-xs text-foreground-muted tabular-nums">
                      {customer.identification} ·{" "}
                      {customer.invoices === 1 ? "1 factura" : `${customer.invoices} facturas`}
                    </span>
                  </div>
                  <span className="text-sm font-medium tabular-nums">
                    {formatUsd(customer.authorizedTotal)}
                  </span>
                </li>
              ))}
            </ListOrEmpty>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b">
            <CardTitle>Productos más vendidos</CardTitle>
            <CardDescription>Por subtotal facturado y autorizado en el mes.</CardDescription>
          </CardHeader>
          <CardContent>
            <ListOrEmpty
              empty={
                data.topProducts.length === 0 ? "Aún no hay facturas autorizadas este mes." : null
              }
            >
              {data.topProducts.map((product, index) => (
                <li
                  key={`${product.mainCode ?? ""}-${product.description}`}
                  className="flex items-center gap-3 py-2.5"
                >
                  <span
                    aria-hidden="true"
                    className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold text-foreground-muted tabular-nums"
                  >
                    {index + 1}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium" title={product.description}>
                      {product.description}
                    </span>
                    <span className="text-xs text-foreground-muted tabular-nums">
                      {product.mainCode ? `${product.mainCode} · ` : ""}
                      {formatDecimal(product.quantity)} unidades
                    </span>
                  </div>
                  <span className="text-sm font-medium tabular-nums">
                    {formatUsd(product.total)}
                  </span>
                </li>
              ))}
            </ListOrEmpty>
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
                {...(canConfigure ? { href: "/configuracion/firma" } : {})}
              />
              <StatusRow
                icon={FileClock}
                label="Ambiente"
                value={environment}
                tone={data.environment === "TEST" ? "warning" : "neutral"}
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
