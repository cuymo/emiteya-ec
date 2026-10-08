import { describe, expect, it } from "vitest";
import {
  PERMISSIONS,
  can,
  type Permission,
} from "../../src/modules/identity/domain/access-policy.ts";
import { ROLES, type Role } from "../../src/modules/identity/domain/roles.ts";

// Matriz de design D4: cada celda, escrita aquí de forma independiente del mapa implementado.
const MATRIX: Record<Permission, Record<Role, boolean>> = {
  "account.read": { ADMIN: true, OPERATOR: true },
  "account.changePassword": { ADMIN: true, OPERATOR: true },
  "users.read": { ADMIN: true, OPERATOR: false },
  "users.create": { ADMIN: true, OPERATOR: false },
  "users.changeRole": { ADMIN: true, OPERATOR: false },
  "users.changeStatus": { ADMIN: true, OPERATOR: false },
  "users.setPassword": { ADMIN: true, OPERATOR: false },
  // add-taxpayer-setup, design D10.
  "account.setDefaultEmissionPoint": { ADMIN: true, OPERATOR: true },
  "taxpayer.read": { ADMIN: true, OPERATOR: false },
  "taxpayer.configure": { ADMIN: true, OPERATOR: false },
  "environment.change": { ADMIN: true, OPERATOR: false },
  "establishments.read": { ADMIN: true, OPERATOR: true },
  "establishments.manage": { ADMIN: true, OPERATOR: false },
  "readiness.read": { ADMIN: true, OPERATOR: true },
  // add-fiscal-numbering, design D10.
  "sequences.read": { ADMIN: true, OPERATOR: false },
  "sequences.adjust": { ADMIN: true, OPERATOR: false },
  // add-signing-certificate, design D10.
  "certificate.read": { ADMIN: true, OPERATOR: false },
  "certificate.manage": { ADMIN: true, OPERATOR: false },
  "certificateValidity.read": { ADMIN: true, OPERATOR: true },
  // add-fiscal-catalogs, design D12.
  "fiscalCatalogs.read": { ADMIN: true, OPERATOR: true },
  "fiscalCatalogs.manage": { ADMIN: true, OPERATOR: false },
  // add-parties-and-products, design D12.
  "parties.read": { ADMIN: true, OPERATOR: true },
  "parties.manage": { ADMIN: true, OPERATOR: true },
  "parties.changeStatus": { ADMIN: true, OPERATOR: false },
  "products.read": { ADMIN: true, OPERATOR: true },
  "products.manage": { ADMIN: true, OPERATOR: true },
  "products.changeStatus": { ADMIN: true, OPERATOR: false },
  // add-invoice-emission, design D14.
  "invoices.read": { ADMIN: true, OPERATOR: true },
  "invoices.draft": { ADMIN: true, OPERATOR: true },
  "invoices.emit": { ADMIN: true, OPERATOR: true },
  "invoices.retrySigning": { ADMIN: true, OPERATOR: true },
  "invoices.reconcile": { ADMIN: true, OPERATOR: false },
  // add-document-archive, design D11: "Consultar la bandeja y descargar XML y RIDE".
  "archive.read": { ADMIN: true, OPERATOR: true },
  "archive.download": { ADMIN: true, OPERATOR: true },
  "archive.retryRide": { ADMIN: true, OPERATOR: true },
  // add-minimal-inventory, design D11: el operador consulta y registra entradas; el resto es del
  // administrador.
  "inventory.read": { ADMIN: true, OPERATOR: true },
  "inventory.entry": { ADMIN: true, OPERATOR: true },
  "inventory.adjust": { ADMIN: true, OPERATOR: false },
  "inventory.initialize": { ADMIN: true, OPERATOR: false },
  "inventory.configure": { ADMIN: true, OPERATOR: false },
  // add-credit-notes, design D17: como la factura; la reconciliación, solo el administrador.
  "creditNotes.read": { ADMIN: true, OPERATOR: true },
  "creditNotes.draft": { ADMIN: true, OPERATOR: true },
  "creditNotes.emit": { ADMIN: true, OPERATOR: true },
  "creditNotes.retrySigning": { ADMIN: true, OPERATOR: true },
  "creditNotes.reconcile": { ADMIN: true, OPERATOR: false },
  "debitNotes.read": { ADMIN: true, OPERATOR: true },
  "debitNotes.draft": { ADMIN: true, OPERATOR: true },
  "debitNotes.emit": { ADMIN: true, OPERATOR: true },
  "debitNotes.retrySigning": { ADMIN: true, OPERATOR: true },
  "debitNotes.reconcile": { ADMIN: true, OPERATOR: false },
  "withholdings.read": { ADMIN: true, OPERATOR: true },
  "withholdings.draft": { ADMIN: true, OPERATOR: true },
  "withholdings.emit": { ADMIN: true, OPERATOR: true },
  "withholdings.retrySigning": { ADMIN: true, OPERATOR: true },
  "withholdings.reconcile": { ADMIN: true, OPERATOR: false },
  "shippingGuides.read": { ADMIN: true, OPERATOR: true },
  "shippingGuides.draft": { ADMIN: true, OPERATOR: true },
  "shippingGuides.emit": { ADMIN: true, OPERATOR: true },
  "shippingGuides.retrySigning": { ADMIN: true, OPERATOR: true },
  "shippingGuides.reconcile": { ADMIN: true, OPERATOR: false },
  "purchaseSettlements.read": { ADMIN: true, OPERATOR: true },
  "purchaseSettlements.draft": { ADMIN: true, OPERATOR: true },
  "purchaseSettlements.emit": { ADMIN: true, OPERATOR: true },
  "purchaseSettlements.retrySigning": { ADMIN: true, OPERATOR: true },
  "purchaseSettlements.reconcile": { ADMIN: true, OPERATOR: false },
  "reports.read": { ADMIN: true, OPERATOR: true },
  "reports.export": { ADMIN: true, OPERATOR: true },
  "dataPortability.export": { ADMIN: true, OPERATOR: false },
};

describe("política de autorización central", () => {
  it("la matriz cubre exactamente los permisos definidos", () => {
    expect(Object.keys(MATRIX).sort()).toEqual([...PERMISSIONS].sort());
  });

  for (const permission of PERMISSIONS) {
    for (const role of ROLES) {
      const expected = MATRIX[permission][role];
      it(`${role} ${expected ? "tiene" : "no tiene"} ${permission}`, () => {
        expect(can(role, permission)).toBe(expected);
      });
    }
  }

  it("deniega un permiso desconocido para cualquier rol", () => {
    for (const role of ROLES) {
      expect(can(role, "users.delete")).toBe(false);
      expect(can(role, "")).toBe(false);
      expect(can(role, undefined)).toBe(false);
    }
  });

  it("deniega todo a un rol desconocido, incluido el rol global de Better Auth", () => {
    for (const role of ["admin", "owner", "member", "", undefined, null]) {
      expect(can(role, "account.read")).toBe(false);
      expect(can(role, "users.create")).toBe(false);
    }
  });

  it("no concede permisos heredados del prototipo de objetos", () => {
    expect(can("ADMIN", "toString")).toBe(false);
    expect(can("constructor", "account.read")).toBe(false);
  });
});
