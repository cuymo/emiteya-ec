// Shell autenticado (adopt-premium-design-foundation-and-shell, design D11; spec web-application-shell).
// Derivado de `src/app/(main)/dashboard/layout.tsx` de la plantilla «Studio Admin» (MIT;
// frontend/THIRD_PARTY_NOTICES.md). Compone el enlace para saltar al contenido, la barra lateral, la
// barra superior, los avisos persistentes y el área de contenido. Los datos de la empresa y del ambiente
// entran por ranuras desde el layout: el shell no conoce el dominio.
"use client";

import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "./app-sidebar";
import { BreadcrumbLabelProvider } from "./breadcrumb-label";
import { CommandPalette } from "./command-palette";
import { QuickCreateMenu } from "./quick-create-menu";
import { RouteGuard } from "./route-guard";
import { Topbar } from "./topbar";

function SkipLink() {
  return (
    <a
      href="#contenido"
      className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-(--z-toast) focus:rounded-md focus:bg-background focus:p-2 focus:ring-2 focus:ring-ring"
    >
      Saltar al contenido
    </a>
  );
}

export function AppShell({
  company,
  environment,
  notices,
  sidebarDefaultOpen = true,
  children,
}: {
  company: ReactNode;
  environment: ReactNode;
  notices: ReactNode;
  sidebarDefaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <BreadcrumbLabelProvider>
      <SkipLink />
      <SidebarProvider defaultOpen={sidebarDefaultOpen}>
        <AppSidebar headerAction={<QuickCreateMenu />} />
        <SidebarInset>
          <Topbar company={company} environment={environment} search={<CommandPalette />} />
          {notices}
          <main
            id="contenido"
            tabIndex={-1}
            className="min-w-0 flex-1 px-4 py-6 outline-none md:px-6"
          >
            {/* Columna centrada: el ancho de un espacio de trabajo, o el que declara la pantalla con
                `data-page-width` en su raíz (lectura o formulario). Las migas y el título de la
                ruta van en la barra superior. */}
            <div className="mx-auto w-full max-w-workspace has-data-[page-width=form]:max-w-form has-data-[page-width=reading]:max-w-reading">
              <RouteGuard>{children}</RouteGuard>
            </div>
          </main>
        </SidebarInset>
      </SidebarProvider>
    </BreadcrumbLabelProvider>
  );
}

/** Estructura del shell mientras se verifica la sesión: nunca una pantalla en blanco. */
export function ShellSkeleton() {
  return (
    <div className="flex min-h-svh" aria-busy="true">
      <span className="sr-only" role="status">
        Verificando la sesión
      </span>
      <div className="hidden w-(--sidebar-width) shrink-0 flex-col gap-2 border-r bg-sidebar p-2 md:flex">
        <span className="flex h-8 items-center px-2 text-base font-semibold">EmiteYa</span>
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-4/5" />
        <Skeleton className="h-8 w-3/5" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 items-center justify-between border-b px-4 md:h-18 md:px-6">
          <span className="text-base font-semibold md:hidden">EmiteYa</span>
          <Skeleton className="hidden h-9 w-48 md:block" />
          <Skeleton className="ml-auto h-9 w-40" />
        </div>
        <div className="mx-auto flex w-full max-w-workspace flex-col gap-4 px-4 py-6 md:px-6">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-6 w-full max-w-xl" />
          <Skeleton className="h-6 w-full max-w-lg" />
        </div>
      </div>
    </div>
  );
}
