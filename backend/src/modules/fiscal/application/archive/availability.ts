// Documentos disponibles de un comprobante (add-document-archive, design D2): el RIDE solo si está
// autorizado y su RIDE existe; el XML autorizado solo si el SRI lo devolvió; el XML firmado desde
// que está firmado. Las acciones de la bandeja dependen de esto.
import type { ArchiveDocument } from "./archive-ports.ts";

export type RideStatus = "AVAILABLE" | "PENDING" | "STOPPED" | "NOT_APPLICABLE";

export type Availability = Readonly<{
  ride: RideStatus;
  authorizedXml: boolean;
  signedXml: boolean;
}>;

const has = (document: ArchiveDocument, kind: string) =>
  document.artifacts.some((artifact) => artifact.kind === kind);

export function rideStatusOf(document: ArchiveDocument): RideStatus {
  if (document.state !== "AUTHORIZED") return "NOT_APPLICABLE";
  if (has(document, "RIDE_PDF")) return "AVAILABLE";
  // Sin job todavía, el barrido lo programa: la generación está pendiente.
  return document.rideJob?.status === "STOPPED" ? "STOPPED" : "PENDING";
}

export function availabilityOf(document: ArchiveDocument): Availability {
  const authorized = document.state === "AUTHORIZED";
  return {
    ride: rideStatusOf(document),
    authorizedXml: authorized && has(document, "AUTHORIZED_XML"),
    signedXml: document.state !== "RESERVED" && has(document, "SIGNED_XML"),
  };
}
