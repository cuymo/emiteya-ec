// Esquemas de la administración de usuarios y de la cuenta propia (design D3, D9 y D10).
// Las escrituras son estrictas: rechazan `companyId` y cualquier campo desconocido, y `role` solo
// existe donde es el rol que se asigna a otro usuario.
import { z } from "zod";

export const roleSchema = z.enum(["ADMIN", "OPERATOR"], { error: "El rol no es válido." });
export const membershipStatusSchema = z.enum(["ACTIVE", "DEACTIVATED"], {
  error: "El estado no es válido.",
});

export type Role = z.infer<typeof roleSchema>;
export type MembershipStatus = z.infer<typeof membershipStatusSchema>;

/** Política de contraseñas: los valores son configuración (docs/security/hardening.md). */
export type PasswordPolicy = { minLength: number; maxLength: number };

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = { minLength: 12, maxLength: 128 };

export const USER_NAME_MAX_LENGTH = 100;
export const EMAIL_MAX_LENGTH = 254;

const strict = <T extends z.core.$ZodLooseShape>(shape: T) =>
  z.strictObject(shape, {
    error: (issue) =>
      issue.code === "unrecognized_keys"
        ? "La solicitud contiene campos no permitidos."
        : "La solicitud no es válida.",
  });

export function passwordSchema(policy: PasswordPolicy) {
  return z
    .string({ error: "La contraseña es obligatoria." })
    .min(policy.minLength, `La contraseña debe tener al menos ${policy.minLength} caracteres.`)
    .max(policy.maxLength, `La contraseña debe tener como máximo ${policy.maxLength} caracteres.`);
}

export const userNameSchema = z
  .string({ error: "El nombre es obligatorio." })
  .trim()
  .min(1, "El nombre es obligatorio.")
  .max(
    USER_NAME_MAX_LENGTH,
    `El nombre debe tener como máximo ${USER_NAME_MAX_LENGTH} caracteres.`,
  );

export const emailSchema = z
  .email({ error: "El correo no tiene un formato válido." })
  .max(EMAIL_MAX_LENGTH, "El correo no tiene un formato válido.");

/** Esquemas de escritura con la política de contraseñas vigente. */
export function userSchemas(policy: PasswordPolicy = DEFAULT_PASSWORD_POLICY) {
  const password = passwordSchema(policy);
  return {
    createUser: strict({ name: userNameSchema, email: emailSchema, password, role: roleSchema }),
    changeRole: strict({ role: roleSchema }),
    changeStatus: strict({ status: membershipStatusSchema }),
    setPassword: strict({ password }),
    changeOwnPassword: strict({
      currentPassword: z
        .string({ error: "La contraseña actual es obligatoria." })
        .min(1, "La contraseña actual es obligatoria.")
        .max(policy.maxLength, "La contraseña actual no es válida."),
      newPassword: password,
    }),
  };
}

export type UserSchemas = ReturnType<typeof userSchemas>;
export type CreateUserInput = z.infer<UserSchemas["createUser"]>;
export type ChangeRoleInput = z.infer<UserSchemas["changeRole"]>;
export type ChangeStatusInput = z.infer<UserSchemas["changeStatus"]>;
export type SetPasswordInput = z.infer<UserSchemas["setPassword"]>;
export type ChangeOwnPasswordInput = z.infer<UserSchemas["changeOwnPassword"]>;
