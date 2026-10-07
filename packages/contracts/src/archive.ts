// Contratos de la bandeja de comprobantes y de sus documentos (add-document-archive, design D2, D8
// a D11). La bandeja es transversal a los comprobantes emitidos: factura, notas de crédito y de
// débito, guía de remisión y comprobante de retención. La guía no tiene total ni comprador único y
// lleva el resumen de sus destinatarios (add-shipping-guides, design D10). Las consultas no son
// estrictas: un `companyId` en la consulta se ignora, porque la empresa sale siempre de la sesión.
// Las vistas nunca llevan bytes ni XML.
import { z } from "zod";
import { decimalString, DECIMAL_SPECS } from "./decimal.ts";
import { documentTypeSchema } from "./fiscal-numbering.ts";
import { INVOICE_STATES } from "./invoices.ts";
import { listMetaSchema, pageParams, searchParam } from "./pagination.ts";

/** Estados del comprobante desde que se reserva; los borradores no están en la bandeja. */
export const DOCUMENT_STATES = INVOICE_STATES;
export const documentStateSchema = z.enum(DOCUMENT_STATES, { error: "El estado no es válido." });
export type DocumentState = z.infer<typeof documentStateSchema>;

/** Fecha de calendario `YYYY-MM-DD` que existe. */
export const calendarDateSchema = z
  .string({ error: "La fecha no es válida." })
  .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha no es válida.")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
  }, "La fecha no es válida.");

const idFilter = (message: string) =>
  z.string({ error: message }).trim().min(1, message).max(64, message);

/** Filtros de la bandeja (ERS RF-402): combinables, con el rango de fechas inclusivo. */
export const listDocumentsQuerySchema = z
  .object({
    from: calendarDateSchema.optional(),
    to: calendarDateSchema.optional(),
    documentType: documentTypeSchema.optional(),
    state: documentStateSchema.optional(),
    /** Identificación exacta del receptor. */
    identification: z
      .string({ error: "La identificación no es válida." })
      .trim()
      .regex(/^[A-Za-z0-9]{1,20}$/, "La identificación no es válida.")
      .optional(),
    /** Número del comprobante o nombre del receptor. */
    search: searchParam,
    establishmentId: idFilter("El establecimiento no es válido.").optional(),
    emissionPointId: idFilter("El punto de emisión no es válido.").optional(),
    ...pageParams,
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    path: ["to"],
    message: "La fecha final no puede ser anterior a la inicial.",
  });
export type ListDocumentsQuery = z.output<typeof listDocumentsQuerySchema>;

export const documentIdParamsSchema = z.strictObject({ documentId: z.string().min(1) });

/** Estado del RIDE de un comprobante (design D2). */
export const RIDE_STATUSES = ["AVAILABLE", "PENDING", "STOPPED", "NOT_APPLICABLE"] as const;
export const rideStatusSchema = z.enum(RIDE_STATUSES);
export type RideStatus = z.infer<typeof rideStatusSchema>;

/** Documentos que se pueden descargar de un comprobante. */
export const documentAvailabilitySchema = z.strictObject({
  ride: rideStatusSchema,
  /** Solo si el SRI devolvió el comprobante autorizado. */
  authorizedXml: z.boolean(),
  /** Desde que el comprobante está firmado; nunca se presenta como autorizado. */
  signedXml: z.boolean(),
});
export type DocumentAvailability = z.infer<typeof documentAvailabilitySchema>;

/**
 * Resumen de los destinatarios de un comprobante sin comprador único (add-shipping-guides, design D10
 * y D21): cuántos son y el nombre del único, o `null` si son varios. La interfaz muestra el nombre o
 * "N destinatarios".
 */
export const documentRecipientsSummarySchema = z.strictObject({
  count: z.number().int().min(1),
  name: z.string().nullable(),
});
export type DocumentRecipientsSummary = z.infer<typeof documentRecipientsSummarySchema>;

const documentListItemShape = z.strictObject({
  id: z.string(),
  documentType: documentTypeSchema,
  number: z.string(),
  issueDate: z.string(),
  /** Nulo solo en la guía de remisión, que tiene destinatarios (P10). */
  buyer: z.strictObject({ name: z.string(), identification: z.string() }).nullable(),
  /** Nulo solo en la guía de remisión: no tiene total monetario, nunca 0.00 (P10). */
  total: decimalString(DECIMAL_SPECS.importe).nullable(),
  /** Solo en la guía de remisión. */
  recipients: documentRecipientsSummarySchema.nullable(),
  state: documentStateSchema,
  /** Transmisión detenida: la lectura del cambio 7. */
  transmissionStopped: z.boolean(),
  documents: documentAvailabilitySchema,
});

/**
 * La guía de remisión (06) no tiene comprador ni total y sí destinatarios; los demás tipos, al revés.
 * La refinación lo exige en las dos direcciones.
 */
const receiverMatchesType = (
  item: Readonly<{
    documentType: string;
    buyer: unknown;
    total: unknown;
    recipients: Readonly<{ count: number; name: string | null }> | null;
  }>,
  ctx: z.RefinementCtx,
) => {
  const guide = item.documentType === "06";
  if (guide !== (item.buyer === null)) {
    ctx.addIssue({
      code: "custom",
      path: ["buyer"],
      message: "El comprador no corresponde al tipo.",
    });
  }
  if (guide !== (item.total === null)) {
    ctx.addIssue({ code: "custom", path: ["total"], message: "El total no corresponde al tipo." });
  }
  if (guide !== (item.recipients !== null)) {
    ctx.addIssue({
      code: "custom",
      path: ["recipients"],
      message: "Los destinatarios no corresponden al tipo.",
    });
  }
  if (item.recipients && (item.recipients.count === 1) !== (item.recipients.name !== null)) {
    ctx.addIssue({
      code: "custom",
      path: ["recipients", "name"],
      message: "El nombre es el del único destinatario.",
    });
  }
};

export const documentListItemSchema = documentListItemShape.superRefine(receiverMatchesType);
export type DocumentListItem = z.infer<typeof documentListItemSchema>;

export const documentListMetaSchema = listMetaSchema;

export const ARTIFACT_KINDS = ["SIGNED_XML", "AUTHORIZED_XML", "RIDE_PDF"] as const;
export const artifactKindSchema = z.enum(ARTIFACT_KINDS);
export type ArtifactKind = z.infer<typeof artifactKindSchema>;

/** Procedencia del RIDE: nunca se presenta un XML firmado como autorizado (design D3). */
export const RIDE_PROVENANCES = ["AUTHORIZED_XML", "SIGNED_XML_FALLBACK"] as const;

export const documentArtifactViewSchema = z.strictObject({
  kind: artifactKindSchema,
  sha256: z.string(),
  sizeBytes: z.number().int(),
  createdAt: z.string(),
  /** Solo en el RIDE. */
  provenance: z.enum(RIDE_PROVENANCES).nullable(),
});
export type DocumentArtifactView = z.infer<typeof documentArtifactViewSchema>;

/** Generación del RIDE: su estado y, si está detenida, el motivo y el momento. */
export const rideGenerationViewSchema = z.strictObject({
  status: rideStatusSchema,
  reason: z.string().nullable(),
  stoppedAt: z.string().nullable(),
  /** Se puede reintentar: autorizado, sin RIDE y con la generación detenida. */
  retryable: z.boolean(),
});
export type RideGenerationView = z.infer<typeof rideGenerationViewSchema>;

export const documentSummaryViewSchema = documentListItemShape
  .extend({
    artifacts: z.array(documentArtifactViewSchema),
    rideGeneration: rideGenerationViewSchema,
  })
  .superRefine(receiverMatchesType);
export type DocumentSummaryView = z.infer<typeof documentSummaryViewSchema>;

/**
 * Entregas observables (Q-24): una descarga servida o una solicitud de impresión. Nunca "impreso",
 * "entregado" ni "recibido"; el correo es P1.
 */
export const DELIVERY_EVENTS = ["DOWNLOAD", "PRINT_REQUESTED"] as const;
export const deliveryEventSchema = z.enum(DELIVERY_EVENTS);
export type DeliveryEvent = z.infer<typeof deliveryEventSchema>;
/** Etiquetas del glosario; la interfaz nunca muestra el código. */
export const DELIVERY_EVENT_LABELS: Record<DeliveryEvent, string> = {
  DOWNLOAD: "Descarga",
  PRINT_REQUESTED: "Solicitud de impresión",
};
export const ARTIFACT_KIND_LABELS: Record<ArtifactKind, string> = {
  RIDE_PDF: "RIDE",
  AUTHORIZED_XML: "XML autorizado",
  SIGNED_XML: "XML firmado",
};

export const deliveryViewSchema = z.strictObject({
  id: z.string(),
  event: deliveryEventSchema,
  artifactKind: artifactKindSchema,
  actorName: z.string(),
  occurredAt: z.string(),
});
export type DeliveryView = z.infer<typeof deliveryViewSchema>;

/** Las entregas más recientes de un comprobante y el total. */
export const DELIVERIES_PAGE_SIZE = 100;
export const documentDeliveriesViewSchema = z.strictObject({
  items: z.array(deliveryViewSchema),
  total: z.number().int(),
});
export type DocumentDeliveriesView = z.infer<typeof documentDeliveriesViewSchema>;

/** Solicitud de impresión registrada: la interfaz pide después el mismo RIDE. */
export const printRequestViewSchema = z.strictObject({
  id: z.string(),
  occurredAt: z.string(),
});
export type PrintRequestView = z.infer<typeof printRequestViewSchema>;

/** Rechazos de la bandeja y sus documentos (design D5 y D8). */
export const ARCHIVE_ERROR_CODES = [
  // `404`: el documento no existe o no está disponible para ese comprobante.
  "DOCUMENT_NOT_FOUND",
  "DOCUMENT_NOT_AVAILABLE",
  // `500`: los bytes guardados no coinciden con su hash o su tamaño; no se sirve nada.
  "ARTIFACT_INTEGRITY_FAILED",
  // `409`: reintento de la generación del RIDE.
  "RIDE_ALREADY_AVAILABLE",
  "RIDE_GENERATION_IN_PROGRESS",
  "DOCUMENT_NOT_AUTHORIZED",
] as const;
export type ArchiveErrorCode = (typeof ARCHIVE_ERROR_CODES)[number];

/** Tipos de medio de las descargas. */
export const RIDE_CONTENT_TYPES = ["application/pdf"] as const;
export const XML_CONTENT_TYPES = ["application/xml"] as const;
