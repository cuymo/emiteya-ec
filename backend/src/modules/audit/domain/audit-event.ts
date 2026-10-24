// Evento del rastro de auditoría del tenant (audit-trail; design D11 y D13). Cambios exitosos de un
// actor conocido y, desde add-reports-export, cada exportación de un reporte que el servidor generó;
// desde add-data-portability, la solicitud, la generación y el inicio de cada descarga de una
// exportación de portabilidad. Nunca secretos ni direcciones IP.

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
  // redesign-account-profile, design D3: el nombre propio, anterior y nuevo.
  "user.name_changed",
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
  // repair-signing-certificate-reseal-after-master-key-change, design D5.
  "signing_certificate.custody_restored",
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
  // add-credit-notes, design D18: las mismas reglas que la factura, sin XML, bytes ni importes por
  // línea.
  "credit_note.reserved",
  "credit_note.signed",
  "credit_note.signing_retried",
  "credit_note.reconciliation_requested",
  "credit_note.reconciliation_completed",
  // add-debit-notes, design D22: las mismas reglas, sin XML, SOAP ni descripciones de los conceptos.
  "debit_note.reserved",
  "debit_note.signed",
  "debit_note.signing_retried",
  "debit_note.reconciliation_requested",
  "debit_note.reconciliation_completed",
  // add-withholding-receipts, design D23: las mismas reglas, sin XML ni SOAP.
  "withholding_receipt.reserved",
  "withholding_receipt.signed",
  "withholding_receipt.signing_retried",
  "withholding_receipt.reconciliation_requested",
  "withholding_receipt.reconciliation_completed",
  // add-shipping-guides, design D24: las mismas reglas, con las excepciones declaradas, sin
  // direcciones, descripciones, placa, XML ni SOAP.
  "shipping_guide.reserved",
  "shipping_guide.signed",
  "shipping_guide.signing_retried",
  "shipping_guide.reconciliation_requested",
  "shipping_guide.reconciliation_completed",
  // add-purchase-settlements, design D23: la reserva con las declaraciones de procedencia, la firma,
  // el reintento y la reconciliación manual de una liquidación de compra.
  "purchase_settlement.reserved",
  "purchase_settlement.signed",
  "purchase_settlement.signing_retried",
  "purchase_settlement.reconciliation_requested",
  "purchase_settlement.reconciliation_completed",
  // add-minimal-inventory, design D12: la configuración del inventario; nunca los movimientos.
  "inventory.initialized",
  "inventory.tracking_disabled",
  "inventory.tracking_enabled",
  // add-reports-export, design D13: el XLSX quedó generado y autorizado para entregarse; no afirma
  // que el usuario lo recibió. Con el reporte, las filas y los filtros sin datos personales.
  "report.exported",
  // add-data-portability, design D19: la solicitud de una exportación de portabilidad (el
  // administrador), su paquete listo con los conteos, el tamaño y el SHA-256 (el sistema), su falla
  // con solo el código seguro (el sistema) y el inicio de una descarga, registrado antes del primer
  // byte: no afirma que el administrador recibió el archivo completo. Nunca rutas, nombres de
  // archivos interiores, contenido, XML, respuestas del SRI ni datos personales.
  "data_export.requested",
  "data_export.completed",
  "data_export.failed",
  "data_export.download_started",
  // add-email-delivery, design D11: los cambios del servidor de correo (sin la contraseña, solo que
  // cambió), cada correo de prueba con su dirección y su resultado, y cada reenvío manual con el
  // comprobante y las direcciones. El envío automático no se audita: su historial es la fuente.
  "email_settings.changed",
  "email.test_sent",
  "email.resent",
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
