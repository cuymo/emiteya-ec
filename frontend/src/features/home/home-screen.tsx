// Inicio: el tablero con la actividad de la empresa para quien consulta facturas, que incluye los
// requisitos para emitir mientras falten; para cualquier otro rol, solo la preparación para emitir.
"use client";

import { useSession } from "@/components/session";
import { canSee } from "@/lib/permissions";
import { DashboardScreen } from "@/features/dashboard/dashboard-screen";
import { ReadinessScreen } from "./readiness-screen";

export function HomeScreen() {
  const { me } = useSession();
  return canSee(me.role, "invoices.read") ? <DashboardScreen /> : <ReadinessScreen />;
}
