import { describe, expect, it } from "vitest";
import { DEFAULT_PASSWORD_POLICY, userSchemas } from "@facturador/contracts";

const policy = { minLength: 12, maxLength: 128 };
const schemas = userSchemas(policy);
const valid = {
  createUser: {
    name: "Ana Pérez",
    email: "ana@example.com",
    password: "a".repeat(12),
    role: "OPERATOR",
  },
  changeRole: { role: "ADMIN" },
  changeStatus: { status: "DEACTIVATED" },
  setPassword: { password: "a".repeat(12) },
  changeOwnPassword: { currentPassword: "anterior-123", newPassword: "a".repeat(12) },
} as const;

const messages = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((issue) => issue.message) ?? [];

describe("esquemas de usuarios", () => {
  it("aceptan los cuerpos válidos", () => {
    for (const [name, body] of Object.entries(valid)) {
      expect(schemas[name as keyof typeof valid].safeParse(body).success, name).toBe(true);
    }
  });

  it("rechazan companyId en cualquier escritura", () => {
    for (const [name, body] of Object.entries(valid)) {
      const result = schemas[name as keyof typeof valid].safeParse({ ...body, companyId: "otra" });
      expect(result.success, name).toBe(false);
      expect(messages(result)).toContain("La solicitud contiene campos no permitidos.");
    }
  });

  it("rechazan campos desconocidos", () => {
    expect(schemas.createUser.safeParse({ ...valid.createUser, isAdmin: true }).success).toBe(
      false,
    );
    expect(schemas.changeRole.safeParse({ ...valid.changeRole, userId: "u-2" }).success).toBe(
      false,
    );
  });

  it("aceptan role solo donde es el rol asignado", () => {
    expect(schemas.createUser.safeParse(valid.createUser).success).toBe(true);
    expect(schemas.changeRole.safeParse(valid.changeRole).success).toBe(true);
    for (const name of ["changeStatus", "setPassword", "changeOwnPassword"] as const) {
      expect(schemas[name].safeParse({ ...valid[name], role: "ADMIN" }).success, name).toBe(false);
    }
  });

  it("rechazan un rol o un estado que no existen", () => {
    expect(messages(schemas.changeRole.safeParse({ role: "admin" }))).toEqual([
      "El rol no es válido.",
    ]);
    expect(messages(schemas.changeStatus.safeParse({ status: "BANNED" }))).toEqual([
      "El estado no es válido.",
    ]);
  });

  it("indican el campo inválido del alta", () => {
    expect(messages(schemas.createUser.safeParse({ ...valid.createUser, name: "  " }))).toEqual([
      "El nombre es obligatorio.",
    ]);
    expect(messages(schemas.createUser.safeParse({ ...valid.createUser, email: "ana" }))).toEqual([
      "El correo no tiene un formato válido.",
    ]);
  });

  it("recortan el nombre", () => {
    const parsed = schemas.createUser.parse({ ...valid.createUser, name: "  Ana  " });
    expect(parsed.name).toBe("Ana");
  });
});

describe("política de contraseñas en los esquemas", () => {
  const cases = [
    { policy, label: "por defecto" },
    { policy: { minLength: 16, maxLength: 64 }, label: "configurada" },
  ];

  for (const { policy: p, label } of cases) {
    const s = userSchemas(p);
    const withPassword = {
      createUser: (password: string) => ({ ...valid.createUser, password }),
      setPassword: (password: string) => ({ password }),
      changeOwnPassword: (newPassword: string) => ({ currentPassword: "actual", newPassword }),
    };

    for (const [name, body] of Object.entries(withPassword)) {
      const schema = s[name as keyof typeof withPassword];
      it(`${name} con la política ${label} acepta el mínimo y el máximo exactos`, () => {
        expect(schema.safeParse(body("a".repeat(p.minLength))).success).toBe(true);
        expect(schema.safeParse(body("a".repeat(p.maxLength))).success).toBe(true);
      });

      it(`${name} con la política ${label} rechaza una unidad fuera de cada límite`, () => {
        expect(messages(schema.safeParse(body("a".repeat(p.minLength - 1))))).toEqual([
          `La contraseña debe tener al menos ${p.minLength} caracteres.`,
        ]);
        expect(messages(schema.safeParse(body("a".repeat(p.maxLength + 1))))).toEqual([
          `La contraseña debe tener como máximo ${p.maxLength} caracteres.`,
        ]);
      });
    }
  }

  it("la política por defecto es la de docs/security/hardening.md", () => {
    expect(DEFAULT_PASSWORD_POLICY).toEqual({ minLength: 12, maxLength: 128 });
  });
});
