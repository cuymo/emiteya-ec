// Casos de uso del logo (ADR 0017, design D5 y D11). Cargar o reemplazar guarda un asset inmutable
// y crea una versión que lo referencia; eliminar crea una versión sin logo. Las versiones
// anteriores conservan su logo. El formato y las dimensiones se reconocen por el contenido.
import { logoQuerySchema } from "@facturador/contracts";
import { parseInput, type Authorizer } from "../../identity/application/authorization.ts";
import type { RequestContext } from "../../identity/application/request-context.ts";
import { inspectLogo, type LogoMimeType } from "../domain/logo.ts";
import { logoChanges, type LogoRef } from "../domain/taxpayer-config.ts";
import { invalidLogo, logoNotFound, logoTooLarge, taxpayerNotConfigured } from "./errors.ts";
import type {
  CompanyConfigRepository,
  ConfigurationAssetStore,
  StoredConfig,
  TaxpayerUnitOfWork,
} from "./ports.ts";
import { applyDesiredConfig } from "./taxpayer-configuration.ts";

export type TaxpayerLogoDependencies = {
  uow: TaxpayerUnitOfWork;
  configs: Pick<CompanyConfigRepository, "findCurrent">;
  assets: Pick<ConfigurationAssetStore, "read">;
  authorizer: Authorizer;
  logoMaxBytes: number;
};

export function createTaxpayerLogo({
  uow,
  configs,
  assets,
  authorizer,
  logoMaxBytes,
}: TaxpayerLogoDependencies) {
  return {
    /** Bytes del logo vigente de la empresa del contexto; nunca de otra. */
    async readLogo(ctx: RequestContext): Promise<LogoRef & { content: Uint8Array }> {
      authorizer.requirePermission(ctx, "taxpayer.read");
      const logo = (await configs.findCurrent(ctx.companyId))?.config.logo;
      const asset = logo ? await assets.read(ctx.companyId, logo.assetId) : null;
      if (!asset) throw logoNotFound();
      return asset;
    },

    async replaceLogo(
      ctx: RequestContext,
      query: unknown,
      content: Uint8Array,
    ): Promise<StoredConfig> {
      authorizer.requirePermission(ctx, "taxpayer.configure");
      const { expectedVersion } = parseInput(logoQuerySchema, query);
      if (content.byteLength > logoMaxBytes) throw logoTooLarge(logoMaxBytes);
      const inspection = inspectLogo(content);
      if (!inspection.ok) throw invalidLogo(inspection.reason);
      const mimeType: LogoMimeType = inspection.mimeType;
      return uow.run(async (scope) => {
        await scope.lockConfiguration(ctx.companyId);
        const current = await scope.configs.findCurrent(ctx.companyId);
        if (!current) throw taxpayerNotConfigured();
        const logo = await scope.assets.save(ctx.companyId, {
          kind: "LOGO",
          mimeType,
          content,
          createdBy: ctx.userId,
        });
        return applyDesiredConfig(scope, ctx, {
          current,
          desired: { ...current.config, logo },
          expectedVersion,
          action: "taxpayer.logo_replaced",
          changes: logoChanges(current.config.logo, logo),
        });
      });
    },

    async removeLogo(ctx: RequestContext, query: unknown): Promise<StoredConfig> {
      authorizer.requirePermission(ctx, "taxpayer.configure");
      const { expectedVersion } = parseInput(logoQuerySchema, query);
      return uow.run(async (scope) => {
        await scope.lockConfiguration(ctx.companyId);
        const current = await scope.configs.findCurrent(ctx.companyId);
        if (!current) throw taxpayerNotConfigured();
        return applyDesiredConfig(scope, ctx, {
          current,
          desired: { ...current.config, logo: null },
          expectedVersion,
          action: "taxpayer.logo_removed",
          changes: logoChanges(current.config.logo, null),
        });
      });
    },
  };
}

export type TaxpayerLogo = ReturnType<typeof createTaxpayerLogo>;
