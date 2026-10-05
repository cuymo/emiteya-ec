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
  ]),
};

/** true solo si el rol existe y el permiso está concedido explícitamente. */
export function can(role: unknown, permission: unknown): boolean {
  return isRole(role) && typeof permission === "string" && POLICY[role].has(permission);
}
