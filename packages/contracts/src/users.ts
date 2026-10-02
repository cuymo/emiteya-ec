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

// Respuestas con listas permitidas (design D10): nunca hashes, sesiones, cuentas de Better Auth ni
// el rol global de Better Auth.
export const meSchema = z.strictObject({ name: z.string(), email: z.string(), role: roleSchema });

export const userViewSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: roleSchema,
  status: membershipStatusSchema,
  createdAt: z.iso.datetime(),
});

export const USERS_PAGE_SIZE_DEFAULT = 25;
export const USERS_PAGE_SIZE_MAX = 100;

/** Consulta de la lista: no es estricta, de modo que un `companyId` en la consulta se ignora. */
export const listUsersQuerySchema = z.object({
  search: z
    .string()
    .trim()
    .max(100, "La búsqueda debe tener como máximo 100 caracteres.")
    .optional(),
  status: membershipStatusSchema.optional(),
  page: z.coerce.number({ error: "La página no es válida." }).int().min(1).default(1),
  pageSize: z.coerce
    .number({ error: "El tamaño de página no es válido." })
    .int()
    .min(1, "El tamaño de página no es válido.")
    .max(USERS_PAGE_SIZE_MAX, `El tamaño de página debe ser como máximo ${USERS_PAGE_SIZE_MAX}.`)
    .default(USERS_PAGE_SIZE_DEFAULT),
});

export const userListMetaSchema = z.strictObject({
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

export const userIdParamsSchema = z.strictObject({ userId: z.string().min(1) });

export type Me = z.infer<typeof meSchema>;
export type UserView = z.infer<typeof userViewSchema>;
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
export type UserListMeta = z.infer<typeof userListMetaSchema>;
