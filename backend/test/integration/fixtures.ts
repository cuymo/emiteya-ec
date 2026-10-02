// Datos de prueba insertados directamente. Solo las pruebas escriben así en las tablas de Better
// Auth; el código de aplicación lo hace a través de Better Auth (design D11).
import { randomUUID } from "node:crypto";
import type { DbClient } from "../../src/platform/db/database.ts";

export async function insertCompany(db: DbClient, name: string): Promise<string> {
  const id = randomUUID();
  await db.organization.create({
    data: {
      id,
      name,
      slug: `${name.toLowerCase().replace(/\W+/g, "-")}-${id.slice(0, 8)}`,
      createdAt: new Date(),
    },
  });
  return id;
}

export type InsertedMember = { userId: string; email: string; name: string };

export async function insertMember(
  db: DbClient,
  companyId: string,
  member: { name: string; email?: string; role?: string; status?: string },
): Promise<InsertedMember> {
  const userId = randomUUID();
  const email = member.email ?? `${userId.slice(0, 8)}@example.com`;
  await db.user.create({ data: { id: userId, name: member.name, email } });
  await db.member.create({
    data: {
      id: randomUUID(),
      organizationId: companyId,
      userId,
      role: member.role ?? "OPERATOR",
      status: member.status ?? "ACTIVE",
      createdAt: new Date(),
    },
  });
  return { userId, email, name: member.name };
}
