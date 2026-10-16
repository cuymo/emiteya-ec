// Configuración en una sola página con pestañas: cada sección conserva su dirección.
import type { ReactNode } from "react";
import { ConfigurationLayout } from "@/features/configuration/configuration-layout";

export default function ConfigurationRouteLayout({ children }: { children: ReactNode }) {
  return <ConfigurationLayout>{children}</ConfigurationLayout>;
}
