import { describe, expect, it } from "vitest";
import { isNoOp, selfChangeViolation } from "../../src/modules/identity/domain/access-rules.ts";

describe("reglas de acceso sin auto-modificación", () => {
  it("nadie cambia su propio rol", () => {
    expect(selfChangeViolation("changeRole", "u-1", "u-1")).toBe("OWN_ROLE");
  });

  it("nadie cambia su propio estado, de modo que nadie se desactiva a sí mismo", () => {
    expect(selfChangeViolation("changeStatus", "u-1", "u-1")).toBe("OWN_STATUS");
  });

  it("la contraseña propia no se establece por la vía de administración", () => {
    expect(selfChangeViolation("setPassword", "u-1", "u-1")).toBe("OWN_PASSWORD");
  });

  it("las tres acciones se permiten sobre otro usuario", () => {
    for (const action of ["changeRole", "changeStatus", "setPassword"] as const) {
      expect(selfChangeViolation(action, "u-1", "u-2")).toBeNull();
    }
  });

  it("el estado deseado igual al actual no es un cambio", () => {
    expect(isNoOp("OPERATOR", "OPERATOR")).toBe(true);
    expect(isNoOp("DEACTIVATED", "DEACTIVATED")).toBe(true);
    expect(isNoOp("OPERATOR", "ADMIN")).toBe(false);
  });
});
