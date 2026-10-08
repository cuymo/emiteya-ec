// Fuente de portabilidad de los usuarios (add-data-portability, design D5): los miembros de la
// empresa como metadatos de la organización, con su nombre, su correo, su rol y su estado. Nunca lee
// las tablas internas de Better Auth (`account`, `session`, `verification`, `invitation`) ni el hash
// de una contraseña.
import { Prisma } from "../../../generated/prisma/client.ts";
import { qualifiedTable, sqlCompanyBatches } from "../../../platform/db/report-source.ts";

export function createIdentityPortabilitySources(schema: string) {
  const members = qualifiedTable(schema, "member");
  const users = qualifiedTable(schema, "user");
  return {
    users: sqlCompanyBatches({
      query: (companyId) => ({
        select: Prisma.sql`u.id AS user_id, u.name, u.email, m.role, m.status,
          m."createdAt" AS member_since`,
        from: Prisma.sql`${members} m
          JOIN ${users} u ON u.id = m."userId"
          WHERE m."organizationId" = ${companyId}`,
        orderBy: Prisma.sql`u.email, u.id`,
      }),
      map: (raw: {
        user_id: string;
        name: string;
        email: string;
        role: string;
        status: string;
        member_since: Date;
      }) => ({
        userId: raw.user_id,
        name: raw.name,
        email: raw.email,
        role: raw.role,
        status: raw.status,
        memberSince: raw.member_since,
      }),
    }),
  };
}
