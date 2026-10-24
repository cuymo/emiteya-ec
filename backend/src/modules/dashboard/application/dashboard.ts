// Tablero de Inicio (decisión del propietario, 2026-10-16): un resumen de solo lectura de la
// actividad de la empresa en su ambiente vigente. Lo ve quien puede consultar facturas; cada cifra
// sale de la lectura de su módulo dueño, en el ambiente que resuelve el servidor.
import type { DashboardView } from "@facturador/contracts";
import type { DbClient } from "../../../platform/db/database.ts";
import {
  divideRoundHalfUp,
  multiplyExact,
  subtractExact,
} from "../../../platform/decimal/fiscal-decimal.ts";
import type { Authorizer } from "../../identity/application/authorization.ts";
import type { RequestContext } from "../../identity/application/request-context.ts";
import type { DashboardSources } from "./ports.ts";

export type DashboardDependencies = Readonly<{
  db: DbClient;
  sources: DashboardSources;
  authorizer: Authorizer;
  /** Hoy en Ecuador (`YYYY-MM-DD`). */
  today: () => string;
  /** `SRI_TRANSMISSION_ENABLED` del despliegue. */
  sriTransmissionEnabled: boolean;
}>;

/** Primer día del mes de una fecha `YYYY-MM-DD`. */
const monthStart = (date: string) => `${date.slice(0, 7)}-01`;

/**
 * Variación de `current` frente a `previous`, en porcentaje con un decimal redondeado a la mitad
 * hacia arriba y con signo; `null` sin ventas el mes anterior (redesign-dashboard-indicators, D1).
 */
export function changePercent(current: string, previous: string): string | null {
  if (Number(previous) === 0) return null;
  const difference = subtractExact(current, previous);
  const negative = difference.startsWith("-");
  const percent = divideRoundHalfUp(
    multiplyExact(negative ? difference.slice(1) : difference, "100"),
    previous,
    1,
  );
  return negative && percent !== "0.0" ? `-${percent}` : percent;
}

export function createDashboard({
  db,
  sources,
  authorizer,
  today,
  sriTransmissionEnabled,
}: DashboardDependencies) {
  return {
    async summary(ctx: RequestContext): Promise<DashboardView> {
      authorizer.requirePermission(ctx, "invoices.read");
      const date = today();
      const environment = await sources.currentEnvironment(db, ctx.companyId);
      const stoppedIds = await sources.stoppedDocumentIds(ctx.companyId);
      const [documents, invoiceDrafts, outOfStock, emailFailed, emailPending, sriContact] =
        await Promise.all([
          sources.documents(db, ctx.companyId, { environment, today: date, stoppedIds }),
          sources.invoiceDrafts(db, ctx.companyId),
          sources.outOfStock(db, ctx.companyId),
          sources.emailFailed(ctx.companyId, environment),
          sources.emailPending(ctx.companyId, environment),
          sources.sriLastContact(ctx.companyId, environment),
        ]);
      const invoices = documents.byType.find((row) => row.documentType === "01");
      const current = documents.monthly.at(-1);
      const previous = documents.monthly.at(-2);
      const authorizedTotal = current?.authorizedTotal ?? "0";
      const previousAuthorizedTotal = previous?.authorizedTotal ?? "0";
      return {
        environment,
        today: date,
        month: {
          start: monthStart(date),
          invoices: {
            authorizedTotal,
            authorizedCount: current?.authorizedCount ?? 0,
            issuedCount: invoices?.issued ?? 0,
            previousAuthorizedTotal,
            previousChangePercent: changePercent(authorizedTotal, previousAuthorizedTotal),
          },
          byType: [...documents.byType],
        },
        monthly: [...documents.monthly],
        attention: {
          count: documents.attention,
          rejectedLast30Days: documents.rejectedLast30Days,
          emailFailed,
        },
        email: { pending: emailPending },
        sri: {
          transmissionEnabled: sriTransmissionEnabled,
          lastContact: sriContact
            ? { at: sriContact.at.toISOString(), reached: sriContact.reached }
            : null,
        },
        drafts: { invoices: invoiceDrafts },
        inventory: { outOfStock },
        topCustomers: [...documents.topCustomers],
        topProducts: [...documents.topProducts],
        recent: [...documents.recent],
      };
    },
  };
}

export type Dashboard = ReturnType<typeof createDashboard>;
