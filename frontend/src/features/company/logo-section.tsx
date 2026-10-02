// Logo de la empresa (ADR 0017, design D5 y D14). Se aplica en el acto, fuera del formulario de
// datos: cargar, reemplazar o eliminar crea una versión nueva, y los comprobantes ya emitidos
// conservan el logo con que se emitieron. Sin datos registrados, el campo explica por qué no está
// disponible.
"use client";

import type { TaxpayerView } from "@facturador/contracts";
import { useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FileField } from "@/components/file-field";
import { useRemoveLogo, useReplaceLogo } from "./company-api";

const ACCEPT = ["image/png", "image/jpeg"] as const;
const TYPE_LABELS: Record<string, string> = { "image/png": "PNG", "image/jpeg": "JPEG" };

export function LogoSection({
  taxpayer,
  onVersionChange,
}: {
  taxpayer: TaxpayerView;
  onVersionChange: (previous: number, next: number) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const version = taxpayer.version;
  const changed = (view: TaxpayerView) => {
    if (version !== null && view.version !== null) onVersionChange(version, view.version);
  };
  const replace = useReplaceLogo({ onSuccess: changed });
  const remove = useRemoveLogo({
    onSuccess: (view) => {
      changed(view);
      setConfirming(false);
    },
  });
  const logo = taxpayer.logo;

  return (
    <section
      aria-labelledby="logo-titulo"
      className="flex flex-col gap-2 border-t border-border pt-3"
    >
      <div className="flex flex-col gap-0.5">
        <h2 id="logo-titulo" className="text-lg font-semibold">
          Logo
        </h2>
        <p className="text-sm text-foreground-muted">
          Se aplica en el acto a los comprobantes que se emitan después.
        </p>
      </div>
      <FileField
        id="logo"
        label="Imagen del logo"
        accept={ACCEPT}
        acceptLabel="PNG o JPEG"
        maxBytes={taxpayer.logoMaxBytes}
        pending={replace.isPending || remove.isPending}
        disabledReason={
          version === null
            ? "Registra primero los datos de la empresa para cargar el logo."
            : undefined
        }
        current={
          logo
            ? {
                name: "Logo vigente",
                typeLabel: TYPE_LABELS[logo.mimeType] ?? logo.mimeType,
                sizeBytes: logo.sizeBytes,
                preview: (
                  // Imagen privada servida por la API con la sesión; next/image no aporta aquí.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/v1/taxpayer/logo?v=${logo.sha256.slice(0, 16)}`}
                    alt="Logo vigente de la empresa"
                    className="h-8 max-w-32 rounded-sm border border-border bg-surface object-contain"
                  />
                ),
              }
            : null
        }
        onSelect={(file) => {
          if (version !== null) replace.mutate({ file, expectedVersion: version });
        }}
        onRemove={() => setConfirming(true)}
      />
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Eliminar el logo"
        description="Los comprobantes que se emitan después no llevarán logo. Los ya emitidos conservan el suyo."
        confirmLabel="Eliminar logo"
        tone="destructive"
        pending={remove.isPending}
        onConfirm={() => {
          if (version !== null) remove.mutate({ expectedVersion: version });
        }}
      />
    </section>
  );
}
