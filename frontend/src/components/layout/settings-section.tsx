// Secciones de una pantalla de ajustes (decisión del propietario, 2026-10-16; Empresa y Catálogos
// fiscales): cada una lleva su título y una descripción breve a la izquierda y su contenido a la
// derecha, desde el contenedor `settings-split` (48rem); por debajo, el título va encima. Un
// separador divide las secciones. La pestaña de Configuración ya nombra la pantalla: ninguna
// sección repite ese título.
"use client";

import { useId, type ReactNode } from "react";

/** Mide el ancho disponible para las secciones y las separa entre sí. */
export function SettingsSections({ children }: { children: ReactNode }) {
  return <div className="@container flex flex-col divide-y divide-border">{children}</div>;
}

export function SettingsSection({
  id,
  title,
  description,
  aside,
  children,
}: {
  /** Identificador del título, si otra parte de la pantalla lo necesita. */
  id?: string;
  title: string;
  description: ReactNode;
  /** Más datos de la columna del título, debajo de la descripción (por ejemplo, la fuente). */
  aside?: ReactNode;
  children: ReactNode;
}) {
  const generated = useId();
  const headingId = id ?? generated;
  return (
    <section
      aria-labelledby={headingId}
      className="grid gap-4 py-8 first:pt-0 @settings-split:grid-cols-3 @settings-split:gap-8"
    >
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="text-base font-semibold">
          {title}
        </h2>
        <p className="text-sm text-foreground-muted">{description}</p>
        {aside}
      </div>
      <div className="flex min-w-0 flex-col gap-4 @settings-split:col-span-2">{children}</div>
    </section>
  );
}
