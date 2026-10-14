// Diálogo Cargar firma o Reemplazar firma (add-signing-certificate, design D14). Archivo PKCS#12 y
// su contraseña; los errores van a su campo o al cuerpo, el conflicto ofrece Recargar y la
// contraseña se borra al cerrar. Nunca se repite la contraseña en un mensaje.
"use client";

import { formatCertificateBytes, type SigningCertificateView } from "@facturador/contracts";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { errorMessage } from "@/components/feedback";
import { FileField } from "@/components/file-field";
import { fieldAria, FormDialog, FormField } from "@/components/form-dialog";
import { PasswordField } from "@/components/password-field";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { commonName, fileToBase64, formatDate, useUploadCertificate } from "./signing-api";

const ACCEPT = [".p12", ".pfx", "application/x-pkcs12"] as const;
const FILE_ERRORS = new Set([
  "CERTIFICATE_UNREADABLE",
  "CERTIFICATE_TOO_LARGE",
  "CERTIFICATE_KEY_UNSUPPORTED",
  "CERTIFICATE_NOT_VALID_NOW",
]);

type FormValues = { password: string };

export function UploadCertificateDialog({
  open,
  current,
  maxBytes,
  onOpenChange,
  onReload,
}: {
  open: boolean;
  current: SigningCertificateView | null;
  /** Límite efectivo que informa el backend (CERTIFICATE_MAX_BYTES). */
  maxBytes: number;
  onOpenChange: (open: boolean) => void;
  onReload: () => Promise<unknown>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string>();
  const [error, setError] = useState<string>();
  const [conflict, setConflict] = useState(false);
  const form = useForm<FormValues>({ defaultValues: { password: "" } });
  const { errors } = form.formState;

  const reset = () => {
    form.reset({ password: "" });
    setFile(null);
    setFileError(undefined);
    setError(undefined);
    setConflict(false);
  };
  const close = () => {
    reset();
    onOpenChange(false);
  };
  const upload = useUploadCertificate({
    onSuccess: close,
    onError: (cause) => {
      if (!(cause instanceof ApiError)) return false;
      if (cause.code === "CERTIFICATE_PASSWORD_INVALID") {
        form.setError("password", { message: cause.message }, { shouldFocus: true });
        return true;
      }
      if (FILE_ERRORS.has(cause.code)) {
        setFileError(cause.message);
        return true;
      }
      if (cause.code === "CERTIFICATE_CHANGED") {
        setError(cause.message);
        setConflict(true);
        return true;
      }
      if (cause.status === 400 || cause.status === 409 || cause.status === 503) {
        setError(
          errorMessage(cause, { CRYPTO_BUSY: cause.message, CRYPTO_TIMEOUT: cause.message }),
        );
        return true;
      }
      return false;
    },
  });
  const replacing = current !== null;
  const pending = upload.isPending || form.formState.isSubmitting;

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title={replacing ? "Reemplazar firma" : "Cargar firma"}
      description="Archivo PKCS#12 (.p12 o .pfx) de tu entidad certificadora y su contraseña."
      submitLabel={replacing ? "Reemplazar firma" : "Cargar firma"}
      pending={pending}
      error={conflict ? undefined : error}
      onSubmit={form.handleSubmit(async ({ password }) => {
        if (upload.isPending) return;
        setError(undefined);
        setConflict(false);
        if (!file) {
          setFileError("Selecciona el archivo de la firma electrónica.");
          return;
        }
        if (!password) {
          form.setError(
            "password",
            { message: "Escribe la contraseña de la firma." },
            { shouldFocus: true },
          );
          return;
        }
        upload.mutate({
          file: await fileToBase64(file),
          password,
          expectedCurrentId: current?.id ?? null,
        });
      })}
    >
      {replacing && (
        <p className="text-sm text-foreground-muted">
          Reemplazará la firma de {commonName(current.subject)}, que vence el{" "}
          {formatDate(current.notAfter)}.
        </p>
      )}
      <FileField
        id="certificate-file"
        label="Archivo de la firma"
        accept={ACCEPT}
        acceptLabel="PKCS#12 (.p12 o .pfx)"
        maxBytes={maxBytes}
        formatBytes={formatCertificateBytes}
        pending={pending}
        current={file ? { name: file.name, typeLabel: "PKCS#12", sizeBytes: file.size } : null}
        onSelect={(selected) => {
          setFile(selected);
          setFileError(undefined);
        }}
        error={fileError}
      />
      <FormField
        id="certificate-password"
        label="Contraseña de la firma"
        error={errors.password?.message}
      >
        <PasswordField
          {...fieldAria("certificate-password", errors.password?.message)}
          {...form.register("password")}
          autoComplete="new-password"
        />
      </FormField>
      {conflict && (
        <div
          role="alert"
          className="flex flex-col items-start gap-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm"
        >
          <p>{error}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void onReload().then(() => {
                setError(undefined);
                setConflict(false);
              })
            }
          >
            Recargar
          </Button>
        </div>
      )}
    </FormDialog>
  );
}
