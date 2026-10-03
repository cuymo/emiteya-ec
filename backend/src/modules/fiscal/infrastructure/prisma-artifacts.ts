// Artefactos de los comprobantes en PostgreSQL (ADR 0010; add-invoice-emission, design D9): BYTEA
// con los bytes exactos, su SHA-256 y su tamaño. De solo agregado: un trigger impide cambiarlos o
// borrarlos y `UNIQUE (document_id, kind)` impide dos del mismo tipo.
import { createHash } from "node:crypto";
import type { Prisma } from "../../../generated/prisma/client.ts";
import type { DbClient } from "../../../platform/db/database.ts";
import type {
  ArtifactMetadata,
  ArtifactStore,
  ArtifactSummary,
  StoredArtifact,
} from "../application/ports.ts";
import type { ArtifactKind } from "../domain/document.ts";

type Row = {
  id: string;
  kind: string;
  mediaType: string;
  sha256: string;
  sizeBytes: number;
  metadata: unknown;
  createdAt: Date;
};

const toSummary = (row: Row): ArtifactSummary => ({
  id: row.id,
  kind: row.kind as ArtifactKind,
  mediaType: row.mediaType,
  sha256: row.sha256,
  sizeBytes: row.sizeBytes,
  metadata: row.metadata as ArtifactMetadata,
  createdAt: row.createdAt,
});

const SUMMARY = {
  id: true,
  kind: true,
  mediaType: true,
  sha256: true,
  sizeBytes: true,
  metadata: true,
  createdAt: true,
} as const;

export function createArtifactStore(db: DbClient): ArtifactStore {
  return {
    async save(artifact) {
      const row = await db.documentArtifact.create({
        data: {
          companyId: artifact.companyId,
          documentId: artifact.documentId,
          kind: artifact.kind,
          mediaType: artifact.mediaType,
          content: new Uint8Array(artifact.content),
          sizeBytes: artifact.content.length,
          sha256: createHash("sha256").update(artifact.content).digest("hex"),
          metadata: artifact.metadata as Prisma.InputJsonObject,
        },
        select: SUMMARY,
      });
      return toSummary(row);
    },

    async summary(companyId, documentId, kind) {
      const row = await db.documentArtifact.findFirst({
        where: { companyId, documentId, kind },
        select: SUMMARY,
      });
      return row ? toSummary(row) : null;
    },

    async read(companyId, documentId, kind): Promise<StoredArtifact | null> {
      const row = await db.documentArtifact.findFirst({ where: { companyId, documentId, kind } });
      return row ? { ...toSummary(row), content: Buffer.from(row.content) } : null;
    },
  };
}
