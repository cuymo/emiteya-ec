// Guarda de destino no permitido (adopt-premium-design-foundation-and-shell, design D11; spec
// web-application-shell, «Destino no permitido»). Resuelve la ruta en el modelo canónico y, si el rol
// de la sesión no tiene su permiso, muestra el estado sin acceso en lugar de la pantalla. La decisión es
// síncrona: el shell solo se renderiza con la sesión cargada, así que el contenido protegido nunca se
// monta ni pide sus datos. Es presentación: la pantalla conserva su comprobación y la API manda.
"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { RouteForbidden } from "@/components/route-states/route-states";
import { useSession } from "@/components/session";
import { canSee } from "@/lib/permissions";
import { resolveRoute } from "@/lib/navigation/routes";

export function RouteGuard({ children }: { children: ReactNode }) {
  const { me } = useSession();
  const permission = resolveRoute(usePathname())?.permission;
  if (permission && !canSee(me.role, permission)) return <RouteForbidden />;
  return children;
}
