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
