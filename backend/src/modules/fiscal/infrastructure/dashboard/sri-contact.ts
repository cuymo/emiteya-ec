// La última comunicación guardada con el SRI, para el tablero de Inicio (redesign-dashboard-indicators,
// design D2): se lee de los intentos ya registrados y nunca abre una conexión al SRI.
import type { Environment } from "@facturador/contracts";
import type { DbClient } from "../../../../platform/db/database.ts";

export type SriContact = Readonly<{ at: Date; reached: boolean }>;

/** El último intento de la empresa en el ambiente: si recibió una respuesta HTTP menor que 500. */
export async function sriLastContact(
  db: DbClient,
  companyId: string,
  environment: Environment,
): Promise<SriContact | null> {
  const attempt = await db.sriAttempt.findFirst({
    where: { companyId, environment },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    select: { startedAt: true, transportOutcome: true, httpStatus: true },
  });
  if (!attempt) return null;
  return {
    at: attempt.startedAt,
    reached:
      attempt.transportOutcome === "RESPONSE" &&
      attempt.httpStatus !== null &&
      attempt.httpStatus < 500,
  };
}
