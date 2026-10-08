// Fuentes de portabilidad del contribuyente (add-data-portability, design D1 y D4): cada versión
// de la configuración con su vigencia, los logos que referencian con lo que los verifica, los
// establecimientos, los puntos y el punto predeterminado de cada membresía, en todos sus estados.
// Solo las columnas permitidas; la lectura de un logo por identificador sirve a la fase 2.
import type { DbClient } from "../../../platform/db/database.ts";
import { Prisma } from "../../../generated/prisma/client.ts";
import { qualifiedTable, sqlCompanyBatches } from "../../../platform/db/report-source.ts";

type Environment = "TEST" | "PRODUCTION";

type VersionRaw = {
  version: number;
  current: boolean;
  created_at: Date;
  ruc: string;
  legal_name: string;
  trade_name: string | null;
  head_office_address: string;
  phone: string | null;
  email: string | null;
  accounting_required: boolean;
  special_taxpayer_number: string | null;
  withholding_agent_resolution: string | null;
  large_taxpayer: boolean;
  rimpe_category: string | null;
  provider_ruc: string | null;
  environment: string;
  logo_asset_id: string | null;
};

export function createTaxpayerPortabilitySources(schema: string) {
  const versions = qualifiedTable(schema, "company_config_version");
  const config = qualifiedTable(schema, "company_config");
  const assets = qualifiedTable(schema, "configuration_asset");
  const establishments = qualifiedTable(schema, "establishment");
  const points = qualifiedTable(schema, "emission_point");
  const defaults = qualifiedTable(schema, "member_default_emission_point");
  return {
    configVersions: sqlCompanyBatches({
      query: (companyId) => ({
        select: Prisma.sql`v.version, (c.current_version_id = v.id) AS current, v.created_at,
          v.ruc, v.legal_name, v.trade_name, v.head_office_address, v.phone, v.email,
          v.accounting_required, v.special_taxpayer_number, v.withholding_agent_resolution,
          v.large_taxpayer, v.rimpe_category, v.provider_ruc, v.environment, v.logo_asset_id`,
        from: Prisma.sql`${versions} v
          LEFT JOIN ${config} c ON c.company_id = v.company_id
          WHERE v.company_id = ${companyId}`,
        orderBy: Prisma.sql`v.version`,
      }),
      map: (raw: VersionRaw) => ({
        version: raw.version,
        current: raw.current === true,
        createdAt: raw.created_at,
        ruc: raw.ruc,
        legalName: raw.legal_name,
        tradeName: raw.trade_name,
        headOfficeAddress: raw.head_office_address,
        phone: raw.phone,
        email: raw.email,
        accountingRequired: raw.accounting_required,
        specialTaxpayerNumber: raw.special_taxpayer_number,
        withholdingAgentResolution: raw.withholding_agent_resolution,
        largeTaxpayer: raw.large_taxpayer,
        rimpeCategory: raw.rimpe_category,
        providerRuc: raw.provider_ruc,
        environment: raw.environment as Environment,
        logoAssetId: raw.logo_asset_id,
      }),
    }),
    logos: sqlCompanyBatches({
      query: (companyId) => ({
        select: Prisma.sql`a.id, a.mime_type, a.size_bytes, a.sha256`,
        from: Prisma.sql`${assets} a WHERE a.company_id = ${companyId} AND a.kind = 'LOGO'`,
        orderBy: Prisma.sql`a.sha256, a.id`,
      }),
      map: (raw: { id: string; mime_type: string; size_bytes: number; sha256: string }) => ({
        assetId: raw.id,
        mimeType: raw.mime_type,
        sizeBytes: raw.size_bytes,
        sha256: raw.sha256,
      }),
    }),
    establishments: sqlCompanyBatches({
      query: (companyId) => ({
        select: Prisma.sql`e.id, e.code, e.address, e.active, e.created_at`,
        from: Prisma.sql`${establishments} e WHERE e.company_id = ${companyId}`,
        orderBy: Prisma.sql`e.code, e.id`,
      }),
      map: (raw: {
        id: string;
        code: string;
        address: string;
        active: boolean;
        created_at: Date;
      }) => ({
        id: raw.id,
        code: raw.code,
        address: raw.address,
        active: raw.active,
        createdAt: raw.created_at,
      }),
    }),
    emissionPoints: sqlCompanyBatches({
      query: (companyId) => ({
        select: Prisma.sql`p.id, p.establishment_id, p.code, p.active, p.created_at`,
        from: Prisma.sql`${points} p WHERE p.company_id = ${companyId}`,
        orderBy: Prisma.sql`p.establishment_id, p.code, p.id`,
      }),
      map: (raw: {
        id: string;
        establishment_id: string;
        code: string;
        active: boolean;
        created_at: Date;
      }) => ({
        id: raw.id,
        establishmentId: raw.establishment_id,
        code: raw.code,
        active: raw.active,
        createdAt: raw.created_at,
      }),
    }),
    defaultEmissionPoints: sqlCompanyBatches({
      query: (companyId) => ({
        select: Prisma.sql`d.user_id, d.emission_point_id`,
        from: Prisma.sql`${defaults} d WHERE d.company_id = ${companyId}`,
        orderBy: Prisma.sql`d.user_id`,
      }),
      map: (raw: { user_id: string; emission_point_id: string }) => ({
        userId: raw.user_id,
        emissionPointId: raw.emission_point_id,
      }),
    }),
    /** Los bytes de un logo de la empresa con su tamaño y su SHA-256 conservados. */
    async readLogo(db: DbClient, companyId: string, assetId: string) {
      const asset = await db.configurationAsset.findFirst({
        where: { companyId, id: assetId },
        select: { content: true, sizeBytes: true, sha256: true },
      });
      return asset
        ? { content: asset.content, sizeBytes: asset.sizeBytes, sha256: asset.sha256 }
        : null;
    },
  };
}
