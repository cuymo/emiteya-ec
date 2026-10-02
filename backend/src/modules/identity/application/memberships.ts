// Lectura de membresías (design D3 y D11). Toda consulta sobre usuarios de una empresa exige la
// empresa del contexto; no existe búsqueda de un usuario por identificador sin empresa.
import type { MembershipStatus, Role } from "../domain/roles.ts";

export type Membership = Readonly<{
  userId: string;
  companyId: string;
  role: Role;
  status: MembershipStatus;
}>;

export type CompanyMember = Membership & Readonly<{ name: string; email: string; createdAt: Date }>;

export type MemberListQuery = Readonly<{
  search?: string;
  status?: MembershipStatus;
  page: number;
  pageSize: number;
}>;

export type MemberPage = Readonly<{ items: CompanyMember[]; total: number }>;

export interface MembershipReader {
  /** Solo para resolver el contexto desde la sesión (D3): el userId viene de la sesión, nunca del cliente. */
  findActiveForSessionUser(userId: string): Promise<Membership | null>;
  findInCompany(companyId: string, userId: string): Promise<CompanyMember | null>;
  listInCompany(companyId: string, query: MemberListQuery): Promise<MemberPage>;
}
