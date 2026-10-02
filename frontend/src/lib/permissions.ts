// Espejo de presentación de la política del servidor (design D4). Solo decide qué se muestra; la
// API vuelve a autorizar cada operación y es la autoridad.
import type { Role } from "@facturador/contracts";

export type Permission =
  | "account.read"
  | "account.changePassword"
  | "users.read"
  | "users.create"
  | "users.changeRole"
  | "users.changeStatus"
  | "users.setPassword"
  | "account.setDefaultEmissionPoint"
  | "taxpayer.read"
  | "taxpayer.configure"
  | "environment.change"
  | "establishments.read"
  | "establishments.manage"
  | "readiness.read"
  | "sequences.read"
  | "sequences.adjust";

const VISIBLE: Record<Role, ReadonlySet<Permission>> = {
  ADMIN: new Set<Permission>([
    "account.read",
    "account.changePassword",
    "users.read",
    "users.create",
    "users.changeRole",
    "users.changeStatus",
    "users.setPassword",
    "account.setDefaultEmissionPoint",
    "taxpayer.read",
    "taxpayer.configure",
    "environment.change",
    "establishments.read",
    "establishments.manage",
    "readiness.read",
    "sequences.read",
    "sequences.adjust",
  ]),
  OPERATOR: new Set<Permission>([
    "account.read",
    "account.changePassword",
    "account.setDefaultEmissionPoint",
    "establishments.read",
    "readiness.read",
  ]),
};

export function canSee(role: Role | undefined, permission: Permission): boolean {
  return role !== undefined && VISIBLE[role].has(permission);
}

export const ROLE_LABELS: Record<Role, string> = { ADMIN: "Administrador", OPERATOR: "Operador" };
