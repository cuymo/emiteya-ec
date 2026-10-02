// Puertos del módulo taxpayer (design D1). La infraestructura los implementa con Prisma; los casos
// de uso solo ven datos del dominio y el contexto de la petición.
import type { AuditLog } from "../../audit/application/audit-log.ts";
import type { TaxpayerConfig } from "../domain/taxpayer-config.ts";

/** Configuración vigente de una empresa con su número de versión y el estado de su identidad. */
export type StoredConfig = Readonly<{
  versionId: string;
  version: number;
  config: TaxpayerConfig;
  taxIdentityLocked: boolean;
  createdAt: Date;
}>;

export interface CompanyConfigRepository {
  /** La versión vigente, o null si la empresa aún no registró sus datos. */
  findCurrent(companyId: string): Promise<StoredConfig | null>;
  /** Inserta la versión `version` y la deja como vigente (design D2). */
  appendVersion(
    companyId: string,
    input: { version: number; config: TaxpayerConfig; createdBy: string },
  ): Promise<StoredConfig>;
  /** Bloquea la identidad con el RUC vigente; false si ya estaba bloqueada (design D4). */
  lockTaxIdentity(companyId: string, at: Date): Promise<boolean>;
}

export type TaxpayerScope = {
  configs: CompanyConfigRepository;
  audit: AuditLog;
  /** Serializa las escrituras de configuración de la empresa en la transacción (design D2). */
  lockConfiguration(companyId: string): Promise<void>;
};

/** Ejecuta el trabajo en una transacción: el cambio y su evento se confirman o revierten juntos. */
export interface TaxpayerUnitOfWork {
  run<T>(work: (scope: TaxpayerScope) => Promise<T>): Promise<T>;
}
