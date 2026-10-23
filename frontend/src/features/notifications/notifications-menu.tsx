// Avisos de la barra superior (decisión del propietario, 2026-10-22): una campana a la izquierda de
// la identidad, con el número de avisos pendientes, que abre la lista de lo que pide atención. Cada
// aviso es una condición que el servidor ya informa, no un evento: desaparece cuando se resuelve.
// - La firma electrónica vencida, sin su clave o por vencer (`certificateValidity.read`).
// - La empresa que todavía no puede emitir, con lo que le falta (`GET /company/status`).
// - Del resumen del tablero (`invoices.read`): los comprobantes que requieren atención, los devueltos
//   o no autorizados en 30 días y los productos agotados.
// Cada aviso lleva a su sección solo si el rol puede abrirla; si no, dice a quién pedírselo.
"use client";

import { useQuery } from "@tanstack/react-query";
import { dashboardViewSchema } from "@facturador/contracts";
import { Bell, CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useSession } from "@/components/session";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { apiFetch } from "@/lib/api";
import { resolveRoute } from "@/lib/navigation/routes";
import { canSee } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { READINESS_COPY, useCompanyStatus } from "@/features/company/company-api";
import { DASHBOARD_KEY } from "@/features/dashboard/dashboard-api";
import { formatDate, useCertificateValidity } from "@/features/signing/signing-api";
import { daysPhrase } from "@/features/signing/signing-screen";

export type Notice = {
  id: string;
  tone: "danger" | "warning";
  title: string;
  detail: string;
  /** Adónde ir a resolverlo; sin `href`, `detail` dice a quién pedírselo. */
  action?: { href: string; label: string };
};

const count = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

/**
 * El resumen del tablero, compartido con Inicio (misma clave). Aquí no se recalcula al volver a la
 * ventana ni en cada pantalla: basta con que tenga menos de cinco minutos.
 */
function useDashboardSignals(enabled: boolean) {
  return useQuery({
    queryKey: DASHBOARD_KEY,
    enabled,
    staleTime: 5 * 60_000,
    queryFn: ({ signal }) => apiFetch("/dashboard", { schema: dashboardViewSchema, signal }),
  });
}

/** Los avisos pendientes, primero los que impiden emitir. */
export function useNotices(): Notice[] {
  const { me } = useSession();
  const can = (href: string) => {
    const route = resolveRoute(href);
    return route !== null && (route.permission === null || canSee(me.role, route.permission));
  };
  const validity = useCertificateValidity(canSee(me.role, "certificateValidity.read"));
  const status = useCompanyStatus();
  const dashboard = useDashboardSignals(canSee(me.role, "invoices.read"));
  const notices: Notice[] = [];

  const certificate = validity.data;
  const signing = { href: "/configuracion/firma", label: "Ir a Firma electrónica" };
  const renew = can(signing.href) ? { action: signing } : null;
  const askAdmin = " Pide a un administrador que la renueve.";
  let certificateBlocks = false;
  if (certificate?.state === "EXPIRED" && certificate.notAfter) {
    certificateBlocks = true;
    notices.push({
      id: "firma-vencida",
      tone: "danger",
      title: "La firma electrónica venció",
      detail: `Venció el ${formatDate(certificate.notAfter)}: no se puede emitir.${renew ? "" : askAdmin}`,
      ...renew,
    });
  } else if (certificate?.state === "KEY_UNAVAILABLE") {
    certificateBlocks = true;
    notices.push({
      id: "firma-no-disponible",
      tone: "danger",
      title: "La firma electrónica no está disponible",
      detail: `Hay que volver a cargarla para emitir.${renew ? "" : askAdmin}`,
      ...renew,
    });
  } else if (certificate?.state === "EXPIRING" && certificate.notAfter) {
    notices.push({
      id: "firma-por-vencer",
      tone: "warning",
      title: "La firma electrónica vence pronto",
      detail: `Vence el ${formatDate(certificate.notAfter)} (${daysPhrase(certificate.daysToExpiry ?? 0)}).${renew ? "" : askAdmin}`,
      ...renew,
    });
  }

  // La firma vencida o sin clave ya tiene su aviso: no se repite entre los requisitos.
  const pending = (status.data?.readiness.checks ?? []).filter(
    (check) =>
      check.status === "PENDING" && !(certificateBlocks && check.key === "SIGNING_CERTIFICATE"),
  );
  if (status.data && !status.data.readiness.ready && pending.length > 0) {
    const first = READINESS_COPY[pending[0]!.key].action;
    notices.push({
      id: "no-puede-emitir",
      tone: "danger",
      title: "Tu empresa todavía no puede emitir",
      detail: `Falta: ${pending.map((check) => READINESS_COPY[check.key].title.toLowerCase()).join(", ")}.${
        first && can(first.href) ? "" : " Pide a un administrador que complete la configuración."
      }`,
      ...(first && can(first.href) ? { action: first } : {}),
    });
  }

  const summary = dashboard.data;
  if (summary) {
    const archive = can("/comprobantes")
      ? { action: { href: "/comprobantes", label: "Revisar comprobantes" } }
      : {};
    if (summary.attention.count > 0) {
      notices.push({
        id: "atencion",
        tone: "warning",
        title: `${count(summary.attention.count, "comprobante requiere", "comprobantes requieren")} atención`,
        detail: "Resultado incierto con el SRI, revisión manual o transmisión detenida.",
        ...archive,
      });
    }
    if (summary.attention.rejectedLast30Days > 0) {
      notices.push({
        id: "rechazados",
        tone: "warning",
        title: `${count(summary.attention.rejectedLast30Days, "comprobante devuelto", "comprobantes devueltos")} o no autorizados`,
        detail: "En los últimos 30 días. Revisa el motivo antes de volver a emitir.",
        ...archive,
      });
    }
    if (summary.inventory.outOfStock > 0) {
      notices.push({
        id: "agotados",
        tone: "warning",
        title: `${count(summary.inventory.outOfStock, "producto agotado", "productos agotados")}`,
        detail: "Su saldo en inventario llegó a cero.",
        ...(can("/inventario")
          ? { action: { href: "/inventario", label: "Ir a Inventario" } }
          : {}),
      });
    }
  }
  return notices.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === "danger" ? -1 : 1));
}

function NoticeItem({ notice, onNavigate }: { notice: Notice; onNavigate: () => void }) {
  const Icon = notice.tone === "danger" ? CircleAlert : TriangleAlert;
  return (
    <li data-tone={notice.tone} className="flex gap-3 py-3 first:pt-0 last:pb-0">
      <Icon
        aria-hidden="true"
        className={cn(
          "mt-0.5 size-4 shrink-0",
          notice.tone === "danger" ? "text-danger" : "text-warning",
        )}
      />
      <div className="flex min-w-0 flex-col gap-1">
        <span className="font-medium">{notice.title}</span>
        <span className="text-xs text-foreground-muted">{notice.detail}</span>
        {notice.action && (
          <Link
            href={notice.action.href}
            onClick={onNavigate}
            className="self-start text-xs font-medium text-primary hover:underline max-md:inline-flex max-md:min-h-11 max-md:items-center"
          >
            {notice.action.label}
          </Link>
        )}
      </div>
    </li>
  );
}

/** La campana de la barra superior: el número de avisos y su lista. */
export function NotificationsMenu({ className }: { className?: string }) {
  const notices = useNotices();
  const [open, setOpen] = useState(false);
  const pending = notices.length;
  const label =
    pending === 0
      ? "Avisos: ninguno pendiente"
      : `Avisos: ${count(pending, "pendiente", "pendientes")}`;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={label}
              className={cn("relative", className)}
            >
              <Bell aria-hidden="true" />
              {pending > 0 && (
                <span
                  aria-hidden="true"
                  data-slot="notifications-count"
                  // Siempre en verde (decisión del propietario, 2026-10-22); los que impiden emitir
                  // siguen primero en la lista, con su tono.
                  className="absolute -top-1 -right-1 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-success px-1 text-[0.6875rem] leading-none font-semibold text-success-foreground tabular-nums ring-2 ring-background"
                >
                  {pending > 9 ? "9+" : pending}
                </span>
              )}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">Avisos</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-1.5rem)] gap-3 p-4">
        <h2 className="text-sm font-semibold">Avisos</h2>
        {pending === 0 ? (
          <p className="flex items-center gap-2 text-sm text-foreground-muted">
            <CircleCheck aria-hidden="true" className="size-4 shrink-0 text-success" />
            Todo en orden: no hay avisos pendientes.
          </p>
        ) : (
          <ul aria-label="Avisos pendientes" className="flex flex-col divide-y divide-border">
            {notices.map((notice) => (
              <NoticeItem key={notice.id} notice={notice} onNavigate={() => setOpen(false)} />
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
