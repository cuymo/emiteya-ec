// Roles y estados de la membresía de un usuario en una empresa (ADR 0009, design D1).

export const ROLES = ["ADMIN", "OPERATOR"] as const;
export type Role = (typeof ROLES)[number];

export const MEMBERSHIP_STATUSES = ["ACTIVE", "DEACTIVATED"] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function isMembershipStatus(value: unknown): value is MembershipStatus {
  return typeof value === "string" && (MEMBERSHIP_STATUSES as readonly string[]).includes(value);
}
