// Política de autorización central (design D4): un mapa de rol a permisos, denegado por defecto.
// Los cambios futuros añaden aquí sus permisos; ninguno se concede por omisión.
import { isRole, type Role } from "./roles.ts";

export const PERMISSIONS = [
  "account.read",
  "account.changePassword",
  "users.read",
  "users.create",
  "users.changeRole",
  "users.changeStatus",
  "users.setPassword",
  "account.setDefaultEmissionPoint",
  "taxpayer.read",
  "taxpayer.configure",
  "environment.change",
  "establishments.read",
  "establishments.manage",
  "readiness.read",
  "sequences.read",
  "sequences.adjust",
  "certificate.read",
  "certificate.manage",
  "certificateValidity.read",
  "fiscalCatalogs.read",
  "fiscalCatalogs.manage",
  "parties.read",
  "parties.manage",
  "parties.changeStatus",
  "products.read",
  "products.manage",
  "products.changeStatus",
  "invoices.read",
  "invoices.draft",
  "invoices.emit",
  "invoices.retrySigning",
  "invoices.reconcile",
  "archive.read",
  "archive.download",
  "archive.retryRide",
  "inventory.read",
  "inventory.entry",
  "inventory.adjust",
  "inventory.initialize",
  "inventory.configure",
  "creditNotes.read",
  "creditNotes.draft",
  "creditNotes.emit",
  "creditNotes.retrySigning",
  "creditNotes.reconcile",
  "debitNotes.read",
  "debitNotes.draft",
  "debitNotes.emit",
  "debitNotes.retrySigning",
  "debitNotes.reconcile",
  "withholdings.read",
  "withholdings.draft",
  "withholdings.emit",
  "withholdings.retrySigning",
  "withholdings.reconcile",
  "shippingGuides.read",
  "shippingGuides.draft",
  "shippingGuides.emit",
  "shippingGuides.retrySigning",
  "shippingGuides.reconcile",
  "purchaseSettlements.read",
  "purchaseSettlements.draft",
  "purchaseSettlements.emit",
  "purchaseSettlements.retrySigning",
  "purchaseSettlements.reconcile",
  "reports.read",
  "reports.export",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const POLICY: Readonly<Record<Role, ReadonlySet<string>>> = {
  ADMIN: new Set<Permission>([
    "account.read",
    "account.changePassword",
    "users.read",
    "users.create",
    "users.changeRole",
    "users.changeStatus",
    "users.setPassword",
    "account.setDefaultEmissionPoint",
    "taxpayer.read",
    "taxpayer.configure",
    "environment.change",
    "establishments.read",
    "establishments.manage",
    "readiness.read",
    "sequences.read",
    "sequences.adjust",
    // add-signing-certificate, design D10.
    "certificate.read",
    "certificate.manage",
    "certificateValidity.read",
    // add-fiscal-catalogs, design D12.
    "fiscalCatalogs.read",
    "fiscalCatalogs.manage",
    // add-parties-and-products, design D12.
    "parties.read",
    "parties.manage",
    "parties.changeStatus",
    "products.read",
    "products.manage",
    "products.changeStatus",
    // add-invoice-emission, design D14.
    "invoices.read",
    "invoices.draft",
    "invoices.emit",
    "invoices.retrySigning",
    // add-sri-transmission, design D18: resolver una revisión manual u ordenar una reconciliación.
    "invoices.reconcile",
    // add-document-archive, design D11: "Consultar la bandeja y descargar XML y RIDE".
    "archive.read",
    "archive.download",
    "archive.retryRide",
    // add-minimal-inventory, design D11: consultar, entradas, ajustes, inicializar y el control de
    // stock de un producto con inventario inicializado.
    "inventory.read",
    "inventory.entry",
    "inventory.adjust",
    "inventory.initialize",
    "inventory.configure",
    // add-credit-notes, design D17: consultar, preparar, emitir con sus declaraciones, reintentar
    // la firma y pedir la reconciliación de una nota de crédito.
    "creditNotes.read",
    "creditNotes.draft",
    "creditNotes.emit",
    "creditNotes.retrySigning",
    "creditNotes.reconcile",
    // add-debit-notes, design D21: consultar, preparar, emitir con su declaración, reintentar la
    // firma y pedir la reconciliación de una nota de débito.
    "debitNotes.read",
    "debitNotes.draft",
    "debitNotes.emit",
    "debitNotes.retrySigning",
    "debitNotes.reconcile",
    // add-withholding-receipts, design D22: consultar, preparar, emitir, reintentar la firma y
    // pedir la reconciliación de un comprobante de retención.
    "withholdings.read",
    "withholdings.draft",
    "withholdings.emit",
    "withholdings.retrySigning",
    "withholdings.reconcile",
    // add-shipping-guides, design D24: consultar, preparar, emitir, reintentar la firma y pedir la
    // reconciliación de una guía de remisión.
    "shippingGuides.read",
    "shippingGuides.draft",
    "shippingGuides.emit",
    "shippingGuides.retrySigning",
    "shippingGuides.reconcile",
    // add-purchase-settlements, design D23: consultar, preparar, emitir, reintentar la firma y pedir
    // la reconciliación de una liquidación de compra.
    "purchaseSettlements.read",
    "purchaseSettlements.draft",
    "purchaseSettlements.emit",
    "purchaseSettlements.retrySigning",
    "purchaseSettlements.reconcile",
    // add-reports-export, design D14: "Ver reportes y exportar XLSX".
    "reports.read",
    "reports.export",
  ]),
  // add-taxpayer-setup, design D10: el operador consulta lo necesario para emitir y elegir su
  // punto predeterminado, pero no ve ni cambia la configuración tributaria.
  OPERATOR: new Set<Permission>([
    "account.read",
    "account.changePassword",
    "account.setDefaultEmissionPoint",
    "establishments.read",
    "readiness.read",
    // add-signing-certificate, design D10: solo la vigencia de la firma.
    "certificateValidity.read",
    // add-fiscal-catalogs, design D12: consulta los catálogos; no cambia la habilitación.
    "fiscalCatalogs.read",
    // add-parties-and-products, design D12: consulta, registra y corrige; no desactiva.
    "parties.read",
    "parties.manage",
    "products.read",
    "products.manage",
    // add-invoice-emission, design D14: crea borradores, emite y reintenta la firma, como el
    // administrador. Resolver una revisión manual o reconciliar es solo del administrador
    // (add-sri-transmission, design D18).
    "invoices.read",
    "invoices.draft",
    "invoices.emit",
    "invoices.retrySigning",
    // add-document-archive, design D11: la bandeja, las descargas, la impresión y el reintento de
    // una generación detenida del RIDE, como el administrador.
    "archive.read",
    "archive.download",
    "archive.retryRide",
    // add-minimal-inventory, design D11: consulta el inventario y registra entradas manuales; no
    // inicializa, no ajusta ni cambia el control de un producto con inventario.
    "inventory.read",
    "inventory.entry",
    // add-credit-notes, design D17: consulta, prepara, emite con sus declaraciones y reintenta la
    // firma, como el administrador; la reconciliación es solo del administrador, como la de la
    // factura.
    "creditNotes.read",
    "creditNotes.draft",
    "creditNotes.emit",
    "creditNotes.retrySigning",
    // add-debit-notes, design D21: consulta, prepara, emite con su declaración y reintenta la firma,
    // como el administrador; la reconciliación es solo del administrador.
    "debitNotes.read",
    "debitNotes.draft",
    "debitNotes.emit",
    "debitNotes.retrySigning",
    // add-withholding-receipts, design D22: consulta, prepara, emite y reintenta la firma de un
    // comprobante de retención, como el administrador; la reconciliación es solo del administrador.
    "withholdings.read",
    "withholdings.draft",
    "withholdings.emit",
    "withholdings.retrySigning",
    // add-shipping-guides, design D24: consulta, prepara, emite y reintenta la firma de una guía
    // de remisión, como el administrador; la reconciliación es solo del administrador (Q-22).
    "shippingGuides.read",
    "shippingGuides.draft",
    "shippingGuides.emit",
    "shippingGuides.retrySigning",
    // add-purchase-settlements, design D23: consulta, prepara, emite y reintenta la firma de una
    // liquidación de compra, como el administrador; la reconciliación es solo del administrador.
    "purchaseSettlements.read",
    "purchaseSettlements.draft",
    "purchaseSettlements.emit",
    "purchaseSettlements.retrySigning",
    // add-reports-export, design D14: ve los reportes y los exporta, como el administrador; no ve
    // más de lo que ya consulta en los comprobantes, el inventario y los terceros.
    "reports.read",
    "reports.export",
  ]),
};

/** true solo si el rol existe y el permiso está concedido explícitamente. */
export function can(role: unknown, permission: unknown): boolean {
  return isRole(role) && typeof permission === "string" && POLICY[role].has(permission);
}
