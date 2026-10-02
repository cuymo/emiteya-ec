// Preparación para emitir (design D9, ERS AC-01, BR-03): una lista de requisitos cumplidos o
// pendientes. La empresa está preparada solo si todos se cumplen. El ambiente no es un requisito:
// siempre está definido, Pruebas por defecto.

export const READINESS_CHECKS = ["TAXPAYER_DATA", "EMISSION_POINT", "SIGNING_CERTIFICATE"] as const;
export type ReadinessCheck = (typeof READINESS_CHECKS)[number];
export type ReadinessStatus = "MET" | "PENDING";

export type ReadinessFacts = Readonly<Record<ReadinessCheck, boolean>>;

export type Readiness = Readonly<{
  ready: boolean;
  checks: readonly Readonly<{ key: ReadinessCheck; status: ReadinessStatus }>[];
}>;

export function evaluateReadiness(facts: ReadinessFacts): Readiness {
  const checks = READINESS_CHECKS.map((key) => ({
    key,
    status: facts[key] ? ("MET" as const) : ("PENDING" as const),
  }));
  return { ready: checks.every((check) => check.status === "MET"), checks };
}
