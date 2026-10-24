// Ensamblado del tablero de Inicio para main.ts y las pruebas. Las lecturas las componen main.ts
// desde sus módulos dueños: este módulo no lee tablas.
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import type { Authorizer } from "../../identity/application/authorization.ts";
import { ecuadorDate } from "../../catalogs/infrastructure/index.ts";
import { createDashboard } from "../application/dashboard.ts";
import type { DashboardSources } from "../application/ports.ts";
import { dashboardRouter } from "./http/dashboard-router.ts";

export type { DashboardSources } from "../application/ports.ts";

export type DashboardModuleOptions = Readonly<{
  prisma: PrismaClient;
  authorizer: Authorizer;
  sources: DashboardSources;
  /** `SRI_TRANSMISSION_ENABLED` del despliegue. */
  sriTransmissionEnabled: boolean;
  /** Para las pruebas: el reloj. */
  now?: () => Date;
}>;

export function dashboardModule({
  prisma,
  authorizer,
  sources,
  sriTransmissionEnabled,
  now,
}: DashboardModuleOptions) {
  const clock = now ?? (() => new Date());
  const service = createDashboard({
    db: prisma,
    sources,
    authorizer,
    today: () => ecuadorDate(clock()),
    sriTransmissionEnabled,
  });
  return { service, routers: [dashboardRouter(service)] };
}

export { dashboardRouter } from "./http/dashboard-router.ts";
