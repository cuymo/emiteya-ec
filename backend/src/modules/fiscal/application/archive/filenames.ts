// Nombre de archivo de una descarga (add-document-archive, design D8): determinista y seguro. El
// tipo sale de una tabla fija y el número, del comprobante con su patrón comprobado; nunca se usa
// texto del cliente.
import type { DocumentType } from "../../domain/numbering.ts";
import type { ArtifactKind } from "../../domain/document.ts";

const TYPE_NAMES: Readonly<Record<DocumentType, string>> = {
  "01": "factura",
  "03": "liquidacion-de-compra",
  "04": "nota-de-credito",
  "05": "nota-de-debito",
  "06": "guia-de-remision",
  "07": "comprobante-de-retencion",
};

const SUFFIXES: Readonly<Record<ArtifactKind, string>> = {
  RIDE_PDF: ".pdf",
  AUTHORIZED_XML: "-autorizado.xml",
  SIGNED_XML: "-firmado.xml",
};

const NUMBER = /^\d{3}-\d{3}-\d{9}$/;

export function downloadFilename(
  documentType: DocumentType,
  documentNumber: string,
  kind: ArtifactKind,
): string {
  if (!NUMBER.test(documentNumber)) throw new Error("número de comprobante inválido");
  return `${TYPE_NAMES[documentType]}-${documentNumber}${SUFFIXES[kind]}`;
}
