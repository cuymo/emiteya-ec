// Barra lateral del shell (adopt-premium-design-foundation-and-shell, design D10, D11 y D12; spec
// web-application-shell, «Navegación según permisos», «Destino actual» y «Navegación adaptable»).
// Derivada de `app-sidebar.tsx` y `nav-main.tsx` de la plantilla «Studio Admin» (MIT;
// frontend/THIRD_PARTY_NOTICES.md): los grupos y destinos salen del modelo de rutas canónico y del rol
// de la sesión; sin tarjeta de soporte, Inbox, insignias ni navegación de demostración. En móvil, los
// grupos se pliegan (navigation-responsive.md), con el del destino actual abierto. El destino actual
// se desplaza a la vista de la barra en la carga y en cada cambio de ruta (design D23).
"use client";

import { ChevronDown, Receipt } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { useSession } from "@/components/session";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  permissionsOf,
  resolveRoute,
  visibleGroups,
  type Destination,
  type NavGroup,
} from "@/lib/navigation/routes";
import { prefersReducedMotion, revealWithin } from "@/lib/navigation/reveal";
import { cn } from "@/lib/utils";

function DestinationLink({ destination, active }: { destination: Destination; active: boolean }) {
  const { isMobile, setOpenMobile } = useSidebar();
  const Icon = destination.icon;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={destination.label}>
        <Link
          href={destination.href}
          aria-current={active ? "page" : undefined}
          onClick={() => {
            if (isMobile) setOpenMobile(false);
          }}
        >
          <Icon aria-hidden="true" />
          <span>{destination.label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function GroupMenu({ group, activeHref }: { group: NavGroup; activeHref: string | undefined }) {
  return (
    <SidebarMenu>
      {group.destinations.map((destination) => (
        <DestinationLink
          key={destination.href}
          destination={destination}
          active={destination.href === activeHref}
        />
      ))}
    </SidebarMenu>
  );
}

function NavSection({ group, activeHref }: { group: NavGroup; activeHref: string | undefined }) {
  const { isMobile } = useSidebar();
  const containsActive = group.destinations.some((destination) => destination.href === activeHref);
  // Inicio es un destino suelto, sin etiqueta de grupo.
  if (group.id === "inicio") {
    return (
      <SidebarGroup className="pb-0">
        <SidebarGroupContent>
          <GroupMenu group={group} activeHref={activeHref} />
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }
  if (isMobile) {
    return (
      <Collapsible defaultOpen={containsActive} className="group/collapsible">
        <SidebarGroup className="py-1">
          <SidebarGroupLabel asChild className="h-11 text-sm">
            <CollapsibleTrigger className="flex w-full items-center justify-between">
              {group.label}
              <ChevronDown
                aria-hidden="true"
                className="transition-transform group-data-[state=open]/collapsible:rotate-180"
              />
            </CollapsibleTrigger>
          </SidebarGroupLabel>
          <CollapsibleContent>
            <SidebarGroupContent>
              <GroupMenu group={group} activeHref={activeHref} />
            </SidebarGroupContent>
          </CollapsibleContent>
        </SidebarGroup>
      </Collapsible>
    );
  }
  return (
    <SidebarGroup className={cn(group.section && "mt-auto")}>
      <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <GroupMenu group={group} activeHref={activeHref} />
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

/**
 * Muestra el destino actual si queda fuera del área visible de la barra (design D23): en la carga,
 * sin animación; en los cambios de ruta, suave salvo con movimiento reducido. `revision` cambia cada
 * vez que el destino o la geometría de la barra pueden haber cambiado.
 */
function useActiveDestinationInView(container: RefObject<HTMLDivElement | null>, revision: string) {
  const loaded = useRef(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const area = container.current;
      const active = area?.querySelector<HTMLElement>('[aria-current="page"]');
      if (area && active) {
        revealWithin(
          area,
          active,
          !loaded.current || prefersReducedMotion() ? "instant" : "smooth",
        );
      }
      loaded.current = true;
    });
    return () => cancelAnimationFrame(frame);
  }, [container, revision]);
}

export function AppSidebar({ headerAction }: { headerAction?: ReactNode }) {
  const { me } = useSession();
  const pathname = usePathname();
  const { state, openMobile } = useSidebar();
  const groups = visibleGroups(permissionsOf(me.role));
  const activeHref = resolveRoute(pathname)?.destination.href;
  const content = useRef<HTMLDivElement>(null);
  useActiveDestinationInView(content, `${activeHref}|${state}|${openMobile}`);
  return (
    <Sidebar role="complementary" aria-label="Barra lateral">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="EmiteYa">
              <Link href="/" className="font-semibold">
                <Receipt aria-hidden="true" />
                <span className="text-base">EmiteYa</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        {headerAction}
      </SidebarHeader>
      <SidebarContent ref={content}>
        <nav aria-label="Navegación principal" className="flex min-h-full flex-col">
          {groups.map((group) => (
            <NavSection key={group.id} group={group} activeHref={activeHref} />
          ))}
        </nav>
      </SidebarContent>
    </Sidebar>
  );
}
