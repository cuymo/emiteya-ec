// Menú de cuenta (adopt-premium-design-foundation-and-shell, design D8 y D11; spec
// web-application-shell, «Menú de cuenta»). Derivado de `nav-user.tsx` de la plantilla «Studio
// Admin» (MIT; frontend/THIRD_PARTY_NOTICES.md), con la cuenta real de la sesión: sin imagen remota,
// sin Billing ni Notifications de demostración. El disparador es toda la identidad de la barra
// superior (decisión del propietario, 2026-10-22): la ficha del edificio, la empresa y, debajo, el
// nombre de la persona con un chevrón; en un teléfono su zona táctil crece hasta 44 px sin mover
// nada. Sin control de tema: la interfaz siempre va en claro (decisión del propietario, 2026-10-22).
// Al abrirlo, el encabezado lleva la foto propia o las iniciales junto al nombre; el botón conserva el
// icono del establecimiento (redesign-account-profile, decisión del propietario, 2026-10-24). El
// perfil se lee solo al abrir el menú y nunca lo hace esperar.
"use client";

import { Building2, ChevronDown, Compass, LogOut, UserRound } from "lucide-react";
import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import { useSession } from "@/components/session";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ROLE_LABELS } from "@/lib/permissions";
import { useOwnProfile } from "@/features/account/profile-api";
import { UserAvatar } from "@/features/account/user-avatar";
import { useOnboardingTour } from "@/features/onboarding/onboarding-tour";

export function AccountMenu({ company }: { company?: ReactNode }) {
  const { me, signOut } = useSession();
  const [leaving, setLeaving] = useState(false);
  const tour = useOnboardingTour();
  const [open, setOpen] = useState(false);
  const profile = useOwnProfile(open);
  const companyId = useId();
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Cuenta de ${me.name}`}
          // La empresa, que el nombre accesible no repite, se anuncia como descripción.
          {...(company ? { "aria-describedby": companyId } : {})}
          title={me.name}
          data-slot="topbar-identity"
          className="group/identity relative flex min-w-0 items-center gap-3 rounded-md px-1.5 py-1 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring max-md:after:absolute max-md:after:-inset-y-1.5 max-md:after:inset-x-0"
        >
          <span
            aria-hidden="true"
            className="hidden size-9 shrink-0 items-center justify-center rounded-md bg-muted text-foreground-muted group-hover/identity:bg-surface lg:inline-flex"
          >
            <Building2 className="size-5" />
          </span>
          <span className="flex min-w-0 flex-col items-start gap-0.5">
            {company && (
              <span
                id={companyId}
                className="flex max-w-28 min-w-0 items-center text-sm md:max-w-56"
              >
                {company}
              </span>
            )}
            <span className="flex max-w-28 min-w-0 items-center gap-1 text-xs text-foreground-muted group-hover/identity:text-foreground md:max-w-56">
              <span className="truncate">{me.name}</span>
              <ChevronDown aria-hidden="true" className="size-3.5 shrink-0" />
            </span>
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel className="flex items-center gap-3 px-2 py-1.5 font-normal">
          <UserAvatar name={me.name} version={profile.data?.avatar?.version} size="lg" />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-sm font-semibold text-foreground">{me.name}</span>
            <span className="truncate text-xs text-muted-foreground">{me.email}</span>
            <span className="truncate text-xs text-muted-foreground">{ROLE_LABELS[me.role]}</span>
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/mi-cuenta">
            <UserRound aria-hidden="true" />
            Mi cuenta
          </Link>
        </DropdownMenuItem>
        {/* Repite el recorrido de bienvenida desde el principio (add-onboarding-tour). */}
        <DropdownMenuItem onSelect={() => tour.start()}>
          <Compass aria-hidden="true" />
          Ver recorrido
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={leaving}
          onSelect={() => {
            setLeaving(true);
            void signOut();
          }}
        >
          <LogOut aria-hidden="true" />
          Cerrar sesión
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
