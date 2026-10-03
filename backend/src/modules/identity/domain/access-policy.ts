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
  "account.setDefaultEmissionPoint",
  "taxpayer.read",
  "taxpayer.configure",
  "environment.change",
  "establishments.read",
  "establishments.manage",
  "readiness.read",
  "sequences.read",
  "sequences.adjust",
  "certificate.read",
  "certificate.manage",
  "certificateValidity.read",
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
    "account.setDefaultEmissionPoint",
    "taxpayer.read",
    "taxpayer.configure",
    "environment.change",
    "establishments.read",
    "establishments.manage",
    "readiness.read",
    "sequences.read",
    "sequences.adjust",
    // add-signing-certificate, design D10.
    "certificate.read",
    "certificate.manage",
    "certificateValidity.read",
  ]),
  // add-taxpayer-setup, design D10: el operador consulta lo necesario para emitir y elegir su
  // punto predeterminado, pero no ve ni cambia la configuración tributaria.
  OPERATOR: new Set<Permission>([
    "account.read",
    "account.changePassword",
    "account.setDefaultEmissionPoint",
    "establishments.read",
    "readiness.read",
    // add-signing-certificate, design D10: solo la vigencia de la firma.
    "certificateValidity.read",
  ]),
};

/** true solo si el rol existe y el permiso está concedido explícitamente. */
export function can(role: unknown, permission: unknown): boolean {
  return isRole(role) && typeof permission === "string" && POLICY[role].has(permission);
}
