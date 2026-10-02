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
  | "users.setPassword";

const VISIBLE: Record<Role, ReadonlySet<Permission>> = {
  ADMIN: new Set<Permission>([
    "account.read",
    "account.changePassword",
    "users.read",
    "users.create",
    "users.changeRole",
    "users.changeStatus",
    "users.setPassword",
  ]),
  OPERATOR: new Set<Permission>(["account.read", "account.changePassword"]),
};

export function canSee(role: Role | undefined, permission: Permission): boolean {
  return role !== undefined && VISIBLE[role].has(permission);
}

export const ROLE_LABELS: Record<Role, string> = { ADMIN: "Administrador", OPERATOR: "Operador" };
