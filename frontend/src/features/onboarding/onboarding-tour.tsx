// Recorrido de bienvenida en el shell (add-onboarding-tour, design D2 y D3): se abre solo la primera
// vez que el usuario llega a Inicio en este navegador, cuando el tablero ya mostró sus indicadores o
// sus requisitos, y se repite desde «Ver recorrido» en el menú de la cuenta. Un enlace directo a otra
// pantalla no lo abre.
"use client";

import "driver.js/dist/driver.css";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { useSession } from "@/components/session";
import { permissionsOf } from "@/lib/navigation/routes";
import { prefersReducedMotion } from "@/lib/navigation/reveal";
import { createTour, type Tour } from "./tour-runner";
import { anchor, tourSegments } from "./tour-steps";
import { markTourSeen, tourSeen } from "./tour-storage";

const TourContext = createContext<{ start: () => void } | null>(null);

/** Abre el recorrido desde el principio; fuera del shell, no hace nada. */
export function useOnboardingTour(): { start: () => void } {
  return useContext(TourContext) ?? { start: () => {} };
}

/** El tablero ya cargó: muestra sus indicadores o, si la empresa no puede emitir, sus requisitos. */
const dashboardShown = () =>
  document.querySelector(`${anchor("inicio-indicadores")}, ${anchor("inicio-requisitos")}`) !==
  null;

export function OnboardingTourProvider({ children }: { children: ReactNode }) {
  const { me } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const path = useRef(pathname);
  const tour = useRef<Tour | null>(null);
  const autoStarted = useRef(false);

  useEffect(() => {
    path.current = pathname;
  }, [pathname]);

  const start = useCallback(() => {
    tour.current?.stop();
    tour.current = createTour({
      segments: tourSegments(permissionsOf(me.role)),
      currentPath: () => path.current,
      navigate: (target) => router.push(target),
      onFinish: () => markTourSeen(me.email),
      reducedMotion: prefersReducedMotion(),
    });
    tour.current.start();
  }, [me.email, me.role, router]);

  useEffect(() => {
    if (pathname !== "/" || autoStarted.current || tourSeen(me.email)) return;
    const begin = () => {
      if (autoStarted.current) return;
      autoStarted.current = true;
      start();
    };
    if (dashboardShown()) {
      begin();
      return;
    }
    const observer = new MutationObserver(() => {
      if (!dashboardShown()) return;
      observer.disconnect();
      begin();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [pathname, me.email, start]);

  useEffect(() => () => tour.current?.stop(), []);

  const value = useMemo(() => ({ start }), [start]);
  return <TourContext.Provider value={value}>{children}</TourContext.Provider>;
}
