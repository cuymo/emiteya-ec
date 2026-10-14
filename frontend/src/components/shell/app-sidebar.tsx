// Barra lateral del shell (adopt-premium-design-foundation-and-shell, design D10, D11 y D12; spec
// web-application-shell, «Navegación según permisos», «Destino actual» y «Navegación adaptable»).
// Derivada de `app-sidebar.tsx` y `nav-main.tsx` de la plantilla «Studio Admin» (MIT;
// frontend/THIRD_PARTY_NOTICES.md): los grupos y destinos salen del modelo de rutas canónico y del rol
// de la sesión; sin tarjeta de soporte, Inbox, insignias ni navegación de demostración. En móvil, los
// grupos se pliegan (navigation-responsive.md), con el del destino actual abierto.
"use client";

import { ChevronDown, Receipt } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
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

export function AppSidebar({ headerAction }: { headerAction?: ReactNode }) {
  const { me } = useSession();
  const pathname = usePathname();
  const groups = visibleGroups(permissionsOf(me.role));
  const activeHref = resolveRoute(pathname)?.destination.href;
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
      <SidebarContent>
        <nav aria-label="Navegación principal" className="flex min-h-full flex-col">
          {groups.map((group) => (
            <NavSection key={group.id} group={group} activeHref={activeHref} />
          ))}
        </nav>
      </SidebarContent>
    </Sidebar>
  );
}
