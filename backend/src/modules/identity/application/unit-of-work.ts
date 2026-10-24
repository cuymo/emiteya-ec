// Puerto de identidad (design D2b): las operaciones que combinan Better Auth y escrituras propias
// corren en una unidad de trabajo, de modo que identidad, membresía y auditoría se confirman o se
// revierten juntas (D2). Los casos de uso dependen solo de estos tipos.
import type { AuditLog } from "../../audit/application/audit-log.ts";
import type { MembershipStatus, Role } from "../domain/roles.ts";
import type { MembershipReader } from "./memberships.ts";

export interface IdentityWriter {
  /** Crea la identidad con credencial de contraseña. Falla con EmailInUseError si el correo existe. */
  createUser(input: { name: string; email: string; password: string }): Promise<string>;
  findUserIdByEmail(email: string): Promise<string | null>;
  createCompany(input: { name: string; slug: string }): Promise<string>;
  addMembership(input: { companyId: string; userId: string; role: Role }): Promise<void>;
  /** Actualiza la membresía del usuario en esa empresa; falla si no existe. */
  updateMembership(
    companyId: string,
    userId: string,
    change: { role?: Role; status?: MembershipStatus },
  ): Promise<void>;
  /** Reemplaza la contraseña e invalida todas las sesiones del usuario. */
  setPassword(userId: string, password: string): Promise<void>;
  revokeSessions(userId: string): Promise<void>;
  /**
   * Cambia el nombre si sigue siendo `before` (compara y cambia): `false` si otro cambio llegó
   * antes o si ya tenía ese nombre.
   */
  renameUser(userId: string, before: string, name: string): Promise<boolean>;
  /** El nombre actual de la identidad, o null si no existe. */
  findUserName(userId: string): Promise<string | null>;
}

export interface CompanyReader {
  exists(): Promise<boolean>;
  /** Empresas de la instalación, para operaciones de servidor sin contexto de petición. */
  listIds(): Promise<string[]>;
}

export type TransactionScope = Readonly<{
  identity: IdentityWriter;
  audit: AuditLog;
  memberships: MembershipReader;
  companies: CompanyReader;
  /** Bloqueo de PostgreSQL ligado a la transacción, liberado al confirmar o revertir. */
  acquireLock(name: "provisioning"): Promise<void>;
  /**
   * Ejecuta, en esta transacción, los iniciadores que la raíz de composición registró para una
   * empresa nueva: hoy, su consumidor final (add-parties-and-products, design D5). `identity` no
   * conoce a quién pertenecen.
   */
  initializeCompany(companyId: string): Promise<void>;
}>;

export interface UnitOfWork {
  run<T>(work: (scope: TransactionScope) => Promise<T>): Promise<T>;
}

export class EmailInUseError extends Error {
  constructor() {
    super("El correo ya está en uso.");
    this.name = "EmailInUseError";
  }
}

export class PasswordPolicyError extends Error {
  constructor(policy: { minLength: number; maxLength: number }) {
    super(`La contraseña debe tener entre ${policy.minLength} y ${policy.maxLength} caracteres.`);
    this.name = "PasswordPolicyError";
  }
}
