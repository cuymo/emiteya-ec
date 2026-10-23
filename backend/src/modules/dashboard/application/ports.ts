// Puertos del tablero de Inicio. Las lecturas las exportan los módulos dueños y las compone main.ts:
// `dashboard` nunca lee tablas.
import type { DashboardView, Environment } from "@facturador/contracts";
import type { DbClient } from "../../../platform/db/database.ts";

export type DocumentSummaryQuery = Readonly<{
  environment: Environment;
  /** Hoy en Ecuador (`YYYY-MM-DD`). */
  today: string;
  /** Comprobantes con la transmisión detenida: requieren atención aunque su estado no lo diga. */
  stoppedIds: readonly string[];
}>;

/** Lo que el resumen de los comprobantes aporta al tablero. */
export type DocumentSummary = Readonly<{
  monthly: readonly DashboardView["monthly"][number][];
  byType: readonly DashboardView["month"]["byType"][number][];
  attention: number;
  rejectedLast30Days: number;
  topCustomers: readonly DashboardView["topCustomers"][number][];
  topProducts: readonly DashboardView["topProducts"][number][];
  recent: readonly DashboardView["recent"][number][];
}>;

export type DashboardSources = Readonly<{
  currentEnvironment(db: DbClient, companyId: string): Promise<Environment>;
  /** Comprobantes con la transmisión al SRI detenida. */
  stoppedDocumentIds(companyId: string): Promise<readonly string[]>;
  documents(db: DbClient, companyId: string, query: DocumentSummaryQuery): Promise<DocumentSummary>;
  invoiceDrafts(db: DbClient, companyId: string): Promise<number>;
  outOfStock(db: DbClient, companyId: string): Promise<number>;
  /** Autorizados del ambiente con su último envío por correo fallido (add-email-delivery). */
  emailFailed(companyId: string, environment: Environment): Promise<number>;
}>;
