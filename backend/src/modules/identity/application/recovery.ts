// Recuperación administrativa de emergencia (design D8). Solo la invoca el comando de servidor
// `admin:recover`; ninguna ruta HTTP la importa ni la expone.
import type { UnitOfWork } from "./unit-of-work.ts";

export type RecoveryFailure = "account_not_found" | "not_an_administrator";

export class RecoveryError extends Error {
  readonly reason: RecoveryFailure;

  constructor(reason: RecoveryFailure) {
    super(
      reason === "account_not_found"
        ? "No existe una cuenta con ese correo."
        : "La cuenta no tiene rol Administrador en ninguna empresa.",
    );
    this.name = "RecoveryError";
    this.reason = reason;
  }
}

export type RecoveryResult = Readonly<{
  userId: string;
  companyIds: string[];
  reactivated: boolean;
}>;

export async function recoverAdministrator(
  uow: UnitOfWork,
  input: { email: string; password: string; correlationId: string },
): Promise<RecoveryResult> {
  return uow.run(async ({ identity, memberships, companies, audit }) => {
    const userId = await identity.findUserIdByEmail(input.email);
    if (!userId) throw new RecoveryError("account_not_found");

    const adminships = [];
    for (const companyId of await companies.listIds()) {
      const membership = await memberships.findInCompany(companyId, userId);
      if (membership?.role === "ADMIN") adminships.push(membership);
    }
    if (adminships.length === 0) throw new RecoveryError("not_an_administrator");

    // Contraseña nueva y revocación de todas las sesiones (D6).
    await identity.setPassword(userId, input.password);
    let reactivated = false;
    for (const membership of adminships) {
      const wasDeactivated = membership.status === "DEACTIVATED";
      if (wasDeactivated) {
        await identity.updateMembership(membership.companyId, userId, { status: "ACTIVE" });
        reactivated = true;
      }
      await audit.append({
        companyId: membership.companyId,
        actor: { type: "TECHNICAL_ADMIN" },
        action: "user.recovered",
        targetUserId: userId,
        changes: { reactivated: wasDeactivated },
        correlationId: input.correlationId,
      });
    }
    return { userId, companyIds: adminships.map((m) => m.companyId), reactivated };
  });
}
