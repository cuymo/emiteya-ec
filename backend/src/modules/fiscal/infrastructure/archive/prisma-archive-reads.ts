// Lecturas de la bandeja sobre Prisma (add-document-archive, design D2): una consulta paginada con
// los artefactos y el último job del RIDE de cada comprobante, y una lectura de las transmisiones
// detenidas de la página; sin N+1 y siempre filtradas por empresa. Nunca leen bytes.
import type { Prisma } from "../../../../generated/prisma/client.ts";
import type { DbClient } from "../../../../platform/db/database.ts";
import { FiscalDecimal } from "../../../../platform/decimal/fiscal-decimal.ts";
import type {
  ArchiveDocument,
  ArchiveFilters,
  ArchiveReads,
  ArchiveRideJob,
} from "../../application/archive/archive-ports.ts";
import { RIDE_JOB_TYPE } from "../../application/archive/ride-jobs.ts";
import type { ArtifactKind, DocumentState } from "../../domain/document.ts";
import type { DocumentType } from "../../domain/numbering.ts";
import { createTransmissionReader } from "../prisma-transmission-reads.ts";

const SELECT = {
  id: true,
  companyId: true,
  documentType: true,
  documentNumber: true,
  issueDate: true,
  buyerName: true,
  buyerIdentification: true,
  total: true,
  state: true,
  // Los destinatarios de una guía (design D10): el nombre del único y el conteo, sin el snapshot.
  recipients: { select: { name: true }, orderBy: { position: "asc" }, take: 2 },
  _count: { select: { recipients: true } },
  artifacts: {
    select: { kind: true, sha256: true, sizeBytes: true, createdAt: true, metadata: true },
    orderBy: { createdAt: "asc" },
  },
  jobs: {
    where: { type: RIDE_JOB_TYPE },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 1,
    select: { status: true, lastErrorCode: true, completedAt: true },
  },
} satisfies Prisma.ElectronicDocumentSelect;

type Row = Prisma.ElectronicDocumentGetPayload<{ select: typeof SELECT }>;

const provenanceOf = (metadata: unknown): string | null => {
  if (typeof metadata !== "object" || metadata === null) return null;
  const source = (metadata as { source?: unknown }).source;
  if (typeof source !== "object" || source === null) return null;
  const provenance = (source as { provenance?: unknown }).provenance;
  return typeof provenance === "string" ? provenance : null;
};

const toDocument = (row: Row, stopped: ReadonlySet<string>): ArchiveDocument => ({
  id: row.id,
  companyId: row.companyId,
  documentType: row.documentType as DocumentType,
  documentNumber: row.documentNumber,
  issueDate: row.issueDate.toISOString().slice(0, 10),
  buyerName: row.buyerName,
  buyerIdentification: row.buyerIdentification,
  total: row.total === null ? null : FiscalDecimal.fromDatabase("importe", row.total).toString(),
  recipients:
    row._count.recipients > 0
      ? {
          count: row._count.recipients,
          name: row._count.recipients === 1 ? (row.recipients[0]?.name ?? null) : null,
        }
      : null,
  state: row.state as DocumentState,
  artifacts: row.artifacts.map((artifact) => ({
    kind: artifact.kind as ArtifactKind,
    sha256: artifact.sha256,
    sizeBytes: artifact.sizeBytes,
    createdAt: artifact.createdAt,
    provenance: artifact.kind === "RIDE_PDF" ? provenanceOf(artifact.metadata) : null,
  })),
  rideJob: (row.jobs[0] as ArchiveRideJob | undefined) ?? null,
  transmissionStopped: stopped.has(row.id),
});

function whereOf(companyId: string, filters: ArchiveFilters): Prisma.ElectronicDocumentWhereInput {
  const search = filters.search?.trim();
  return {
    companyId,
    ...(filters.from || filters.to
      ? {
          issueDate: {
            ...(filters.from ? { gte: new Date(`${filters.from}T00:00:00Z`) } : {}),
            ...(filters.to ? { lte: new Date(`${filters.to}T00:00:00Z`) } : {}),
          },
        }
      : {}),
    ...(filters.documentType ? { documentType: filters.documentType } : {}),
    ...(filters.state ? { state: filters.state } : {}),
    ...(filters.establishmentId ? { establishmentId: filters.establishmentId } : {}),
    ...(filters.emissionPointId ? { emissionPointId: filters.emissionPointId } : {}),
    ...(filters.documentIds ? { id: { in: [...filters.documentIds] } } : {}),
    AND: [
      // La identificación del receptor encuentra una guía por cualquiera de sus destinatarios
      // (design D10), con el índice por identificación de cada tabla.
      ...(filters.identification
        ? [
            {
              OR: [
                { buyerIdentification: filters.identification },
                { recipients: { some: { identification: filters.identification } } },
              ],
            },
          ]
        : []),
      ...(search
        ? [
            {
              // Número, nombre o identificación del receptor, también de cualquier destinatario de
              // una guía (refine-archive-search).
              OR: [
                { documentNumber: { contains: search } },
                { buyerName: { contains: search, mode: "insensitive" as const } },
                { buyerIdentification: { contains: search } },
                {
                  recipients: {
                    some: {
                      OR: [
                        { name: { contains: search, mode: "insensitive" as const } },
                        { identification: { contains: search } },
                      ],
                    },
                  },
                },
              ],
            },
          ]
        : []),
    ],
  };
}

export function createArchiveReads(db: DbClient): ArchiveReads {
  const transmission = createTransmissionReader(db);
  return {
    async list(companyId, filters) {
      const where = whereOf(companyId, filters);
      const [rows, total] = await Promise.all([
        db.electronicDocument.findMany({
          where,
          select: SELECT,
          // Dentro de un mismo día, el emitido después va primero; el identificador solo desempata.
          orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
          skip: (filters.page - 1) * filters.pageSize,
          take: filters.pageSize,
        }),
        db.electronicDocument.count({ where }),
      ]);
      const stopped = await transmission.stoppedAmong(
        companyId,
        rows.map((row) => row.id),
      );
      return { items: rows.map((row) => toDocument(row, stopped)), total };
    },

    async find(companyId, documentId) {
      const row = await db.electronicDocument.findFirst({
        where: { companyId, id: documentId },
        select: SELECT,
      });
      if (!row) return null;
      return toDocument(row, await transmission.stoppedAmong(companyId, [row.id]));
    },
  };
}
