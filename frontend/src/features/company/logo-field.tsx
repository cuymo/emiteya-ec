// Logo de la empresa (ADR 0017, design D5 y D14), dentro de Identificación. Se aplica en el acto,
// sin esperar a «Guardar datos»: cargar, reemplazar o eliminar crea una versión nueva, y los
// comprobantes ya emitidos conservan el logo con que se emitieron. Sin datos registrados, el campo
// explica por qué no está disponible.
"use client";

import type { TaxpayerView } from "@facturador/contracts";
import { ImageIcon, ImageUp, LoaderCircle, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { LabelWithHint } from "@/components/field-hint";
import { fileProblem, formatSize } from "@/components/file-field";
import { Button } from "@/components/ui/button";
import { useRemoveLogo, useReplaceLogo } from "./company-api";

const ACCEPT = ["image/png", "image/jpeg"] as const;
const ACCEPT_LABEL = "PNG o JPEG";
const TYPE_LABELS: Record<string, string> = { "image/png": "PNG", "image/jpeg": "JPEG" };

export function LogoField({
  taxpayer,
  onVersionChange,
}: {
  taxpayer: TaxpayerView;
  onVersionChange: (previous: number, next: number) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
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
  const pending = replace.isPending || remove.isPending;
  const describedBy = problem ? "logo-error" : "logo-hint";

  function choose(file: File | undefined) {
    if (!file || version === null) return;
    const found = fileProblem(file, {
      accept: ACCEPT,
      acceptLabel: ACCEPT_LABEL,
      maxBytes: taxpayer.logoMaxBytes,
    });
    setProblem(found);
    if (!found) replace.mutate({ file, expectedVersion: version });
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Los formatos y el logo vigente, en el tooltip de la etiqueta (decisión del propietario,
          2026-10-22); sin datos registrados, el motivo se ve debajo del botón. */}
      <LabelWithHint
        label="Logo"
        hintId="logo-hint"
        hint={
          version === null
            ? undefined
            : `${ACCEPT_LABEL}, hasta ${formatSize(taxpayer.logoMaxBytes)}.${
                logo
                  ? ` Vigente: ${TYPE_LABELS[logo.mimeType] ?? logo.mimeType} · ${formatSize(logo.sizeBytes)}.`
                  : ""
              } Se aplica en el acto, sin «Guardar datos».`
        }
      >
        <span id="logo-label" className="text-sm font-medium">
          Logo
        </span>
      </LabelWithHint>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-surface-subtle">
          {logo ? (
            // Imagen privada servida por la API con la sesión; next/image no aporta aquí.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/v1/taxpayer/logo?v=${logo.sha256.slice(0, 16)}`}
              alt="Logo vigente de la empresa"
              className="size-full object-contain p-1"
            />
          ) : (
            <ImageIcon aria-hidden="true" className="size-6 text-foreground-muted" />
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pending || version === null}
              aria-describedby={describedBy}
              onClick={() => input.current?.click()}
            >
              {replace.isPending ? (
                <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" />
              ) : (
                <ImageUp aria-hidden="true" />
              )}
              {logo ? "Reemplazar logo" : "Subir logo"}
            </Button>
            {logo && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Eliminar logo"
                disabled={pending}
                onClick={() => setConfirming(true)}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            )}
          </div>
          {version === null && (
            <p id="logo-hint" className="text-xs text-foreground-muted">
              Registra primero los datos de la empresa para cargar el logo.
            </p>
          )}
        </div>
      </div>
      <input
        ref={input}
        id="logo"
        type="file"
        accept={ACCEPT.join(",")}
        className="sr-only"
        tabIndex={-1}
        aria-labelledby="logo-label"
        aria-describedby={describedBy}
        onChange={(event) => {
          choose(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      {problem && (
        <p id="logo-error" role="alert" className="text-xs text-danger">
          {problem}
        </p>
      )}
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
    </div>
  );
}
