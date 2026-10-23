// Mensaje del correo de un comprobante (add-email-delivery, design D4; spec email-delivery,
// «Contenido del correo»): el asunto con el tipo, el número y la razón social del emisor; un
// resumen en texto y en HTML con todos los valores escapados; y siempre los dos adjuntos, el XML
// autorizado y el RIDE, nombrados con la clave de acceso. En Pruebas, la marca de prueba sin
// validez tributaria. Puro: no lee nada ni conoce el transporte.
import { createHash } from "node:crypto";
import type { DocumentType, Environment } from "@facturador/contracts";

export const DOCUMENT_TYPE_NAMES: Record<DocumentType, { name: string; electronic: string }> = {
  "01": { name: "Factura", electronic: "factura electrónica" },
  "03": { name: "Liquidación de compra", electronic: "liquidación de compra electrónica" },
  "04": { name: "Nota de crédito", electronic: "nota de crédito electrónica" },
  "05": { name: "Nota de débito", electronic: "nota de débito electrónica" },
  "06": { name: "Guía de remisión", electronic: "guía de remisión electrónica" },
  "07": { name: "Comprobante de retención", electronic: "comprobante de retención electrónico" },
};

export const TEST_SUBJECT_PREFIX = "PRUEBAS – sin validez tributaria · ";

export type MessageDocument = Readonly<{
  documentType: DocumentType;
  /** `001-001-000000123`. */
  documentNumber: string;
  /** `YYYY-MM-DD`. */
  issueDate: string;
  accessKey: string;
  authorizationNumber: string;
  environment: Environment;
  issuerName: string;
  /** El receptor único; null en la guía de remisión, con varios destinatarios. */
  receiverName: string | null;
  /** Importe total en su forma canónica; null en los tipos sin total (guía de remisión). */
  total: string | null;
}>;

export type ComposedMessage = Readonly<{
  subject: string;
  text: string;
  html: string;
  attachments: readonly Readonly<{ filename: string; contentType: string }>[];
}>;

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

/** `2026-10-23` → `23/10/2026`. */
const displayDate = (isoDate: string) => {
  const [year, month, day] = isoDate.split("-");
  return year && month && day ? `${day}/${month}/${year}` : isoDate;
};

/** Sin saltos de línea: un texto de un snapshot nunca parte las cabeceras del correo. */
const oneLine = (value: string) => value.replace(/[\r\n]+/g, " ").trim();

export const attachmentNames = (accessKey: string) => ({
  xml: `${accessKey}.xml`,
  ride: `${accessKey}.pdf`,
});

export function composeMessage(document: MessageDocument): ComposedMessage {
  const type = DOCUMENT_TYPE_NAMES[document.documentType];
  const testing = document.environment === "TEST";
  const issuer = oneLine(document.issuerName);
  const subject = `${testing ? TEST_SUBJECT_PREFIX : ""}${type.name} ${document.documentNumber} de ${issuer}`;
  const rows: [string, string][] = [
    ["Tipo", type.name],
    ["Número", document.documentNumber],
    ["Fecha de emisión", displayDate(document.issueDate)],
    ...(document.receiverName
      ? [["Receptor", oneLine(document.receiverName)] as [string, string]]
      : []),
    ...(document.total !== null
      ? [["Importe total", `USD ${document.total}`] as [string, string]]
      : []),
    ["Número de autorización", document.authorizationNumber],
  ];
  const intro = `${issuer} le envía su ${type.electronic}.`;
  const attachmentsNote =
    "Adjuntamos el comprobante electrónico en XML, que tiene validez tributaria, y su representación impresa (RIDE) en PDF. Puede verificarlo en el portal del SRI con su número de autorización.";
  const legal =
    "Este correo es la entrega del comprobante electrónico, conforme al artículo 6 de la Resolución NAC-DGERCGC18-00000233 del SRI.";
  const testNote = "Comprobante del ambiente de Pruebas del SRI: no tiene validez tributaria.";
  const text = [
    ...(testing ? [testNote] : []),
    intro,
    rows.map(([label, value]) => `${label}: ${value}`).join("\n"),
    attachmentsNote,
    legal,
  ].join("\n\n");
  const paragraph = (value: string) => `<p>${escapeHtml(value)}</p>`;
  const html = [
    "<!doctype html>",
    '<html lang="es"><body>',
    ...(testing ? [`<p><strong>${escapeHtml(testNote)}</strong></p>`] : []),
    paragraph(intro),
    "<table>",
    ...rows.map(
      ([label, value]) =>
        `<tr><th align="left">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`,
    ),
    "</table>",
    paragraph(attachmentsNote),
    paragraph(legal),
    "</body></html>",
  ].join("\n");
  const names = attachmentNames(document.accessKey);
  return {
    subject,
    text,
    html,
    attachments: [
      { filename: names.xml, contentType: "application/xml" },
      { filename: names.ride, contentType: "application/pdf" },
    ],
  };
}

/** `Message-ID` determinista por envío: un reintento no aparece como otro correo (design D4). */
export const messageIdOf = (deliveryId: string, fromAddress: string) =>
  `<envio-${deliveryId}@${fromAddress.split("@").pop() ?? "localhost"}>`;

/** Un artefacto guardado con su tamaño y su SHA-256. */
export type StoredBytes = Readonly<{ content: Uint8Array; sizeBytes: number; sha256: string }>;

/**
 * Los bytes exactos del artefacto si coinciden con su tamaño y su hash; null si falta o se alteró.
 * Un correo nunca sale con uno solo de sus dos archivos ni con uno alterado.
 */
export function verifiedBytes(artifact: StoredBytes | null): Buffer | null {
  if (!artifact || artifact.content.length !== artifact.sizeBytes) return null;
  const hash = createHash("sha256").update(artifact.content).digest("hex");
  return hash === artifact.sha256 ? Buffer.from(artifact.content) : null;
}
