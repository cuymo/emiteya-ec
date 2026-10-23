// Envío automático (add-email-delivery, design D2 y D7; spec email-delivery, «Envío automático al
// autorizar» y «Envío apagado por configuración»). Lo crea el seguidor del RIDE, en la misma
// transacción que guarda el RIDE: así el correo lleva siempre los dos archivos. Uno como máximo por
// comprobante. Nace desactivado si el despliegue apaga el envío, si la empresa no tiene servidor o
// si apagó el envío automático; si no, pendiente con su trabajo. Encender después no envía los
// desactivados.
import type { Environment } from "@facturador/contracts";
import type { DbClient } from "../../../platform/db/database.ts";
import type { BackoffPolicy, JobStore, NewJob } from "../../../platform/jobs/jobs.ts";
import { failureMessage, type EmailFailureCode } from "../domain/failures.ts";
import type {
  EmailDeliveryRepository,
  EmailDeploymentPolicy,
  EmailSettingsRepository,
} from "./ports.ts";

export const EMAIL_JOB_PREFIX = "email.";
export const EMAIL_SEND_JOB_TYPE = "email.send_document";

export const sendDedupeKey = (deliveryId: string) => `${EMAIL_SEND_JOB_TYPE}:${deliveryId}`;

/** Configuración operativa del trabajo del envío (variables `EMAIL_JOB_*` y `EMAIL_RETRY_*`). */
export type EmailJobSettings = Readonly<{
  maxAttempts: number;
  backoff: BackoffPolicy;
  /** Plazo total de los reintentos, desde la creación del envío. */
  deadlineMs: number;
}>;

export function sendJob(
  delivery: Readonly<{ id: string; companyId: string; documentId: string }>,
  settings: EmailJobSettings,
  now: Date,
  manual?: Readonly<{ requestedBy: string }>,
): NewJob {
  return {
    companyId: delivery.companyId,
    type: EMAIL_SEND_JOB_TYPE,
    dedupeKey: sendDedupeKey(delivery.id),
    documentId: delivery.documentId,
    payload: { deliveryId: delivery.id },
    runAt: now,
    maxAttempts: settings.maxAttempts,
    deadlineAt: new Date(now.getTime() + settings.deadlineMs),
    ...(manual ? { origin: "MANUAL" as const, requestedBy: manual.requestedBy } : {}),
  };
}

/** Un comprobante cuyo RIDE se acaba de guardar, con el ambiente en que se autorizó. */
export type AuthorizedDocumentRef = Readonly<{
  id: string;
  companyId: string;
  environment: Environment;
}>;

export type AutomaticDeliveryDependencies = Readonly<{
  /** Repositorios sobre el cliente de la transacción del RIDE. */
  repositories: (db: DbClient) => Readonly<{
    deliveries: EmailDeliveryRepository;
    settings: EmailSettingsRepository;
  }>;
  jobs: Pick<JobStore, "enqueueIn">;
  policy: EmailDeploymentPolicy;
  settings: EmailJobSettings;
}>;

/** El seguidor del RIDE: corre en su transacción y nunca lanza por un envío que ya existía. */
export function emailRideFollower(deps: AutomaticDeliveryDependencies) {
  return async (db: DbClient, document: AuthorizedDocumentRef, at: Date): Promise<void> => {
    const { deliveries, settings } = deps.repositories(db);
    const configured = await settings.find(document.companyId);
    const disabled: EmailFailureCode | null = !deps.policy.deliveryEnabled
      ? "DELIVERY_DISABLED"
      : configured === null
        ? "NOT_CONFIGURED"
        : !configured.autoSend
          ? "AUTO_SEND_OFF"
          : null;
    const id = await deliveries.createAutomatic({
      companyId: document.companyId,
      documentId: document.id,
      environment: document.environment,
      status: disabled ? "DISABLED" : "PENDING",
      failureCode: disabled,
      failureReason: disabled ? failureMessage(disabled) : null,
      at,
    });
    if (id !== null && disabled === null) {
      await deps.jobs.enqueueIn(
        db,
        sendJob({ id, companyId: document.companyId, documentId: document.id }, deps.settings, at),
      );
    }
  };
}
