// Política de autorización central (design D4): un mapa de rol a permisos, denegado por defecto.
// Los cambios futuros añaden aquí sus permisos; ninguno se concede por omisión.
import { isRole, type Role } from "./roles.ts";

export const PERMISSIONS = [
  "account.read",
  "account.changePassword",
  "users.read",
  "users.create",
  "users.changeRole",
  "users.changeStatus",
  "users.setPassword",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const POLICY: Readonly<Record<Role, ReadonlySet<string>>> = {
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

/** true solo si el rol existe y el permiso está concedido explícitamente. */
export function can(role: unknown, permission: unknown): boolean {
  return isRole(role) && typeof permission === "string" && POLICY[role].has(permission);
}
