// Comprobantes electrónicos y su historial sobre Prisma (add-invoice-emission, design D3, D9 y D10).
// Los triggers de la base de datos impiden cambiar los datos fiscales, volver de SIGNED, borrar o
// dejar un SIGNED sin artefacto; este repositorio solo escribe lo que la máquina local permite.
import { Prisma } from "../../../generated/prisma/client.ts";
import type { DbClient } from "../../../platform/db/database.ts";
import { FiscalDecimal } from "../../../platform/decimal/fiscal-decimal.ts";
import type { DocumentRepository, StoredDocument } from "../application/ports.ts";
import type { AttemptClass, AttemptDetail, DocumentState } from "../domain/document.ts";
import type { DocumentType } from "../domain/numbering.ts";

type Row = {
  id: string;
  companyId: string;
  documentType: string;
  environment: string;
  establishmentId: string;
  emissionPointId: string;
  documentNumber: string;
  sequential: number;
  reservationId: string;
  accessKey: string;
  numericCode: string;
  issueDate: Date;
  state: string;
  snapshot: unknown;
  schemaVersion: string;
  buyerIdentification: string;
  buyerName: string;
  total: { toFixed(): string };
  createdAt: Date;
  createdBy: string;
  signedAt: Date | null;
  lastAttemptStage: string | null;
  lastAttemptCode: string | null;
  lastAttemptClass: string | null;
  lastAttemptAt: Date | null;
  lastAttemptDetail: unknown;
  attemptCount: number;
  attemptLeaseUntil: Date | null;
  authorizationNumber: string | null;
  authorizationDate: Date | null;
  authorizationEnvironment: string | null;
};

const toStored = (row: Row): StoredDocument => ({
  id: row.id,
  companyId: row.companyId,
  documentType: row.documentType as DocumentType,
  environment: row.environment as StoredDocument["environment"],
  establishmentId: row.establishmentId,
  emissionPointId: row.emissionPointId,
  documentNumber: row.documentNumber,
  sequential: row.sequential,
  reservationId: row.reservationId,
  accessKey: row.accessKey,
  numericCode: row.numericCode,
  issueDate: row.issueDate.toISOString().slice(0, 10),
  state: row.state as DocumentState,
  snapshot: row.snapshot,
  schemaVersion: row.schemaVersion,
  buyerIdentification: row.buyerIdentification,
  buyerName: row.buyerName,
  total: FiscalDecimal.fromDatabase("importe", row.total).toString(),
  createdAt: row.createdAt,
  createdBy: row.createdBy,
  signedAt: row.signedAt,
  lastAttempt:
    row.lastAttemptStage && row.lastAttemptCode && row.lastAttemptClass && row.lastAttemptAt
      ? {
          stage: row.lastAttemptStage,
          code: row.lastAttemptCode,
          class: row.lastAttemptClass as AttemptClass,
          at: row.lastAttemptAt,
          detail: (row.lastAttemptDetail as AttemptDetail | null) ?? null,
        }
      : null,
  attemptCount: row.attemptCount,
  attemptLeaseUntil: row.attemptLeaseUntil,
  authorization:
    row.authorizationNumber && row.authorizationDate && row.authorizationEnvironment
      ? {
          number: row.authorizationNumber,
          date: row.authorizationDate,
          environment: row.authorizationEnvironment as StoredDocument["environment"],
        }
      : null,
});

export function createDocumentRepository(db: DbClient): DocumentRepository {
  return {
    async insertReserved(document) {
      const row = await db.electronicDocument.create({
        data: {
          companyId: document.companyId,
          documentType: document.documentType,
          environment: document.environment,
          establishmentId: document.establishmentId,
          emissionPointId: document.emissionPointId,
          documentNumber: document.documentNumber,
          sequential: document.sequential,
          reservationId: document.reservationId,
          accessKey: document.accessKey,
          numericCode: document.numericCode,
          issueDate: new Date(`${document.issueDate}T00:00:00Z`),
          state: "RESERVED",
          snapshot: document.snapshot as object,
          schemaVersion: document.schemaVersion,
          buyerIdentification: document.buyerIdentification,
          buyerName: document.buyerName,
          total: FiscalDecimal.parse("importe", document.total).toDatabase(),
          createdBy: document.createdBy,
        },
      });
      return toStored(row);
    },

    async recordTransition(transition) {
      await db.documentStateTransition.create({
        data: {
          companyId: transition.companyId,
          documentId: transition.documentId,
          fromState: transition.from,
          toState: transition.to,
          cause: transition.cause,
          actorType: transition.actor.type,
          actorUserId: transition.actor.type === "USER" ? transition.actor.userId : null,
          ...(transition.metadata ? { metadata: transition.metadata } : {}),
        },
      });
    },

    async find(companyId, documentId) {
      const row = await db.electronicDocument.findFirst({ where: { id: documentId, companyId } });
      return row ? toStored(row) : null;
    },

    async lock(companyId, documentId) {
      // Un UPDATE sin cambios toma el mismo bloqueo de fila que SELECT … FOR UPDATE, con las
      // consultas del modelo: el adapter no califica el SQL crudo con el esquema.
      await db.electronicDocument.updateMany({
        where: { id: documentId, companyId },
        data: { companyId },
      });
      const row = await db.electronicDocument.findFirst({ where: { id: documentId, companyId } });
      return row ? toStored(row) : null;
    },

    async list(companyId, query) {
      const search = query.search?.trim();
      const where = {
        companyId,
        documentType: query.documentType,
        ...(query.state ? { state: query.state } : {}),
        AND: [
          ...(search
            ? [
                {
                  OR: [
                    { documentNumber: { contains: search } },
                    { buyerIdentification: { contains: search } },
                    { buyerName: { contains: search, mode: "insensitive" as const } },
                  ],
                },
              ]
            : []),
          ...(query.attention
            ? [
                {
                  OR: [
                    { state: { in: [...query.attention.states] } },
                    { id: { in: [...query.attention.documentIds] } },
                  ],
                },
              ]
            : []),
        ],
      };
      const [rows, total] = await Promise.all([
        db.electronicDocument.findMany({
          where,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        db.electronicDocument.count({ where }),
      ]);
      return { items: rows.map(toStored), total };
    },

    async acquireAttemptLease(companyId, documentId, now, until) {
      const { count } = await db.electronicDocument.updateMany({
        where: {
          id: documentId,
          companyId,
          state: "RESERVED",
          OR: [{ attemptLeaseUntil: null }, { attemptLeaseUntil: { lt: now } }],
        },
        data: { attemptLeaseUntil: until },
      });
      return count > 0;
    },

    async recordAttemptFailure(companyId, documentId, diagnostic) {
      await db.electronicDocument.updateMany({
        where: { id: documentId, companyId, state: "RESERVED" },
        data: {
          lastAttemptStage: diagnostic.stage,
          lastAttemptCode: diagnostic.code,
          lastAttemptClass: diagnostic.class,
          lastAttemptAt: diagnostic.at,
          lastAttemptDetail: diagnostic.detail ?? Prisma.DbNull,
          attemptCount: { increment: 1 },
          attemptLeaseUntil: null,
        },
      });
    },

    async markSigned(companyId, documentId, signedAt) {
      const { count } = await db.electronicDocument.updateMany({
        where: { id: documentId, companyId, state: "RESERVED" },
        data: {
          state: "SIGNED",
          signedAt,
          attemptCount: { increment: 1 },
          attemptLeaseUntil: null,
        },
      });
      return count > 0;
    },
  };
}
