// Bloqueo de la identidad tributaria (design D4, Q-31). Operación interna, sin ruta HTTP: ningún
// flujo de este cambio la invoca. add-invoice-emission la llamará dentro de la transacción del hito
// que defina, como máximo al crear el primer artefacto fiscal que deba conservarse. Es idempotente y
// toma el mismo lock que las escrituras de configuración.
import { taxpayerNotConfigured } from "./errors.ts";
import type { TaxpayerScope, TaxpayerUnitOfWork } from "./ports.ts";

/** Bloquea dentro de una transacción ya abierta; true si la bloqueó ahora, false si ya lo estaba. */
export async function lockTaxIdentityIn(
  scope: TaxpayerScope,
  companyId: string,
  now: () => Date = () => new Date(),
): Promise<boolean> {
  await scope.lockConfiguration(companyId);
  const current = await scope.configs.findCurrent(companyId);
  if (!current) throw taxpayerNotConfigured();
  if (current.taxIdentityLocked) return false;
  return scope.configs.lockTaxIdentity(companyId, now());
}

export function createTaxIdentityLock(uow: TaxpayerUnitOfWork) {
  return {
    lock: (companyId: string) => uow.run((scope) => lockTaxIdentityIn(scope, companyId)),
  };
}
