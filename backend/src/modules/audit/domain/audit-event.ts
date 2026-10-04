// Evento del rastro de auditoría del tenant (audit-trail; design D11 y D13). Solo cambios
// exitosos de un actor conocido; nunca secretos ni direcciones IP.

export type AuditActor =
  { type: "USER"; userId: string } | { type: "SYSTEM" } | { type: "TECHNICAL_ADMIN" };

export const AUDIT_ACTIONS = [
  "company.provisioned",
  "user.created",
  "user.role_changed",
  "user.deactivated",
  "user.reactivated",
  "user.password_set",
  "user.recovered",
  // add-taxpayer-setup, design D11.
  "taxpayer.configured",
  "taxpayer.environment_changed",
  "taxpayer.logo_replaced",
  "taxpayer.logo_removed",
  "establishment.created",
  "establishment.updated",
  "establishment.deactivated",
  "establishment.reactivated",
  "emission_point.created",
  "emission_point.deactivated",
  "emission_point.reactivated",
  // add-fiscal-numbering, design D11.
  "fiscal_sequence.adjusted",
  // add-signing-certificate, design D11.
  "signing_certificate.loaded",
  "signing_certificate.replaced",
  "signing_certificate.expiry_alert_changed",
  "fiscal_catalog.entry_enabled",
  "fiscal_catalog.entry_disabled",
  // add-parties-and-products, design D13.
  "party.created",
  "party.updated",
  "party.deactivated",
  "party.reactivated",
  "product.created",
  "product.updated",
  "product.deactivated",
  "product.reactivated",
  // add-invoice-emission, design D14: sin XML ni bytes; los borradores no generan eventos.
  "invoice.reserved",
  "invoice.signed",
  "invoice.signing_retried",
  // add-sri-transmission, design D19: solo la reconciliación manual, sin respuestas del SRI ni XML.
  "invoice.reconciliation_requested",
  "invoice.reconciliation_completed",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Valores simples o listas de textos (roles, campos cambiados; add-parties-and-products, design D13). */
export type AuditChanges = Readonly<
  Record<string, string | number | boolean | null | readonly string[]>
>;

export type AuditEventInput = Readonly<{
  companyId: string;
  actor: AuditActor;
  action: AuditAction;
  targetUserId?: string;
  changes?: AuditChanges;
  correlationId: string;
}>;

export type AuditEvent = AuditEventInput & Readonly<{ id: string; occurredAt: Date }>;

const SECRET_KEY = /pass|hash|token|secret|session|cookie|credential/i;

export class AuditSecretError extends Error {
  constructor(key: string) {
    super(`La auditoría no admite el campo «${key}»: podría contener un secreto.`);
    this.name = "AuditSecretError";
  }
}

/** Segunda defensa: rechaza cambios con nombres de campo que sugieren un secreto. */
export function assertNoSecrets(changes: AuditChanges | undefined): void {
  for (const key of Object.keys(changes ?? {})) {
    if (SECRET_KEY.test(key)) throw new AuditSecretError(key);
  }
}
