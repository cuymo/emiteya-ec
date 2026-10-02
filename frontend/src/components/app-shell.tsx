// Shell autenticado (design D12): cabecera compacta con tema y menú de cuenta, barra lateral con
// los destinos permitidos y, por debajo de 768px, el mismo menú en un cajón.
"use client";

import { LogOut, Menu as MenuIcon, UserRound } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { NavigationLinks, visibleGroups } from "@/components/navigation";
import { useSession } from "@/components/session";
import { Skeleton } from "@/components/states";
import { ThemeMenu, ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu-and-tooltip";
import { ROLE_LABELS } from "@/lib/permissions";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (
    ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "")).toUpperCase() ||
    "?"
  );
}

function SkipLink() {
  return (
    <a
      href="#contenido"
      className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-(--z-toast) focus:rounded-md focus:bg-surface focus:p-1"
    >
      Saltar al contenido
    </a>
  );
}

function Brand() {
  return (
    <Link href="/" className="rounded-md text-base font-bold whitespace-nowrap">
      Facturador SRI
    </Link>
  );
}

function AccountMenu() {
  const { me, signOut } = useSession();
  const [leaving, setLeaving] = useState(false);
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Cuenta de ${me.name}`}
          className="rounded-full"
        >
          <span
            aria-hidden="true"
            className="inline-flex size-4 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-foreground"
          >
            {initials(me.name)}
          </span>
        </Button>
      </MenuTrigger>
      <MenuContent align="end">
        <MenuLabel className="flex flex-col px-1 py-0.5">
          <span className="truncate font-semibold">{me.name}</span>
          <span className="truncate text-xs text-foreground-muted">{ROLE_LABELS[me.role]}</span>
        </MenuLabel>
        <MenuSeparator />
        <MenuItem asChild>
          <Link href="/mi-cuenta">
            <UserRound aria-hidden="true" />
            Mi cuenta
          </Link>
        </MenuItem>
        <MenuItem
          disabled={leaving}
          onSelect={() => {
            setLeaving(true);
            void signOut();
          }}
        >
          <LogOut aria-hidden="true" />
          Cerrar sesión
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { me } = useSession();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const hasNavigation = visibleGroups(me.role).length > 0;

  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      <header className="sticky top-0 z-(--z-sticky) flex h-8 items-center justify-between gap-1 border-b border-border bg-surface px-1 md:px-2">
        <div className="flex items-center gap-1">
          {hasNavigation && (
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              aria-label="Abrir menú"
              onClick={() => setDrawerOpen(true)}
            >
              <MenuIcon aria-hidden="true" />
            </Button>
          )}
          <Brand />
        </div>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <ThemeMenu />
          <AccountMenu />
        </div>
      </header>
      <div className="flex flex-1">
        {hasNavigation && (
          <aside
            aria-label="Barra lateral"
            className="hidden w-32 shrink-0 border-r border-border bg-surface md:block"
          >
            <div className="sticky top-8 h-[calc(100dvh-4rem)]">
              <NavigationLinks role={me.role} />
            </div>
          </aside>
        )}
        <main id="contenido" className="min-w-0 flex-1 px-2 py-3 md:px-3">
          {children}
        </main>
      </div>
      {hasNavigation && (
        <Dialog open={drawerOpen} onOpenChange={setDrawerOpen}>
          <DialogContent
            aria-describedby={undefined}
            closeLabel="Cerrar menú"
            className="top-0 left-0 h-dvh max-h-dvh w-36 max-w-[85vw] translate-x-0 translate-y-0 rounded-none border-y-0 border-l-0"
          >
            <DialogTitle className="sr-only">Menú</DialogTitle>
            <div className="flex h-8 items-center border-b border-border px-2">
              <Brand />
            </div>
            <NavigationLinks role={me.role} onNavigate={() => setDrawerOpen(false)} />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

/** Geometría del shell mientras se verifica la sesión: nunca una pantalla en blanco. */
export function ShellSkeleton() {
  return (
    <div className="flex min-h-dvh flex-col" aria-busy="true">
      <span className="sr-only" role="status">
        Verificando la sesión
      </span>
      <div className="flex h-8 items-center justify-between border-b border-border bg-surface px-2">
        <span className="text-base font-bold">Facturador SRI</span>
        <Skeleton className="size-4 rounded-full" />
      </div>
      <div className="flex flex-col gap-2 px-2 py-3 md:px-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-full max-w-xl" />
        <Skeleton className="h-3 w-full max-w-lg" />
      </div>
    </div>
  );
}
