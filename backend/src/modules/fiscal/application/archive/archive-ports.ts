// Modelo de lectura de la bandeja de comprobantes (add-document-archive, design D2): comprobantes
// de una empresa con sus artefactos, la generación de su RIDE y su transmisión, sin bytes.
import type { NewJob } from "../../../../platform/jobs/jobs.ts";
import type { DocumentType } from "../../domain/numbering.ts";
import type { ArtifactKind, DocumentState } from "../../domain/document.ts";

export type ArchiveFilters = Readonly<{
  from?: string | undefined;
  to?: string | undefined;
  documentType?: DocumentType | undefined;
  state?: DocumentState | undefined;
  identification?: string | undefined;
  search?: string | undefined;
  establishmentId?: string | undefined;
  emissionPointId?: string | undefined;
  page: number;
  pageSize: number;
}>;

export type ArchiveArtifact = Readonly<{
  kind: ArtifactKind;
  sha256: string;
  sizeBytes: number;
  createdAt: Date;
  /** Solo en el RIDE: `AUTHORIZED_XML` o `SIGNED_XML_FALLBACK`. */
  provenance: string | null;
}>;

/** Último job del RIDE del comprobante, si existe. */
export type ArchiveRideJob = Readonly<{
  status: "PENDING" | "LEASED" | "DONE" | "STOPPED";
  lastErrorCode: string | null;
  completedAt: Date | null;
}>;

export type ArchiveDocument = Readonly<{
  id: string;
  companyId: string;
  documentType: DocumentType;
  documentNumber: string;
  issueDate: string;
  buyerName: string;
  buyerIdentification: string;
  total: string;
  state: DocumentState;
  artifacts: readonly ArchiveArtifact[];
  rideJob: ArchiveRideJob | null;
  transmissionStopped: boolean;
}>;

export interface ArchiveReads {
  list(
    companyId: string,
    filters: ArchiveFilters,
  ): Promise<{ items: ArchiveDocument[]; total: number }>;
  find(companyId: string, documentId: string): Promise<ArchiveDocument | null>;
}

/** Transacción del reintento: bloquea el comprobante y encola el job manual juntos. */
export type RideRetryScope = Readonly<{
  /** Bloquea la fila del comprobante y lo devuelve, o null si no es de la empresa. */
  lockDocument(
    companyId: string,
    documentId: string,
  ): Promise<Readonly<{ id: string; companyId: string; state: DocumentState }> | null>;
  hasRide(companyId: string, documentId: string): Promise<boolean>;
  latestRideJob(companyId: string, documentId: string): Promise<ArchiveRideJob | null>;
  /** Encola el job; false si ya hay uno activo con su clave. */
  enqueue(job: NewJob): Promise<boolean>;
}>;

export interface RideRetryUnitOfWork {
  run<T>(work: (scope: RideRetryScope) => Promise<T>): Promise<T>;
}
