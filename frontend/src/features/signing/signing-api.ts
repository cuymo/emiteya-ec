// Datos de la firma electrónica (add-signing-certificate, design D9 y D14). Las mutaciones pasan
// por useMutationFeedback e invalidan la firma, su vigencia y la preparación para emitir.
"use client";

import { useQuery } from "@tanstack/react-query";
import {
  certificateValidityViewSchema,
  expiryAlertResultSchema,
  signingCertificateResponseSchema,
  signingCertificateUploadResultSchema,
  type SigningCertificateUploadResult,
  type UploadSigningCertificateInput,
} from "@facturador/contracts";
import { useMutationFeedback } from "@/components/feedback";
import { apiFetch } from "@/lib/api";
import { COMPANY_STATUS_KEY } from "@/features/company/company-api";

export const SIGNING_CERTIFICATE_KEY = ["signing-certificate"] as const;
export const CERTIFICATE_VALIDITY_KEY = ["signing-certificate-validity"] as const;
const SIGNING_KEYS = [SIGNING_CERTIFICATE_KEY, CERTIFICATE_VALIDITY_KEY, COMPANY_STATUS_KEY];

/** Fecha en la hora de Ecuador, con el año completo: 12/11/2026. */
const DATE = new Intl.DateTimeFormat("es-EC", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "America/Guayaquil",
});
export const formatDate = (iso: string) => DATE.format(new Date(iso));

/** CN de un nombre distinguido "C=EC, …, CN=…", o el nombre completo si no tiene. */
export const commonName = (dn: string) => /(?:^|,\s*)CN=([^,]+)/.exec(dn)?.[1] ?? dn;

export function useSigningCertificate(enabled: boolean) {
  return useQuery({
    queryKey: SIGNING_CERTIFICATE_KEY,
    enabled,
    queryFn: ({ signal }) =>
      apiFetch("/signing-certificate", { schema: signingCertificateResponseSchema, signal }),
  });
}

export function useCertificateValidity(enabled: boolean) {
  return useQuery({
    queryKey: CERTIFICATE_VALIDITY_KEY,
    enabled,
    queryFn: ({ signal }) =>
      apiFetch("/signing-certificate/validity", { schema: certificateValidityViewSchema, signal }),
  });
}

/** Lee el archivo como base64, sin el prefijo de data URL. */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
    reader.readAsDataURL(file);
  });
}

function uploadMessage(result: SigningCertificateUploadResult, replacing: boolean) {
  const holder = commonName(result.certificate.subject);
  if (result.unchanged) return "Esa firma ya era la vigente: no cambió nada.";
  return `${replacing ? "Reemplazaste" : "Cargaste"} la firma de ${holder}, vigente hasta el ${formatDate(result.certificate.notAfter)}.`;
}

export function useUploadCertificate(options: {
  onSuccess: () => void;
  onError: (error: unknown) => boolean;
}) {
  return useMutationFeedback({
    mutationFn: (input: UploadSigningCertificateInput) =>
      apiFetch("/signing-certificate", {
        method: "PUT",
        json: input,
        schema: signingCertificateUploadResultSchema,
      }),
    success: (result, input) => uploadMessage(result, input.expectedCurrentId !== null),
    invalidate: SIGNING_KEYS,
    onSuccess: options.onSuccess,
    onError: options.onError,
  });
}

export function useExpiryAlert(options: { onError: (error: unknown) => boolean }) {
  return useMutationFeedback({
    mutationFn: (days: number) =>
      apiFetch("/signing-certificate/expiry-alert", {
        method: "PUT",
        json: { days },
        schema: expiryAlertResultSchema,
      }),
    success: (result) =>
      `El aviso de vencimiento aparecerá con ${result.expiryAlertDays} días de anticipación.`,
    invalidate: SIGNING_KEYS,
    onError: options.onError,
  });
}
