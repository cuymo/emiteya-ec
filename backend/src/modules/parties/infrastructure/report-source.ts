// Fuente del reporte de Terceros (add-reports-export, design D1, D2 y D3): los datos vigentes de los
// terceros de la empresa, como la lista de terceros, por rol, identificación y estado (activos por
// defecto). Orden: razón social normalizada e identificador.
import type { PartiesFilters, PartyRole, PartyRow, RecordStatus } from "@facturador/contracts";
import { Prisma } from "../../../generated/prisma/client.ts";
import {
  qualifiedTable,
  sqlReportSource,
  type ReportSource,
} from "../../../platform/db/report-source.ts";

type Raw = {
  id: string;
  identification: string;
  legal_name: string;
  email: string | null;
  phone: string | null;
  roles: string[];
  status: string;
};

export function createPartiesReportSource(schema: string): ReportSource<PartiesFilters, PartyRow> {
  const parties = qualifiedTable(schema, "party");
  return sqlReportSource<PartiesFilters, Raw, PartyRow>({
    query: (companyId, filters) => ({
      select: Prisma.sql`p.id, p.identification, p.legal_name, p.email, p.phone, p.roles, p.status`,
      from: Prisma.sql`${parties} p WHERE ${Prisma.join(
        [
          Prisma.sql`p.company_id = ${companyId}`,
          ...(filters.status !== "ALL" ? [Prisma.sql`p.status = ${filters.status}`] : []),
          ...(filters.role ? [Prisma.sql`${filters.role} = ANY(p.roles)`] : []),
          ...(filters.identification
            ? [Prisma.sql`p.identification = ${filters.identification}`]
            : []),
        ],
        " AND ",
      )}`,
      orderBy: Prisma.sql`p.search_name ASC, p.id ASC`,
    }),
    map: (raw) => ({
      id: raw.id,
      identification: raw.identification,
      legalName: raw.legal_name,
      email: raw.email,
      phone: raw.phone,
      roles: raw.roles as PartyRole[],
      status: raw.status as RecordStatus,
    }),
  });
}
