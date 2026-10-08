// Portabilidad de datos (add-data-portability, design D10 y D17): la solicitud de una exportación,
// su vista con el estado explícito, la fase, el progreso y el paquete, la lista y los códigos. El
// formato del paquete es `PORTABILITY_FORMAT_V1` (Q-28); se documenta en
// docs/architecture/data-portability-format.md.
import { z } from "zod";
import { listMetaSchema, pageParams } from "./pagination.ts";

export const PORTABILITY_FORMAT_VERSION = "1";

export const DATA_EXPORT_STATUSES = ["QUEUED", "GENERATING", "READY", "FAILED", "EXPIRED"] as const;
export type DataExportStatus = (typeof DATA_EXPORT_STATUSES)[number];
/** Etiquetas de la pantalla; la interfaz nunca muestra el código. */
export const DATA_EXPORT_STATUS_LABELS: Record<DataExportStatus, string> = {
  QUEUED: "En cola",
  GENERATING: "Generando",
  READY: "Lista",
  FAILED: "Fallida",
  EXPIRED: "Expirada",
};

/** Fases mientras se genera: el progreso se informa por fase, nunca como un porcentaje estimado. */
export const DATA_EXPORT_PHASES = ["SNAPSHOT", "ARTIFACTS", "PUBLISHING"] as const;
export type DataExportPhase = (typeof DATA_EXPORT_PHASES)[number];
export const DATA_EXPORT_PHASE_LABELS: Record<DataExportPhase, string> = {
  SNAPSHOT: "Preparando los datos",
  ARTIFACTS: "Agregando los comprobantes",
  PUBLISHING: "Cerrando el paquete",
};

/** Códigos seguros de una exportación fallida: nunca llevan rutas ni detalles internos. */
export const DATA_EXPORT_FAILURE_CODES = [
  // Un artefacto, una respuesta del SRI o un logo no coincide con su tamaño o su SHA-256.
  "DATA_EXPORT_ARTIFACT_INTEGRITY",
  // Falta un artefacto que el estado del comprobante exige.
  "DATA_EXPORT_ARTIFACT_MISSING",
  // El disco no tiene la reserva necesaria, antes de copiar o a mitad del paquete.
  "DATA_EXPORT_INSUFFICIENT_SPACE",
  // La lectura consistente de la base superó su plazo.
  "DATA_EXPORT_SNAPSHOT_TIMEOUT",
  // Un límite del formato, como un libro de más de 4 GiB sin comprimir.
  "DATA_EXPORT_LIMIT",
  // Se agotaron los intentos de la generación.
  "DATA_EXPORT_FAILED",
  // El paquete listo desapareció o no tiene su tamaño antes de caducar.
  "DATA_EXPORT_PACKAGE_MISSING",
  // El paquete listo no coincide con su SHA-256 antes de caducar.
  "DATA_EXPORT_PACKAGE_INTEGRITY",
] as const;
export type DataExportFailureCode = (typeof DATA_EXPORT_FAILURE_CODES)[number];

/** Motivos de la caducidad: solo el vencimiento o el reemplazo por un paquete nuevo. */
export const DATA_EXPORT_EXPIRED_REASONS = ["TTL", "REPLACED"] as const;
export type DataExportExpiredReason = (typeof DATA_EXPORT_EXPIRED_REASONS)[number];

export const DATA_EXPORT_ERROR_CODES = [
  // `409`: ya hay una generación en cola o generándose para la empresa.
  "DATA_EXPORT_IN_PROGRESS",
  // `409`: la exportación todavía no está lista o falló.
  "DATA_EXPORT_NOT_READY",
  // `410`: el paquete caducó; hay que generar uno nuevo.
  "DATA_EXPORT_EXPIRED",
  // `404`: no existe en la empresa de la sesión.
  "DATA_EXPORT_NOT_FOUND",
  // `500`: el paquete listo falta o no coincide; no se envía ningún byte.
  "DATA_EXPORT_PACKAGE_MISSING",
  "DATA_EXPORT_PACKAGE_INTEGRITY",
] as const;
export type DataExportErrorCode = (typeof DATA_EXPORT_ERROR_CODES)[number];

export const DATA_EXPORT_CONTENT_TYPES = ["application/zip"] as const;

/** La solicitud no lleva datos: la empresa sale de la sesión y un `companyId` se rechaza. */
export const createDataExportSchema = z.strictObject({});
export const dataExportIdParamsSchema = z.strictObject({ id: z.string().min(1) });
export const listDataExportsQuerySchema = z.strictObject({ ...pageParams });
export type ListDataExportsQuery = z.infer<typeof listDataExportsQuerySchema>;

const count = z.number().int().nonnegative();
/** Conteos del paquete listo; los comprobantes, por ambiente (design D7). */
export const dataExportCountsSchema = z.strictObject({
  documentsTest: count,
  documentsProduction: count,
  files: count,
  parties: count,
  products: count,
  stockMovements: count,
  auditEvents: count,
  users: count,
});
export type DataExportCounts = z.infer<typeof dataExportCountsSchema>;

const moment = z.iso.datetime();
export const dataExportViewSchema = z.strictObject({
  id: z.string(),
  status: z.enum(DATA_EXPORT_STATUSES),
  phase: z.enum(DATA_EXPORT_PHASES).nullable(),
  /** Comprobantes agregados de su total; solo cuando se conoce el total. */
  progress: z.strictObject({ done: count, total: count }).nullable(),
  requestedBy: z.strictObject({ name: z.string() }),
  requestedAt: moment,
  startedAt: moment.nullable(),
  snapshotAt: moment.nullable(),
  generatedAt: moment.nullable(),
  /** 24 horas después de quedar lista, no de la solicitud. */
  expiresAt: moment.nullable(),
  finishedAt: moment.nullable(),
  /** Tamaño del paquete en bytes, como texto decimal. */
  sizeBytes: z
    .string()
    .regex(/^[1-9]\d*$/)
    .nullable(),
  sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
  formatVersion: z.literal(PORTABILITY_FORMAT_VERSION),
  counts: dataExportCountsSchema.nullable(),
  errorCode: z.enum(DATA_EXPORT_FAILURE_CODES).nullable(),
  expiredReason: z.enum(DATA_EXPORT_EXPIRED_REASONS).nullable(),
});
export type DataExportView = z.infer<typeof dataExportViewSchema>;

export const dataExportListMetaSchema = listMetaSchema;
export const dataExportListViewSchema = z.strictObject({
  data: z.array(dataExportViewSchema),
  meta: dataExportListMetaSchema,
});
