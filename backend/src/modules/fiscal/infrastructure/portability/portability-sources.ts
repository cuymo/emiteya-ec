// Fuentes de portabilidad de los comprobantes (add-data-portability, design D1, D4, D12 y D13). Los
// comprobantes de los seis tipos desde la reserva, en los dos ambientes y en todos sus estados, con
// lo que congelaron, sus importes por tipo (las proyecciones del cambio 15), su autorización y el
// inventario de sus artefactos y de las respuestas originales de sus intentos con el SRI; sus
// transiciones, sus intentos, sus destinatarios y sus entregas; y los secuenciales. El orden de los
// comprobantes es el de las carpetas del paquete: ambiente, tipo y número. Las lecturas por
// identificador devuelven los bytes conservados con su tamaño y su SHA-256, que la fase 2 recalcula.
import { canonicalDecimal } from "@facturador/contracts";
import { Prisma } from "../../../../generated/prisma/client.ts";
import type { DbClient } from "../../../../platform/db/database.ts";
import { qualifiedTable, sqlCompanyBatches } from "../../../../platform/db/report-source.ts";
import type { ReportAmountProjection } from "../reports/amount-projections.ts";
import { byType, checkProjections } from "../reports/document-sources.ts";

type Environment = "TEST" | "PRODUCTION";
type ArtifactKind = "SIGNED_XML" | "AUTHORIZED_XML" | "RIDE_PDF";
const decimal = (text: string | null) => (text === null ? null : canonicalDecimal(text));

type DocumentRaw = {
  id: string;
  environment: string;
  document_type: string;
  document_number: string;
  access_key: string;
  issue_date: string;
  state: string;
  buyer_identification: string | null;
  buyer_name: string | null;
  recipient_count: number | null;
  recipient_identification: string | null;
  recipient_name: string | null;
  subtotal: string | null;
  taxes: string | null;
  total: string | null;
  authorization_number: string | null;
  authorization_date: Date | null;
  snapshot_version: number | null;
  schema_version: string;
  snapshot_bytes: number;
  artifacts: { id: string; kind: ArtifactKind; sizeBytes: number; sha256: string }[];
  responses: {
    attemptId: string;
    attemptNumber: number;
    operation: string;
    contentType: string | null;
    truncated: boolean;
    sizeBytes: number;
    sha256: string;
  }[];
  ride_job_status: string | null;
};

type AttemptRaw = {
  access_key: string;
  attempt_number: number;
  operation: string;
  environment: string;
  started_at: Date;
  completed_at: Date;
  transport_outcome: string;
  http_status: number | null;
  outcome: string | null;
  messages: unknown;
  response_content_type: string | null;
  response_truncated: boolean | null;
  response_size: number | null;
  response_sha256: string | null;
  envelope_sha256: string;
  envelope_size: number;
  initiated_by: string | null;
};

export function createFiscalPortabilitySources(
  schema: string,
  projections: readonly ReportAmountProjection[],
) {
  checkProjections(projections);
  const documents = qualifiedTable(schema, "electronic_document");
  const recipients = qualifiedTable(schema, "electronic_document_recipient");
  const artifacts = qualifiedTable(schema, "document_artifact");
  const attempts = qualifiedTable(schema, "sri_attempt");
  const responses = qualifiedTable(schema, "sri_response");
  const results = qualifiedTable(schema, "sri_attempt_result");
  const transitions = qualifiedTable(schema, "document_state_transition");
  const deliveries = qualifiedTable(schema, "document_delivery_event");
  const jobs = qualifiedTable(schema, "job");
  const sequences = qualifiedTable(schema, "fiscal_sequence");
  const subtotal = byType(projections, (projection) => projection.subtotal);
  const taxes = byType(projections, (projection) => projection.taxes);

  return {
    sequences: sqlCompanyBatches({
      query: (companyId) => ({
        select: Prisma.sql`s.environment, s.establishment_id, s.emission_point_id, s.document_type,
          s.next_number, s.last_reserved, s.updated_at`,
        from: Prisma.sql`${sequences} s WHERE s.company_id = ${companyId}`,
        orderBy: Prisma.sql`s.environment, s.establishment_id, s.emission_point_id, s.document_type`,
      }),
      map: (raw: {
        environment: string;
        establishment_id: string;
        emission_point_id: string;
        document_type: string;
        next_number: number;
        last_reserved: number | null;
        updated_at: Date;
      }) => ({
        environment: raw.environment as Environment,
        establishmentId: raw.establishment_id,
        emissionPointId: raw.emission_point_id,
        documentType: raw.document_type,
        nextNumber: raw.next_number,
        lastReserved: raw.last_reserved,
        updatedAt: raw.updated_at,
      }),
    }),

    documents: sqlCompanyBatches({
      query: (companyId) => ({
        select: Prisma.sql`d.id, d.environment, d.document_type, d.document_number, d.access_key,
          to_char(d.issue_date, 'YYYY-MM-DD') AS issue_date, d.state,
          d.buyer_identification, d.buyer_name,
          r.recipient_count, r.recipient_identification, r.recipient_name,
          (${subtotal})::text AS subtotal, (${taxes})::text AS taxes, d.total::text AS total,
          d.authorization_number, d.authorization_date,
          (d.snapshot ->> 'snapshotVersion')::int AS snapshot_version, d.schema_version,
          octet_length(d.snapshot::text) AS snapshot_bytes,
          COALESCE(a.artifacts, '[]'::json) AS artifacts,
          COALESCE(t.responses, '[]'::json) AS responses,
          j.status AS ride_job_status`,
        from: Prisma.sql`${documents} d
          LEFT JOIN LATERAL (
            SELECT count(*)::int AS recipient_count,
                   min(er.identification) AS recipient_identification,
                   min(er.name) AS recipient_name
            FROM ${recipients} er
            WHERE er.company_id = d.company_id AND er.document_id = d.id
          ) r ON d.document_type = '06'
          LEFT JOIN LATERAL (
            SELECT json_agg(json_build_object('id', x.id, 'kind', x.kind,
                     'sizeBytes', x.size_bytes, 'sha256', x.sha256) ORDER BY x.kind) AS artifacts
            FROM ${artifacts} x
            WHERE x.company_id = d.company_id AND x.document_id = d.id
          ) a ON true
          LEFT JOIN LATERAL (
            SELECT json_agg(json_build_object('attemptId', at.id,
                     'attemptNumber', at.attempt_number, 'operation', at.operation,
                     'contentType', sr.content_type, 'truncated', sr.truncated,
                     'sizeBytes', sr.size_bytes, 'sha256', sr.sha256)
                   ORDER BY at.attempt_number) AS responses
            FROM ${attempts} at
            JOIN ${responses} sr ON sr.company_id = at.company_id AND sr.attempt_id = at.id
            WHERE at.company_id = d.company_id AND at.document_id = d.id
          ) t ON true
          LEFT JOIN LATERAL (
            SELECT jb.status FROM ${jobs} jb
            WHERE jb.company_id = d.company_id AND jb.document_id = d.id
              AND jb.type = 'document.render_ride'
            ORDER BY jb.created_at DESC, jb.id DESC
            LIMIT 1
          ) j ON d.state = 'AUTHORIZED'
          WHERE d.company_id = ${companyId}`,
        orderBy: Prisma.sql`d.environment, d.document_type, d.document_number COLLATE "C", d.id`,
      }),
      map: (raw: DocumentRaw) => {
        const guide = raw.document_type === "06";
        const count = guide ? (raw.recipient_count ?? 0) : null;
        return {
          id: raw.id,
          environment: raw.environment as Environment,
          documentType: raw.document_type,
          documentNumber: raw.document_number,
          accessKey: raw.access_key,
          issueDate: raw.issue_date,
          state: raw.state,
          counterpartIdentification: guide
            ? count === 1
              ? raw.recipient_identification
              : null
            : raw.buyer_identification,
          counterpartName: guide ? (count === 1 ? raw.recipient_name : null) : raw.buyer_name,
          recipientCount: count,
          subtotal: decimal(raw.subtotal),
          taxes: decimal(raw.taxes),
          total: decimal(raw.total),
          authorizationNumber: raw.authorization_number,
          authorizationDate: raw.authorization_date,
          snapshotVersion: raw.snapshot_version,
          schemaVersion: raw.schema_version,
          snapshotBytes: raw.snapshot_bytes,
          artifacts: raw.artifacts,
          responses: raw.responses,
          rideJobStatus: raw.ride_job_status,
        };
      },
    }),

    transitions: sqlCompanyBatches({
      query: (companyId) => ({
        select: Prisma.sql`d.access_key, t.from_state, t.to_state, t.cause, t.actor_type,
          t.actor_user_id, t.occurred_at`,
        from: Prisma.sql`${transitions} t
          JOIN ${documents} d ON d.company_id = t.company_id AND d.id = t.document_id
          WHERE t.company_id = ${companyId}`,
        orderBy: Prisma.sql`d.environment, d.document_type, d.document_number, t.occurred_at, t.id`,
      }),
      map: (raw: {
        access_key: string;
        from_state: string | null;
        to_state: string;
        cause: string;
        actor_type: string;
        actor_user_id: string | null;
        occurred_at: Date;
      }) => ({
        accessKey: raw.access_key,
        fromState: raw.from_state,
        toState: raw.to_state,
        cause: raw.cause,
        actorType: raw.actor_type,
        actorUserId: raw.actor_user_id,
        occurredAt: raw.occurred_at,
      }),
    }),

    attempts: sqlCompanyBatches({
      query: (companyId) => ({
        select: Prisma.sql`d.access_key, at.attempt_number, at.operation, at.environment,
          at.started_at, at.completed_at, at.transport_outcome, at.http_status,
          rs.outcome, rs.messages, sr.content_type AS response_content_type,
          sr.truncated AS response_truncated, sr.size_bytes AS response_size,
          sr.sha256 AS response_sha256, at.envelope_sha256, at.envelope_size, at.initiated_by`,
        from: Prisma.sql`${attempts} at
          JOIN ${documents} d ON d.company_id = at.company_id AND d.id = at.document_id
          LEFT JOIN ${responses} sr ON sr.company_id = at.company_id AND sr.attempt_id = at.id
          LEFT JOIN ${results} rs ON rs.company_id = at.company_id AND rs.attempt_id = at.id
          WHERE at.company_id = ${companyId}`,
        orderBy: Prisma.sql`d.environment, d.document_type, d.document_number, at.attempt_number`,
      }),
      map: (raw: AttemptRaw) => ({
        accessKey: raw.access_key,
        attemptNumber: raw.attempt_number,
        operation: raw.operation,
        environment: raw.environment as Environment,
        startedAt: raw.started_at,
        completedAt: raw.completed_at,
        transportOutcome: raw.transport_outcome,
        httpStatus: raw.http_status,
        outcome: raw.outcome,
        messages: raw.messages,
        response:
          raw.response_sha256 === null
            ? null
            : {
                contentType: raw.response_content_type,
                truncated: raw.response_truncated === true,
                sizeBytes: raw.response_size ?? 0,
                sha256: raw.response_sha256,
              },
        envelopeSha256: raw.envelope_sha256,
        envelopeSize: raw.envelope_size,
        initiatedBy: raw.initiated_by,
      }),
    }),

    recipients: sqlCompanyBatches({
      query: (companyId) => ({
        select: Prisma.sql`d.access_key, er.position, er.identification, er.name`,
        from: Prisma.sql`${recipients} er
          JOIN ${documents} d ON d.company_id = er.company_id AND d.id = er.document_id
          WHERE er.company_id = ${companyId}`,
        orderBy: Prisma.sql`d.environment, d.document_type, d.document_number, er.position`,
      }),
      map: (raw: {
        access_key: string;
        position: number;
        identification: string;
        name: string;
      }) => ({
        accessKey: raw.access_key,
        position: raw.position,
        identification: raw.identification,
        name: raw.name,
      }),
    }),

    deliveries: sqlCompanyBatches({
      query: (companyId) => ({
        select: Prisma.sql`d.access_key, e.event, e.artifact_kind, e.artifact_sha256,
          e.actor_user_id, e.occurred_at`,
        from: Prisma.sql`${deliveries} e
          JOIN ${documents} d ON d.company_id = e.company_id AND d.id = e.document_id
          WHERE e.company_id = ${companyId}`,
        orderBy: Prisma.sql`e.occurred_at, e.id`,
      }),
      map: (raw: {
        access_key: string;
        event: string;
        artifact_kind: string;
        artifact_sha256: string;
        actor_user_id: string;
        occurred_at: Date;
      }) => ({
        accessKey: raw.access_key,
        event: raw.event,
        artifactKind: raw.artifact_kind,
        artifactSha256: raw.artifact_sha256,
        actorUserId: raw.actor_user_id,
        occurredAt: raw.occurred_at,
      }),
    }),

    /** El snapshot congelado de un comprobante de la empresa; es inmutable. */
    async readSnapshot(db: DbClient, companyId: string, documentId: string): Promise<unknown> {
      const row = await db.electronicDocument.findFirst({
        where: { companyId, id: documentId },
        select: { snapshot: true },
      });
      return row?.snapshot ?? null;
    },

    async readArtifact(db: DbClient, companyId: string, artifactId: string) {
      const row = await db.documentArtifact.findFirst({
        where: { companyId, id: artifactId },
        select: { content: true, sizeBytes: true, sha256: true },
      });
      return row ? { content: row.content, sizeBytes: row.sizeBytes, sha256: row.sha256 } : null;
    },

    async readSriResponse(db: DbClient, companyId: string, attemptId: string) {
      const row = await db.sriResponse.findFirst({
        where: { companyId, attemptId },
        select: { body: true, sizeBytes: true, sha256: true },
      });
      return row ? { content: row.body, sizeBytes: row.sizeBytes, sha256: row.sha256 } : null;
    },
  };
}
