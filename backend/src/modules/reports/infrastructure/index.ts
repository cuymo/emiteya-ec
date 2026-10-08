// Ensamblado del módulo de reportes para main.ts y las pruebas (add-reports-export, design D1). Las
// fuentes de datos las compone main.ts desde sus módulos dueños: este módulo no lee tablas.
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import type { AuditLog } from "../../audit/application/audit-log.ts";
import { createAuditLog } from "../../audit/infrastructure/prisma-audit-log.ts";
import type { Authorizer } from "../../identity/application/authorization.ts";
import type {
  ReportSources,
  ReportsObserver,
  TemporaryFiles,
  XlsxWriter,
} from "../application/ports.ts";
import { createReports, type ReportsLimits } from "../application/reports.ts";
import { reportsRouter } from "./http/reports-router.ts";
import { createReportsDatabase } from "./prisma-reports-database.ts";
import { createTemporaryFiles } from "./temporary-files.ts";
import { writeXlsx } from "./xlsx/xlsx-writer.ts";

export { registerReportMetrics } from "./metrics.ts";
export type { ReportSources, ReportsObserver } from "../application/ports.ts";

export type ReportsModuleOptions = Readonly<{
  prisma: PrismaClient;
  authorizer: Authorizer;
  sources: ReportSources;
  limits: ReportsLimits;
  observer: ReportsObserver;
  /** Para las pruebas: el directorio de los temporales, el escritor, la auditoría y el reloj. */
  temporaryFiles?: TemporaryFiles;
  writer?: XlsxWriter;
  audit?: AuditLog;
  now?: () => Date;
}>;

export function reportsModule(options: ReportsModuleOptions) {
  const service = createReports({
    database: createReportsDatabase(options.prisma),
    sources: options.sources,
    authorizer: options.authorizer,
    audit: options.audit ?? createAuditLog(options.prisma),
    writer: options.writer ?? writeXlsx,
    temporaryFiles: options.temporaryFiles ?? createTemporaryFiles(),
    limits: options.limits,
    observer: options.observer,
    ...(options.now ? { now: options.now } : {}),
  });
  return { service, routers: [reportsRouter(service)] };
}

export { createTemporaryFiles } from "./temporary-files.ts";
