// Envíos de un comprobante (add-email-delivery, design D10 y D11; spec email-delivery, «Historial de
// envíos de un comprobante» y «Reenvío manual»): su historial, las direcciones propuestas para
// enviarlo y el reenvío. El comprobante se busca por su id y la empresa de la sesión: el de otra
// empresa no existe. El reenvío es idempotente por su clave y la huella de la solicitud; en Pruebas
// va solo al correo de prueba; cada reenvío deja su evento de auditoría con las direcciones.
import { createHash } from "node:crypto";
import { resendEmailSchema } from "@facturador/contracts";
import type { JobStore } from "../../../platform/jobs/jobs.ts";
import { canonicalJson } from "../../../platform/idempotency/idempotency.ts";
import { parseInput, type Authorizer } from "../../identity/application/authorization.ts";
import type { RequestContext } from "../../identity/application/request-context.ts";
import { distinctAddresses, receiversOf } from "../domain/recipients.ts";
import { sendJob, type EmailJobSettings } from "./automatic.ts";
import {
  documentNotAuthorized,
  documentNotFound,
  emailDeliveryDisabled,
  emailIdempotencyKeyReused,
  emailNotConfigured,
  emailTestRecipientMissing,
} from "./errors.ts";
import type {
  DeliverableDocumentReader,
  EmailDeliveryHistoryEntry,
  EmailDeliveryRepository,
  EmailDeliveryUnitOfWork,
  EmailDeploymentPolicy,
  EmailSettingsRepository,
  PartyEmailReader,
} from "./ports.ts";

export type DocumentDeliveriesDependencies = Readonly<{
  deliveries: Pick<EmailDeliveryRepository, "listByDocument">;
  uow: EmailDeliveryUnitOfWork;
  settings: Pick<EmailSettingsRepository, "find">;
  documents: DeliverableDocumentReader;
  parties: PartyEmailReader;
  jobs: Pick<JobStore, "enqueueIn">;
  authorizer: Authorizer;
  policy: EmailDeploymentPolicy;
  jobSettings: EmailJobSettings;
  now?: () => Date;
}>;

export type ProposedRecipients = Readonly<{
  recipients: readonly string[];
  environment: "TEST" | "PRODUCTION";
  testRedirect: boolean;
  testRecipient: string | null;
}>;

export function createDocumentDeliveries(deps: DocumentDeliveriesDependencies) {
  const now = deps.now ?? (() => new Date());

  async function documentOf(ctx: RequestContext, documentId: string) {
    const document = await deps.documents.find(ctx.companyId, documentId);
    if (!document) throw documentNotFound();
    return document;
  }

  return {
    /** El historial de envíos de un comprobante, sin el contenido ni la configuración. */
    async list(ctx: RequestContext, documentId: string): Promise<EmailDeliveryHistoryEntry[]> {
      deps.authorizer.requirePermission(ctx, "archive.read");
      await documentOf(ctx, documentId);
      return deps.deliveries.listByDocument(ctx.companyId, documentId);
    },

    /** Las direcciones vigentes del receptor, propuestas para enviar o reenviar. */
    async recipients(ctx: RequestContext, documentId: string): Promise<ProposedRecipients> {
      deps.authorizer.requirePermission(ctx, "email.resend");
      const document = await documentOf(ctx, documentId);
      const receivers = receiversOf(
        document.documentType,
        document.snapshot,
        document.invoiceSnapshot,
      );
      const emailsByParty =
        receivers.partyIds.length > 0
          ? await deps.parties.emailsOf(ctx.companyId, receivers.partyIds)
          : new Map<string, readonly string[]>();
      const settings = await deps.settings.find(ctx.companyId);
      return {
        recipients: distinctAddresses(
          receivers.partyIds.flatMap((partyId) => emailsByParty.get(partyId) ?? []),
        ),
        environment: document.environment,
        testRedirect: document.environment === "TEST",
        testRecipient: settings?.testRecipient ?? null,
      };
    },

    /**
     * Envía o reenvía el correo de un comprobante autorizado a las direcciones dadas. La misma clave
     * con la misma solicitud devuelve el mismo envío; con otra, `409 IDEMPOTENCY_KEY_REUSED`.
     */
    async resend(
      ctx: RequestContext,
      documentId: string,
      idempotencyKey: string,
      body: unknown,
    ): Promise<EmailDeliveryHistoryEntry> {
      deps.authorizer.requirePermission(ctx, "email.resend");
      const { recipients } = parseInput(resendEmailSchema, body);
      const document = await documentOf(ctx, documentId);
      if (document.state !== "AUTHORIZED" || document.authorization === null) {
        throw documentNotAuthorized();
      }
      if (!deps.policy.deliveryEnabled) throw emailDeliveryDisabled();
      const settings = await deps.settings.find(ctx.companyId);
      if (settings === null) throw emailNotConfigured();
      const environment = document.authorization.environment;
      const testRedirect = environment === "TEST";
      if (testRedirect && settings.testRecipient === null) throw emailTestRecipientMissing();
      const addresses = testRedirect ? [settings.testRecipient!] : recipients;
      const fingerprint = createHash("sha256")
        .update(canonicalJson({ documentId, recipients }))
        .digest("hex");

      const deliveryId = await deps.uow.run(async (scope) => {
        await scope.deliveries.lockIdempotencyKey(ctx.companyId, idempotencyKey);
        const existing = await scope.deliveries.findByIdempotencyKey(ctx.companyId, idempotencyKey);
        if (existing) {
          if (existing.requestFingerprint !== fingerprint) throw emailIdempotencyKeyReused();
          return existing.id;
        }
        const at = now();
        const delivery = await scope.deliveries.createManual({
          companyId: ctx.companyId,
          documentId,
          environment,
          testRedirect,
          recipients: addresses,
          requestedBy: ctx.userId,
          idempotencyKey,
          requestFingerprint: fingerprint,
          at,
        });
        await deps.jobs.enqueueIn(
          scope.db,
          sendJob(delivery, deps.jobSettings, at, { requestedBy: ctx.userId }),
        );
        await scope.audit.append({
          companyId: ctx.companyId,
          actor: { type: "USER", userId: ctx.userId },
          action: "email.resent",
          changes: { documentId, recipients: addresses, environment, testRedirect },
          correlationId: ctx.requestId,
        });
        return delivery.id;
      });
      const entries = await deps.deliveries.listByDocument(ctx.companyId, documentId);
      return entries.find((entry) => entry.id === deliveryId)!;
    },
  };
}

export type DocumentDeliveries = ReturnType<typeof createDocumentDeliveries>;
