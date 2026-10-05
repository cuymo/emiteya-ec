// Composición de la firma de comprobantes compartida por tipo (add-credit-notes, design D2):
// `main.ts` y los arneses la crean una vez con el firmador, el validador y la cola, y cada módulo
// que emite pide su pipeline con su perfil.
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import type { JobStore } from "../../../platform/jobs/jobs.ts";
import { createPrismaJobStore } from "../../../platform/jobs/prisma-job-store.ts";
import type { XsdValidator } from "../../sri-engine/application/ports.ts";
import { XML_SIGNER_VERSION } from "../../sri-engine/infrastructure/ec-sri-signer.ts";
import {
  createSigningPipeline,
  type DocumentSigner,
  type SigningPipeline,
  type SigningProfile,
} from "../application/signing-pipeline.ts";
import {
  DEFAULT_TRANSMISSION_SETTINGS,
  type TransmissionSettings,
} from "../application/transmission-settings.ts";
import { createDocumentRepository } from "./prisma-documents.ts";
import { createSignedUnitOfWork } from "./signed-unit-of-work.ts";

export type SigningPipelinesOptions = {
  prisma: PrismaClient;
  /** Validador XSD con el paquete verificado al arrancar. */
  xsd: Pick<XsdValidator, "validate">;
  /** Firma de comprobantes con la firma vigente (`signingModule(...).documents`). */
  signer: DocumentSigner;
  /** Cola durable del `sri.transmit` que nace al firmar. */
  jobs?: Pick<JobStore, "enqueueIn">;
  /** Límites del `sri.transmit` que nace al firmar (add-sri-transmission, design D6 y D22). */
  transmission?: TransmissionSettings;
  now?: () => Date;
  logger?: { error(details: object, message: string): void };
};

export type SigningPipelines = Readonly<{ pipeline(profile: SigningProfile): SigningPipeline }>;

export function signingPipelines(options: SigningPipelinesOptions): SigningPipelines {
  const now = options.now ?? (() => new Date());
  const documents = createDocumentRepository(options.prisma);
  const persist = createSignedUnitOfWork(options.prisma, {
    jobs: options.jobs ?? createPrismaJobStore(options.prisma),
    settings: options.transmission ?? DEFAULT_TRANSMISSION_SETTINGS,
    now,
  });
  return {
    pipeline: (profile) =>
      createSigningPipeline({
        documents,
        persist,
        profile,
        xsd: options.xsd,
        signer: options.signer,
        signerVersion: XML_SIGNER_VERSION,
        now,
        ...(options.logger ? { logger: options.logger } : {}),
      }),
  };
}
