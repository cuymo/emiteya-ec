// Aviso del ambiente donde se decide emitir (spec document-emission, «Aviso de Pruebas al emitir»;
// productize-invoice-editor-and-composition-foundation, design D21). Va junto a «Emitir» y dentro de
// la confirmación de cada editor que emite. Icono y texto, nunca solo color. En Producción no dice
// nada: la confirmación ya muestra el ambiente como contexto. No cambia las condiciones, la
// confirmación ni el resultado de la emisión.
"use client";

import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEnvironmentState } from "./company-api";

/** El comprobante, con el nombre que lleva en el aviso: todos son femeninos («esta factura»). */
export type EmittedDocument =
  | "factura"
  | "nota de crédito"
  | "nota de débito"
  | "retención"
  | "guía de remisión"
  | "liquidación de compra";

export function EmissionEnvironmentNotice({
  document,
  className,
}: {
  document: EmittedDocument;
  className?: string;
}) {
  const environment = useEnvironmentState();
  if (environment === "PENDING" || environment === "PRODUCTION") return null;
  return (
    <p
      data-slot="emission-environment-notice"
      className={cn(
        "flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-foreground",
        className,
      )}
    >
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
      <span>
        {environment === "UNKNOWN"
          ? "No pudimos confirmar el ambiente: no sabemos si este comprobante tendrá validez tributaria."
          : `Pruebas · esta ${document} no tendrá validez tributaria.`}
      </span>
    </p>
  );
}
