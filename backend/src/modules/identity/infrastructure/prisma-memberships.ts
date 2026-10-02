// Lectura de membresías con consultas propias (design D11). Las escrituras sobre `member` pasan por
// Better Auth; este repositorio solo lee, y siempre con la empresa del contexto.
import type { DbClient } from "../../../platform/db/database.ts";
import type { CompanyMember, Membership, MembershipReader } from "../application/memberships.ts";
import { isMembershipStatus, isRole } from "../domain/roles.ts";

type MemberRow = {
  userId: string;
  organizationId: string;
  role: string;
  status: string;
  createdAt: Date;
  user: { name: string; email: string };
};

function toMembership(row: Omit<MemberRow, "user" | "createdAt">): Membership {
  // Los CHECK de la migración garantizan estos valores; un valor ajeno es un error de integridad.
  if (!isRole(row.role) || !isMembershipStatus(row.status)) {
    throw new Error("Membresía con rol o estado fuera del dominio");
  }
  return { userId: row.userId, companyId: row.organizationId, role: row.role, status: row.status };
}

function toCompanyMember(row: MemberRow): CompanyMember {
  return {
    ...toMembership(row),
    name: row.user.name,
    email: row.user.email,
    createdAt: row.createdAt,
  };
}

/** Prisma no escapa los comodines de LIKE en `contains`: la búsqueda los trata como texto. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

const MEMBER_SELECT = {
  userId: true,
  organizationId: true,
  role: true,
  status: true,
  createdAt: true,
  user: { select: { name: true, email: true } },
} as const;

export function createMembershipReader(db: DbClient): MembershipReader {
  return {
    async findActiveForSessionUser(userId) {
      const row = await db.member.findFirst({
        where: { userId, status: "ACTIVE" },
        orderBy: { createdAt: "asc" },
        select: { userId: true, organizationId: true, role: true, status: true },
      });
      return row ? toMembership(row) : null;
    },

    async findInCompany(companyId, userId) {
      const row = await db.member.findUnique({
        where: { organizationId_userId: { organizationId: companyId, userId } },
        select: MEMBER_SELECT,
      });
      return row ? toCompanyMember(row) : null;
    },

    async listInCompany(companyId, query) {
      const trimmed = query.search?.trim();
      const search = trimmed ? escapeLike(trimmed) : undefined;
      const where = {
        organizationId: companyId,
        ...(query.status ? { status: query.status } : {}),
        ...(search
          ? {
              user: {
                OR: [
                  { name: { contains: search, mode: "insensitive" as const } },
                  { email: { contains: search, mode: "insensitive" as const } },
                ],
              },
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        db.member.findMany({
          where,
          select: MEMBER_SELECT,
          orderBy: [{ user: { name: "asc" } }, { user: { email: "asc" } }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        db.member.count({ where }),
      ]);
      return { items: rows.map(toCompanyMember), total };
    },
  };
}
