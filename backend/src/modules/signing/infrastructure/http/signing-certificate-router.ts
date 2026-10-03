// Rutas de la firma electrónica bajo /api/v1 (add-signing-certificate, design D9). La carga usa su
// propio parser JSON, con un límite derivado de CERTIFICATE_MAX_BYTES; el parser global de 100 KB
// no la procesa. Ninguna respuesta incluye el archivo, la contraseña ni la clave privada.
import express, { Router, type Request } from "express";
import type { SigningCertificateView } from "@facturador/contracts";
import { contextOf } from "../../../identity/infrastructure/http/request-context.ts";
import type {
  CertificateEntry,
  SigningCertificates,
} from "../../application/signing-certificate.ts";

export const SIGNING_CERTIFICATE_UPLOAD_PATH = "/api/v1/signing-certificate";

/** La carga trae su propio parser: el global se la salta (app.ts, jsonBodyExceptions). */
export const isSigningCertificateUpload = (req: Request): boolean =>
  req.method === "PUT" && req.path === SIGNING_CERTIFICATE_UPLOAD_PATH;

/**
 * Límite del parser propio: el base64 del doble del máximo configurado más un margen para la
 * contraseña y los demás campos. Así un archivo moderadamente mayor que el máximo recibe el
 * rechazo CERTIFICATE_TOO_LARGE sobre sus bytes decodificados, y no un 413 genérico. La ruta solo
 * se procesa tras autenticar (requireContext va antes).
 */
export const uploadBodyLimit = (maxBytes: number): number =>
  Math.ceil((2 * maxBytes) / 3) * 4 + 8192;

export function toSigningCertificateView({
  certificate,
  validity,
  companyRuc,
  rucMatch,
}: CertificateEntry): SigningCertificateView {
  return {
    id: certificate.id,
    subject: certificate.subject,
    issuer: certificate.issuer,
    serialNumber: certificate.serialNumber,
    fingerprint: certificate.fingerprint,
    notBefore: certificate.notBefore.toISOString(),
    notAfter: certificate.notAfter.toISOString(),
    detectedRuc: certificate.detectedRuc,
    companyRuc,
    rucMatch,
    state: validity.state,
    usable: validity.usable,
    daysToExpiry: validity.daysToExpiry,
    uploadedAt: certificate.uploadedAt.toISOString(),
  };
}

export function signingCertificateRouter(
  service: SigningCertificates,
  options: { maxBytes: number },
): Router {
  const router = Router();

  router.get("/signing-certificate", async (_req, res) => {
    const { entry, expiryAlertDays } = await service.get(contextOf(res));
    res.status(200).json({
      data: { certificate: entry ? toSigningCertificateView(entry) : null, expiryAlertDays },
    });
  });

  router.get("/signing-certificate/validity", async (_req, res) => {
    res.status(200).json({ data: await service.validity(contextOf(res)) });
  });

  router.put(
    "/signing-certificate",
    express.json({ limit: uploadBodyLimit(options.maxBytes) }),
    async (req, res) => {
      const { entry, unchanged } = await service.upload(contextOf(res), req.body);
      res.status(200).json({ data: { certificate: toSigningCertificateView(entry), unchanged } });
    },
  );

  router.put("/signing-certificate/expiry-alert", async (req, res) => {
    const expiryAlertDays = await service.setExpiryAlert(contextOf(res), req.body);
    res.status(200).json({ data: { expiryAlertDays } });
  });

  return router;
}
