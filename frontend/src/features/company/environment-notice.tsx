// Aviso del ambiente sobre la barra superior (ERS RF-004 y RF-005; decisión del propietario sobre la
// cabecera, 2026-10-16). Una franja de ancho completo encima de la barra, dentro de su bloque fijo:
// sigue a la vista al desplazar, no se puede cerrar ni ocultar y nunca comunica solo con color o
// icono. La advertencia fiscal se repite donde se decide, junto a «Emitir»
// (`EmissionEnvironmentNotice`).
// - Pruebas: dice que los comprobantes no tienen validez tributaria y, a quien puede cambiar el
//   ambiente, le ofrece ir a Configuración › Ambiente.
// - Sin confirmar: lo dice y lo explica, y nunca se presenta como Producción.
// - Producción: el ambiente real de la empresa no lleva franja.
// Mientras carga no muestra nada, para no anunciar un ambiente que aún no conoce.
"use client";

import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useSession } from "@/components/session";
import { canSee } from "@/lib/permissions";
import { useEnvironmentState } from "./company-api";

/** Franja de advertencia a todo el ancho: icono decorativo y texto centrado. */
function Strip({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      data-slot="environment-banner"
      className="flex items-center justify-center gap-2 border-b border-warning/40 bg-warning/10 px-3 py-1.5 text-sm"
    >
      <TriangleAlert aria-hidden="true" className="size-4 shrink-0 text-warning" />
      <p>{children}</p>
    </div>
  );
}

export function EnvironmentBanner() {
  const environment = useEnvironmentState();
  const { me } = useSession();
  if (environment === "PENDING" || environment === "PRODUCTION") return null;
  if (environment === "UNKNOWN") {
    return (
      <Strip>
        <span className="font-medium">No pudimos confirmar el ambiente.</span> No sabemos si los
        comprobantes que se emitan tendrán validez tributaria. Vuelve a cargar la pantalla antes de
        emitir.
      </Strip>
    );
  }
  return (
    <Strip>
      <span className="font-medium">Estás en el ambiente de Pruebas:</span> los comprobantes que
      emitas no tienen validez tributaria.
      {canSee(me.role, "environment.change") && (
        <>
          {" "}
          <Link
            href="/configuracion/ambiente"
            className="font-medium underline underline-offset-2 hover:text-foreground"
          >
            Cambiar ambiente
          </Link>
        </>
      )}
    </Strip>
  );
}
