// Arnés de la transmisión de notas de crédito (add-credit-notes): los handlers reales de envío,
// autorización y reconciliación con un gateway simulado de respuestas SINTÉTICAS con la estructura
// oficial, y los seguidores que compone `main.ts` en su orden: el job del RIDE, la salida de
// inventario de una factura, la capacidad acreditable de la nota y su devolución de stock.
import type { PrismaClient } from "../../src/generated/prisma/client.ts";
import {
  RIDE_BACKOFF,
  rideFollower,
} from "../../src/modules/fiscal/application/archive/ride-jobs.ts";
import { createAuthorizeHandler } from "../../src/modules/fiscal/application/authorize-handler.ts";
import type { DocumentTransitionFollower } from "../../src/modules/fiscal/application/document-transitions.ts";
import { createReconcileHandler } from "../../src/modules/fiscal/application/reconcile-handler.ts";
import { createTransmitHandler } from "../../src/modules/fiscal/application/transmit-handler.ts";
import { DEFAULT_TRANSMISSION_SETTINGS } from "../../src/modules/fiscal/application/transmission-settings.ts";
import { createArtifactStore } from "../../src/modules/fiscal/infrastructure/prisma-artifacts.ts";
import { createDocumentRepository } from "../../src/modules/fiscal/infrastructure/prisma-documents.ts";
import { createSriEvidenceRepository } from "../../src/modules/fiscal/infrastructure/prisma-sri-evidence.ts";
import { createTransmissionUnitOfWork } from "../../src/modules/fiscal/infrastructure/transmission-unit-of-work.ts";
import {
  createCreditCapacityRepository,
  creditCapacityFollower,
} from "../../src/modules/credit-notes/infrastructure/index.ts";
import {
  createStockRepository,
  creditNoteReturnFollower,
  inventoryOutflowFollower,
  stockReturnReservations,
} from "../../src/modules/inventory/infrastructure/index.ts";
import { invoiceStockLines } from "../../src/modules/invoices/infrastructure/index.ts";
import type {
  SriExchange,
  TransportOutcome,
} from "../../src/modules/sri-engine/application/transport.ts";
import { sriClassifiers } from "../../src/modules/sri-engine/infrastructure/index.ts";
import {
  authorizationEnvelope,
  receptionEnvelope,
  validityEnvelope,
} from "../../src/modules/sri-engine/infrastructure/soap-envelopes.ts";
import type { Job, JobStore } from "../../src/platform/jobs/jobs.ts";
import { SYNTHETIC_POLICY_BYTES } from "../support/synthetic-size-policy.ts";
import {
  authorizationResponse,
  failure,
  response,
  type SyntheticAuthorization,
} from "../support/sri-responses.ts";
import { leasedJob, signedXmlOf, type TestDocument } from "./transmission-harness.ts";

export type CreditNoteTransmission = ReturnType<typeof creditNoteTransmission>;

export function creditNoteTransmission(prisma: PrismaClient, store: JobStore) {
  const calls: string[] = [];
  const replies: TransportOutcome[] = [];
  const gateway = () => {
    const exchange = (
      service: "RECEPTION" | "AUTHORIZATION" | "VALIDITY",
      environment: "TEST" | "PRODUCTION",
      envelope: Buffer,
    ) => {
      calls.push(service);
      const result: SriExchange = {
        service,
        environment,
        endpoint: `simulado:${service}`,
        envelope,
        outcome: replies.shift() ?? failure("CONNECTION_LOST"),
      };
      return Promise.resolve(result);
    };
    return {
      submit: (environment: "TEST" | "PRODUCTION", xml: Buffer) =>
        exchange("RECEPTION", environment, receptionEnvelope(xml)),
      queryAuthorization: (environment: "TEST" | "PRODUCTION", key: string) =>
        exchange("AUTHORIZATION", environment, authorizationEnvelope(key)),
      queryValidity: (environment: "TEST" | "PRODUCTION", key: string) =>
        exchange("VALIDITY", environment, validityEnvelope(key)),
    };
  };
  /** Los seguidores de `main.ts`, en su orden. */
  const followers: DocumentTransitionFollower[] = [
    rideFollower({ jobs: store, settings: { maxAttempts: 5, backoff: RIDE_BACKOFF } }),
    inventoryOutflowFollower({ invoices: invoiceStockLines, stock: createStockRepository }),
    creditCapacityFollower({ capacity: createCreditCapacityRepository }),
    creditNoteReturnFollower({
      returns: stockReturnReservations,
      stock: createStockRepository,
      documents: createDocumentRepository,
    }),
  ];
  const base = (chosen: readonly DocumentTransitionFollower[]) => ({
    db: prisma,
    evidence: createSriEvidenceRepository(prisma),
    uow: createTransmissionUnitOfWork(prisma),
    jobs: store,
    logger: { info: () => {}, warn: () => {} },
    followers: chosen,
    documents: createDocumentRepository(prisma),
    gateway: gateway(),
    classifiers: sriClassifiers,
    settings: DEFAULT_TRANSMISSION_SETTINGS,
  });
  return {
    calls,
    replies,
    followers,
    authorize: (chosen: readonly DocumentTransitionFollower[] = followers) =>
      createAuthorizeHandler({ ...base(chosen), random: () => 0.5 }),
    transmit: (chosen: readonly DocumentTransitionFollower[] = followers) =>
      createTransmitHandler({
        ...base(chosen),
        artifacts: createArtifactStore(prisma),
        sizePolicy: () => Promise.resolve({ maxSignedDocumentBytes: SYNTHETIC_POLICY_BYTES }),
        today: () => "2026-10-05",
        alert: () => {},
      }),
    reconcile: (chosen: readonly DocumentTransitionFollower[] = followers) =>
      createReconcileHandler({ ...base(chosen), inquiry: gateway(), random: () => 0.5 }).handler,
    context: () => ({ signal: new AbortController().signal, now: () => new Date() }),
    jobFor: (
      document: TestDocument,
      type: "sri.authorize" | "sri.transmit" | "sri.reconcile",
      payload: Record<string, unknown> = {},
    ): Promise<Job> =>
      leasedJob(store, prisma, {
        companyId: document.companyId,
        type,
        dedupeKey: `${type}:${document.id}`,
        documentId: document.id,
        runAt: new Date(),
        maxAttempts: 1_000,
        deadlineAt: new Date(Date.now() + 24 * 3_600_000),
        ...(Object.keys(payload).length > 0 ? { payload } : {}),
      }),
    authorized: (
      document: TestDocument,
      overrides: Partial<SyntheticAuthorization> = {},
    ): SyntheticAuthorization => ({
      estado: "AUTORIZADO",
      numeroAutorizacion: document.accessKey,
      fechaAutorizacion: "2026-10-05T10:15:30-05:00",
      ambiente: "PRUEBAS",
      comprobante: `<![CDATA[${signedXmlOf(document.accessKey).toString("utf8")}]]>`,
      ...overrides,
    }),
    reply: (document: TestDocument, authorizations: SyntheticAuthorization[]) =>
      replies.push(response(authorizationResponse(document.accessKey, authorizations))),
  };
}
