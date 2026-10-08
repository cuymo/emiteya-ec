// Fuente de portabilidad de los terceros (add-data-portability, design D4): todos los terceros de
// la empresa, en todos sus estados y con sus datos vigentes, incluido el consumidor final del
// sistema. La historia fiscal sale de lo que congeló cada comprobante, nunca de aquí.
import { Prisma } from "../../../generated/prisma/client.ts";
import { qualifiedTable, sqlCompanyBatches } from "../../../platform/db/report-source.ts";

export function createPartiesPortabilitySources(schema: string) {
  const parties = qualifiedTable(schema, "party");
  return {
    parties: sqlCompanyBatches({
      query: (companyId) => ({
        select: Prisma.sql`p.identification_type, p.identification, p.legal_name, p.address,
          p.email, p.phone, p.roles, p.status, p.system_record, p.created_at, p.updated_at`,
        from: Prisma.sql`${parties} p WHERE p.company_id = ${companyId}`,
        orderBy: Prisma.sql`p.search_name, p.id`,
      }),
      map: (raw: {
        identification_type: string;
        identification: string;
        legal_name: string;
        address: string | null;
        email: string | null;
        phone: string | null;
        roles: string[];
        status: string;
        system_record: string | null;
        created_at: Date;
        updated_at: Date;
      }) => ({
        identificationType: raw.identification_type,
        identification: raw.identification,
        legalName: raw.legal_name,
        address: raw.address,
        email: raw.email,
        phone: raw.phone,
        roles: raw.roles,
        status: raw.status,
        systemRecord: raw.system_record,
        createdAt: raw.created_at,
        updatedAt: raw.updated_at,
      }),
    }),
  };
}
