// Menú de cuenta (adopt-premium-design-foundation-and-shell, design D8 y D11; spec
// web-application-shell, «Menú de cuenta» y «Tema accesible»). Derivado de `nav-user.tsx` de la
// plantilla «Studio Admin» (MIT; frontend/THIRD_PARTY_NOTICES.md), con la cuenta real de la sesión:
// sin imagen remota, sin Billing ni Notifications de demostración. El tema vive aquí a todas las
// anchuras y en ningún otro sitio: nunca hay dos controles de tema
// (productize-invoice-editor-and-composition-foundation, spec «Tema accesible»).
"use client";

import { LogOut, Monitor, Moon, Sun, UserRound } from "lucide-react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { useState } from "react";
import { useSession } from "@/components/session";
import { Avatar, AvatarFallback, initials } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ROLE_LABELS } from "@/lib/permissions";

const THEMES = [
  { value: "light", label: "Claro", icon: Sun },
  { value: "dark", label: "Oscuro", icon: Moon },
  { value: "system", label: "Sistema", icon: Monitor },
] as const;

export function AccountMenu() {
  const { me, signOut } = useSession();
  const { theme, setTheme } = useTheme();
  const [leaving, setLeaving] = useState(false);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Cuenta de ${me.name}`}
          className="rounded-full"
        >
          <Avatar size="sm">
            <AvatarFallback className="bg-primary/15 text-xs font-semibold text-foreground">
              {initials(me.name)}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel className="flex flex-col gap-0.5 px-2 py-1.5 font-normal">
          <span className="truncate text-sm font-semibold text-foreground">{me.name}</span>
          <span className="truncate text-xs text-muted-foreground">{me.email}</span>
          <span className="truncate text-xs text-muted-foreground">{ROLE_LABELS[me.role]}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/mi-cuenta">
            <UserRound aria-hidden="true" />
            Mi cuenta
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Tema</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          aria-label="Tema"
          value={theme ?? "system"}
          onValueChange={setTheme}
        >
          {THEMES.map(({ value, label, icon: Icon }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <Icon aria-hidden="true" />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
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
