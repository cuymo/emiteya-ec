import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * Shell de la aplicación: cabecera y barra lateral. La navegación está vacía hasta que los
 * módulos registren sus destinos; en pantallas pequeñas la barra lateral queda oculta.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-(--z-toast) focus:rounded-md focus:bg-surface focus:p-1"
      >
        Saltar al contenido
      </a>
      <header className="flex h-8 items-center justify-between border-b border-border bg-surface px-2">
        <span className="text-base font-bold">Facturador SRI</span>
        <ThemeToggle />
      </header>
      <div className="flex flex-1">
        <aside
          aria-label="Barra lateral"
          className="hidden w-32 shrink-0 border-r border-border bg-surface md:block"
        >
          <nav aria-label="Navegación principal" className="p-2">
            <ul className="flex flex-col gap-0.5" />
          </nav>
        </aside>
        <main id="contenido" className="flex-1 p-3">
          {children}
        </main>
      </div>
    </div>
  );
}
