// Navegación del shell (navigation-responsive.md): como máximo dos niveles, filtrada por permisos
// solo como presentación, y el mismo contenido en la barra lateral y en el cajón móvil.
"use client";

import {
  BookOpenCheck,
  Building2,
  Contact,
  FileKey,
  FileMinus,
  FilePenLine,
  FileText,
  FolderArchive,
  Globe,
  ListOrdered,
  Package,
  Store,
  Users,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@facturador/contracts";
import { canSee, type Permission } from "@/lib/permissions";
import { cn } from "@/lib/utils";

type Destination = { href: string; label: string; icon: LucideIcon; permission: Permission };
type Group = { label: string; destinations: Destination[]; placement: "main" | "bottom" };

const GROUPS: Group[] = [
  // add-parties-and-products, design D17; add-invoice-emission, design D15.
  {
    label: "Operación",
    placement: "main",
    destinations: [
      { href: "/facturas", label: "Facturas", icon: FileText, permission: "invoices.read" },
      // add-credit-notes, design D19.
      {
        href: "/notas-credito",
        label: "Notas de crédito",
        icon: FileMinus,
        permission: "creditNotes.read",
      },
      // add-document-archive, design D13: la bandeja documental.
      {
        href: "/comprobantes",
        label: "Comprobantes",
        icon: FolderArchive,
        permission: "archive.read",
      },
      { href: "/borradores", label: "Borradores", icon: FilePenLine, permission: "invoices.draft" },
      { href: "/terceros", label: "Terceros", icon: Contact, permission: "parties.read" },
      { href: "/productos", label: "Productos", icon: Package, permission: "products.read" },
      // add-minimal-inventory, design D13: el stock contabilizado de los productos controlados.
      {
        href: "/inventario",
        label: "Inventario",
        icon: Warehouse,
        permission: "inventory.read",
      },
    ],
  },
  {
    label: "Configuración",
    placement: "bottom",
    destinations: [
      {
        href: "/configuracion/empresa",
        label: "Empresa",
        icon: Building2,
        permission: "taxpayer.read",
      },
      {
        href: "/configuracion/ambiente",
        label: "Ambiente",
        icon: Globe,
        permission: "environment.change",
      },
      {
        href: "/configuracion/establecimientos",
        label: "Establecimientos",
        icon: Store,
        permission: "establishments.manage",
      },
      {
        href: "/configuracion/firma",
        label: "Firma electrónica",
        icon: FileKey,
        permission: "certificate.read",
      },
      {
        href: "/configuracion/catalogos-fiscales",
        label: "Catálogos fiscales",
        icon: BookOpenCheck,
        permission: "fiscalCatalogs.read",
      },
      {
        href: "/configuracion/secuenciales",
        label: "Secuenciales",
        icon: ListOrdered,
        permission: "sequences.read",
      },
      { href: "/configuracion/usuarios", label: "Usuarios", icon: Users, permission: "users.read" },
    ],
  },
];

export function visibleGroups(role: Role | undefined): Group[] {
  return GROUPS.map((group) => ({
    ...group,
    destinations: group.destinations.filter((d) => canSee(role, d.permission)),
  })).filter((group) => group.destinations.length > 0);
}

export function NavigationLinks({ role, onNavigate }: { role: Role; onNavigate?: () => void }) {
  const pathname = usePathname();
  const groups = visibleGroups(role);
  return (
    <nav aria-label="Navegación principal" className="flex h-full flex-col gap-3 p-2">
      {(["main", "bottom"] as const).map((placement) => (
        <div
          key={placement}
          className={cn("flex flex-col gap-2", placement === "bottom" && "mt-auto")}
        >
          {groups
            .filter((group) => group.placement === placement)
            .map((group) => (
              <div key={group.label} className="flex flex-col gap-0.5">
                <p className="px-1 text-xs font-medium text-foreground-muted">{group.label}</p>
                <ul className="flex flex-col gap-0.5">
                  {group.destinations.map((destination) => {
                    const active =
                      pathname === destination.href || pathname.startsWith(`${destination.href}/`);
                    const Icon = destination.icon;
                    return (
                      <li key={destination.href}>
                        <Link
                          href={destination.href}
                          onClick={onNavigate}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "flex h-5.5 items-center gap-1 rounded-md px-1 text-sm font-medium",
                            "motion-safe:transition-colors motion-safe:duration-150",
                            active
                              ? "bg-primary text-primary-foreground"
                              : "text-foreground hover:bg-surface-subtle active:bg-border",
                          )}
                        >
                          <Icon aria-hidden="true" className="size-2.5" />
                          {destination.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
        </div>
      ))}
    </nav>
  );
}
