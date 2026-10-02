// Casos de uso de la configuración tributaria (design D2, D4, D6 y D11). Orden: permiso ->
// validación -> transacción con el lock de configuración -> estado deseado completo -> sin cambio,
// versión desactualizada o RUC bloqueado -> versión nueva y evento en la misma transacción.
import { changeEnvironmentSchema, updateTaxpayerSchema } from "@facturador/contracts";
import type { AuditAction } from "../../audit/domain/audit-event.ts";
import { parseInput, type Authorizer } from "../../identity/application/authorization.ts";
import type { RequestContext } from "../../identity/application/request-context.ts";
import {
  DEFAULT_ENVIRONMENT,
  profileChanges,
  sameConfig,
  type ConfigChanges,
  type TaxpayerConfig,
} from "../domain/taxpayer-config.ts";
import { configVersionConflict, taxIdentityLocked, taxpayerNotConfigured } from "./errors.ts";
import type {
  CompanyConfigRepository,
  StoredConfig,
  TaxpayerScope,
  TaxpayerUnitOfWork,
} from "./ports.ts";

export type TaxpayerConfigurationDependencies = {
  uow: TaxpayerUnitOfWork;
  configs: Pick<CompanyConfigRepository, "findCurrent">;
  authorizer: Authorizer;
};

/**
 * Aplica un estado deseado completo. Si es igual al vigente responde con él sin versión ni evento,
 * aunque `expectedVersion` esté desactualizada: así el reenvío del mismo cambio es idempotente.
 */
export async function applyDesiredConfig(
  scope: TaxpayerScope,
  ctx: RequestContext,
  input: {
    current: StoredConfig | null;
    desired: TaxpayerConfig;
    expectedVersion: number | null;
    action: AuditAction;
    changes: ConfigChanges;
  },
): Promise<StoredConfig> {
  const { current, desired, expectedVersion } = input;
  if (current && sameConfig(current.config, desired)) return current;
  if (current?.taxIdentityLocked && current.config.profile.ruc !== desired.profile.ruc) {
    throw taxIdentityLocked();
  }
  if ((current?.version ?? null) !== expectedVersion) throw configVersionConflict();
  const next = await scope.configs.appendVersion(ctx.companyId, {
    version: (current?.version ?? 0) + 1,
    config: desired,
    createdBy: ctx.userId,
  });
  await scope.audit.append({
    companyId: ctx.companyId,
    actor: { type: "USER", userId: ctx.userId },
    action: input.action,
    changes: { configVersion: next.version, ...input.changes },
    correlationId: ctx.requestId,
  });
  return next;
}

export function createTaxpayerConfiguration({
  uow,
  configs,
  authorizer,
}: TaxpayerConfigurationDependencies) {
  /** Abre la transacción con el lock de la empresa y relee la versión vigente dentro de ella. */
  const withCurrent = <T>(
    ctx: RequestContext,
    work: (scope: TaxpayerScope, current: StoredConfig | null) => Promise<T>,
  ) =>
    uow.run(async (scope) => {
      await scope.lockConfiguration(ctx.companyId);
      return work(scope, await scope.configs.findCurrent(ctx.companyId));
    });

  return {
    async getTaxpayer(ctx: RequestContext): Promise<StoredConfig | null> {
      authorizer.requirePermission(ctx, "taxpayer.read");
      return configs.findCurrent(ctx.companyId);
    },

    /** Registra o corrige el perfil; el ambiente y el logo se conservan (design D6). */
    async updateProfile(ctx: RequestContext, body: unknown): Promise<StoredConfig> {
      authorizer.requirePermission(ctx, "taxpayer.configure");
      const { expectedVersion, ...profile } = parseInput(updateTaxpayerSchema, body);
      return withCurrent(ctx, (scope, current) =>
        applyDesiredConfig(scope, ctx, {
          current,
          desired: {
            profile,
            environment: current?.config.environment ?? DEFAULT_ENVIRONMENT,
            logo: current?.config.logo ?? null,
          },
          expectedVersion,
          action: "taxpayer.configured",
          changes: profileChanges(current?.config.profile ?? null, profile),
        }),
      );
    },

    /** Cambia el ambiente con una operación propia, solo con datos registrados (design D6). */
    async changeEnvironment(ctx: RequestContext, body: unknown): Promise<StoredConfig> {
      authorizer.requirePermission(ctx, "environment.change");
      const { environment, expectedVersion } = parseInput(changeEnvironmentSchema, body);
      return withCurrent(ctx, (scope, current) => {
        if (!current) throw taxpayerNotConfigured();
        return applyDesiredConfig(scope, ctx, {
          current,
          desired: { ...current.config, environment },
          expectedVersion,
          action: "taxpayer.environment_changed",
          changes: {
            "environment.from": current.config.environment,
            "environment.to": environment,
          },
        });
      });
    },
  };
}

export type TaxpayerConfiguration = ReturnType<typeof createTaxpayerConfiguration>;
