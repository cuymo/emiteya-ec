// Shell autenticado (adopt-premium-design-foundation-and-shell, design D11; spec web-application-shell).
// Derivado de `src/app/(main)/dashboard/layout.tsx` de la plantilla «Studio Admin» (MIT;
// frontend/THIRD_PARTY_NOTICES.md). Compone el enlace para saltar al contenido, la barra lateral, la
// barra superior, los avisos persistentes y el área de contenido. Los datos de la empresa y del ambiente
// entran por ranuras desde el layout: el shell no conoce el dominio.
"use client";

import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppBreadcrumbs } from "./app-breadcrumbs";
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
            {/* Migas de las pantallas heredadas, encima del título a todas las anchuras (design D2 de
                productize-invoice-editor-and-composition-foundation); las migradas las pintan ellas. */}
            <AppBreadcrumbs owner="shell" className="mb-2" />
            <RouteGuard>{children}</RouteGuard>
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
        <div className="flex h-12 items-center justify-between border-b px-4 max-md:h-14">
          <span className="text-base font-semibold md:hidden">EmiteYa</span>
          <Skeleton className="ml-auto size-8 rounded-full" />
        </div>
        <div className="flex flex-col gap-4 px-4 py-6 md:px-6">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-6 w-full max-w-xl" />
          <Skeleton className="h-6 w-full max-w-lg" />
        </div>
      </div>
    </div>
  );
}
