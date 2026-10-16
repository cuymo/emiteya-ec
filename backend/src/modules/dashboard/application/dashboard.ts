// Tablero de Inicio (decisión del propietario, 2026-10-16): un resumen de solo lectura de la
// actividad de la empresa en su ambiente vigente. Lo ve quien puede consultar facturas; cada cifra
// sale de la lectura de su módulo dueño, en el ambiente que resuelve el servidor.
import type { DashboardView } from "@facturador/contracts";
import type { DbClient } from "../../../platform/db/database.ts";
import type { Authorizer } from "../../identity/application/authorization.ts";
import type { RequestContext } from "../../identity/application/request-context.ts";
import type { DashboardSources } from "./ports.ts";

export type DashboardDependencies = Readonly<{
  db: DbClient;
  sources: DashboardSources;
  authorizer: Authorizer;
  /** Hoy en Ecuador (`YYYY-MM-DD`). */
  today: () => string;
}>;

/** Primer día del mes de una fecha `YYYY-MM-DD`. */
const monthStart = (date: string) => `${date.slice(0, 7)}-01`;

export function createDashboard({ db, sources, authorizer, today }: DashboardDependencies) {
  return {
    async summary(ctx: RequestContext): Promise<DashboardView> {
      authorizer.requirePermission(ctx, "invoices.read");
      const date = today();
      const environment = await sources.currentEnvironment(db, ctx.companyId);
      const stoppedIds = await sources.stoppedDocumentIds(ctx.companyId);
      const [documents, invoiceDrafts, outOfStock] = await Promise.all([
        sources.documents(db, ctx.companyId, { environment, today: date, stoppedIds }),
        sources.invoiceDrafts(db, ctx.companyId),
        sources.outOfStock(db, ctx.companyId),
      ]);
      const invoices = documents.byType.find((row) => row.documentType === "01");
      const current = documents.monthly.at(-1);
      const previous = documents.monthly.at(-2);
      return {
        environment,
        today: date,
        month: {
          start: monthStart(date),
          invoices: {
            authorizedTotal: current?.authorizedTotal ?? "0",
            authorizedCount: current?.authorizedCount ?? 0,
            issuedCount: invoices?.issued ?? 0,
            previousAuthorizedTotal: previous?.authorizedTotal ?? "0",
          },
          byType: [...documents.byType],
        },
        monthly: [...documents.monthly],
        attention: {
          count: documents.attention,
          rejectedLast30Days: documents.rejectedLast30Days,
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
