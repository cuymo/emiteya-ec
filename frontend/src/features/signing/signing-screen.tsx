// Firma electrónica (add-signing-certificate, design D14). Usuario: administrador. Objetivo: tener
// una firma utilizable para emitir y saber cuándo renovarla. Decisión: si cargar o reemplazar la
// firma. Acción principal: Cargar firma o Reemplazar firma. P0: estado, vencimiento y la acción.
// P1: titular, RUC y su advertencia, anticipación del aviso. P2: emisor, serie y fecha de carga.
"use client";

import { EXPIRY_ALERT_DAYS, type SigningCertificateView } from "@facturador/contracts";
import { useState } from "react";
import { errorMessage } from "@/components/feedback";
import { useSession } from "@/components/session";
import {
  EmptyState,
  ErrorState,
  Skeleton,
  StatusBadge,
  type StatusTone,
} from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api";
import { canSee } from "@/lib/permissions";
import { commonName, formatDate, useExpiryAlert, useSigningCertificate } from "./signing-api";
import { UploadCertificateDialog } from "./upload-dialog";

const STATE: Record<SigningCertificateView["state"], { tone: StatusTone; label: string }> = {
  VALID: { tone: "success", label: "Utilizable" },
  EXPIRING: { tone: "warning", label: "Por vencer" },
  EXPIRED: { tone: "danger", label: "Vencida" },
  KEY_UNAVAILABLE: { tone: "danger", label: "No disponible" },
};

export const daysPhrase = (days: number) =>
  days === 0 ? "vence hoy" : days === 1 ? "falta 1 día" : `faltan ${days} días`;

function stateExplanation(certificate: SigningCertificateView): string {
  const date = formatDate(certificate.notAfter);
  switch (certificate.state) {
    case "VALID":
      return `Vence el ${date} (${daysPhrase(certificate.daysToExpiry)}).`;
    case "EXPIRING":
      return `Vence el ${date} (${daysPhrase(certificate.daysToExpiry)}). Renueva la firma antes de esa fecha.`;
    case "EXPIRED":
      return `Venció el ${date}: no se puede emitir hasta cargar una firma vigente.`;
    case "KEY_UNAVAILABLE":
      return "La clave de custodia de esta instalación no abre esta firma: vuelve a cargarla para poder emitir.";
  }
}

function RucComparison({ certificate }: { certificate: SigningCertificateView }) {
  if (certificate.rucMatch === "MATCH") {
    return <p className="text-sm text-foreground-muted">Coincide con el RUC de la empresa.</p>;
  }
  if (certificate.rucMatch === "PENDING") {
    return (
      <p className="text-sm text-foreground-muted">
        Registra los datos de la empresa para comparar el RUC.
      </p>
    );
  }
  return (
    <div
      role="note"
      className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm"
    >
      El RUC del certificado ({certificate.detectedRuc}) es distinto del RUC de la empresa (
      {certificate.companyRuc}). Es una comprobación preventiva de esta aplicación: la firma se
      puede usar.
    </div>
  );
}

function ExpiryAlertForm({ days }: { days: number }) {
  const [value, setValue] = useState(String(days));
  const [error, setError] = useState<string>();
  const save = useExpiryAlert({
    onError: (cause) => {
      if (cause instanceof ApiError && cause.status === 400) {
        setError(cause.message);
        return true;
      }
      return false;
    },
  });
  const parsed = Number(value);
  const valid =
    /^\d{1,2}$/.test(value) && parsed >= EXPIRY_ALERT_DAYS.min && parsed <= EXPIRY_ALERT_DAYS.max;
  return (
    <form
      className="flex flex-col gap-2"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setError(undefined);
        if (!valid) {
          setError(
            `La anticipación debe ser un número entero de días entre ${EXPIRY_ALERT_DAYS.min} y ${EXPIRY_ALERT_DAYS.max}.`,
          );
          return;
        }
        save.mutate(parsed);
      }}
    >
      <label htmlFor="expiry-alert-days" className="text-sm font-medium">
        Aviso de vencimiento
      </label>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>Avisar con</span>
        <Input
          id="expiry-alert-days"
          inputMode="numeric"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "expiry-alert-error" : "expiry-alert-hint"}
          className="w-16"
          maxLength={2}
        />
        <span>días de anticipación</span>
        <Button type="submit" variant="outline" disabled={save.isPending || parsed === days}>
          Guardar
        </Button>
      </div>
      {error ? (
        <p id="expiry-alert-error" role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : (
        <p id="expiry-alert-hint" className="text-xs text-foreground-muted">
          Entre {EXPIRY_ALERT_DAYS.min} y {EXPIRY_ALERT_DAYS.max} días. Administradores y operadores
          ven el aviso.
        </p>
      )}
    </form>
  );
}

export function SigningScreen() {
  const { me } = useSession();
  const allowed = canSee(me.role, "certificate.read");
  const query = useSigningCertificate(allowed);
  const [dialogOpen, setDialogOpen] = useState(false);
  const heading = (
    <h1 id="firma-titulo" className="text-3xl font-bold">
      Firma electrónica
    </h1>
  );

  if (!allowed) {
    return (
      <section aria-labelledby="firma-titulo" className="flex flex-col gap-6">
        {heading}
        <EmptyState
          kind="no-permission"
          title="No tienes permiso para ver esta sección"
          description="Solo un administrador carga y consulta la firma electrónica."
        />
      </section>
    );
  }
  if (query.isPending) {
    return (
      <section
        aria-labelledby="firma-titulo"
        aria-busy="true"
        className="flex max-w-3xl flex-col gap-6"
      >
        {heading}
        <Skeleton className="h-64 w-full" />
      </section>
    );
  }
  if (query.isError) {
    return (
      <section aria-labelledby="firma-titulo" className="flex max-w-3xl flex-col gap-6">
        {heading}
        <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      </section>
    );
  }

  const { certificate, expiryAlertDays, maxBytes } = query.data;
  const action = (
    <Button onClick={() => setDialogOpen(true)}>
      {certificate ? "Reemplazar firma" : "Cargar firma"}
    </Button>
  );
  return (
    <section aria-labelledby="firma-titulo" className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        {heading}
        {certificate && action}
      </div>
      {certificate ? (
        <>
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge
                tone={STATE[certificate.state].tone}
                label={STATE[certificate.state].label}
              />
              <p className="text-sm">{stateExplanation(certificate)}</p>
            </div>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
              <dt className="text-foreground-muted">Titular</dt>
              <dd className="break-words">{commonName(certificate.subject)}</dd>
              <dt className="text-foreground-muted">RUC del certificado</dt>
              <dd className="tabular-nums">{certificate.detectedRuc}</dd>
              <dt className="text-foreground-muted">Emisor</dt>
              <dd className="break-words">{commonName(certificate.issuer)}</dd>
              <dt className="text-foreground-muted">Número de serie</dt>
              <dd className="break-all tabular-nums">{certificate.serialNumber}</dd>
              <dt className="text-foreground-muted">Cargada el</dt>
              <dd>{formatDate(certificate.uploadedAt)}</dd>
            </dl>
            <RucComparison certificate={certificate} />
          </div>
          <ExpiryAlertForm key={expiryAlertDays} days={expiryAlertDays} />
        </>
      ) : (
        <EmptyState
          kind="empty"
          title="Carga la firma electrónica para poder emitir"
          description="Es el archivo PKCS#12 (.p12 o .pfx) que entrega tu entidad certificadora, con su contraseña."
          action={action}
        />
      )}
      <UploadCertificateDialog
        open={dialogOpen}
        current={certificate}
        maxBytes={maxBytes}
        onOpenChange={setDialogOpen}
        onReload={() => query.refetch()}
      />
    </section>
  );
}
