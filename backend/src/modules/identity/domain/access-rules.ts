// Reglas de acceso sin auto-modificación (design D5): nadie cambia su propio rol ni se desactiva
// a sí mismo, y la contraseña propia solo cambia presentando la actual.

export type UserAdministrationAction = "changeRole" | "changeStatus" | "setPassword";

export type SelfChangeViolation = "OWN_ROLE" | "OWN_STATUS" | "OWN_PASSWORD";

const VIOLATIONS: Readonly<Record<UserAdministrationAction, SelfChangeViolation>> = {
  changeRole: "OWN_ROLE",
  changeStatus: "OWN_STATUS",
  setPassword: "OWN_PASSWORD",
};

/** La infracción si el actor intenta la acción sobre su propia cuenta; null si actúa sobre otra. */
export function selfChangeViolation(
  action: UserAdministrationAction,
  actorUserId: string,
  targetUserId: string,
): SelfChangeViolation | null {
  return actorUserId === targetUserId ? VIOLATIONS[action] : null;
}

/** Las operaciones de rol y estado son de estado deseado: sin diferencia no hay cambio ni auditoría. */
export function isNoOp<T>(current: T, desired: T): boolean {
  return current === desired;
}
