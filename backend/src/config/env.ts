// Configuración por entorno, validada al arrancar (docs/architecture/deployment.md).
import { readFileSync } from "node:fs";
import {
  CERTIFICATE_MAX_BYTES_DEFAULT,
  CERTIFICATE_MAX_BYTES_LIMIT,
  emailSchema,
  passwordSchema,
  type PasswordPolicy,
} from "@facturador/contracts";
import { z } from "zod";
import { DEFAULT_LOGO_MAX_BYTES, LOGO_MAX_BYTES_RANGE } from "../modules/taxpayer/domain/logo.ts";

const trustProxy = z
  .string()
  .default("false")
  .transform((value, ctx): boolean | number | string => {
    if (value === "false") return false;
    if (/^\d+$/.test(value)) return Number(value);
    if (value === "true") {
      ctx.addIssue({
        code: "custom",
        message: "no se admite `true`: indica el número de proxies o sus direcciones",
      });
      return z.NEVER;
    }
    return value;
  });

/** Secreto de `backend/.env.example`: sirve para desarrollo y se rechaza en producción. */
export const EXAMPLE_AUTH_SECRET = "desarrollo-local-solo-para-pruebas-no-usar-en-produccion";

/** Clave maestra de ejemplo de `backend/.env.example` (32 bytes): solo desarrollo, rechazada en producción. */
export const EXAMPLE_CERTIFICATE_MASTER_KEY = "ZGVzYXJyb2xsby1sb2NhbC1uby11c2FyLWVuLXByb2Q=";

const int = (min: number, max: number) => z.coerce.number().int().min(min).max(max);

// Defaults de docs/security/hardening.md; son configuración, no contrato.
export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: int(1, 65535).default(4000),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    TRUST_PROXY: trustProxy,
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url({ protocol: /^https?$/ }),
    PASSWORD_MIN_LENGTH: int(8, 128).default(12),
    PASSWORD_MAX_LENGTH: int(8, 1024).default(128),
    LOGIN_MAX_FAILURES: int(1, 100).default(5),
    LOGIN_FAILURE_WINDOW_MINUTES: int(1, 1440).default(15),
    LOGIN_IP_MAX_REQUESTS: int(1, 10_000).default(30),
    LOGIN_IP_WINDOW_SECONDS: int(1, 3600).default(60),
    // Tamaño máximo del logo (design D5); por defecto 512 KiB, entre 16 KiB y 2 MiB.
    LOGO_MAX_BYTES: int(LOGO_MAX_BYTES_RANGE.min, LOGO_MAX_BYTES_RANGE.max).default(
      DEFAULT_LOGO_MAX_BYTES,
    ),
    // Custodia de la firma electrónica (add-signing-certificate, design D6). La clave se valida al
    // arrancar la API (loadCertificateCustody); nunca se guarda en la base de datos (ADR 0011).
    CERTIFICATE_CUSTODY: z.enum(["enabled", "disabled"]).default("enabled"),
    CERTIFICATE_MASTER_KEY: z.string().optional(),
    CERTIFICATE_MASTER_KEY_FILE: z.string().optional(),
    CERTIFICATE_MASTER_KEY_VERSION: z
      .string()
      .regex(/^[A-Za-z0-9._-]{1,32}$/)
      .default("1"),
    // Tamaño máximo del PKCS#12 decodificado (design D3): configuración, no un límite del SRI.
    CERTIFICATE_MAX_BYTES: int(8 * 1024, CERTIFICATE_MAX_BYTES_LIMIT).default(
      CERTIFICATE_MAX_BYTES_DEFAULT,
    ),
    // Pool criptográfico fuera del event loop (design D18).
    CRYPTO_WORKERS: int(1, 8).default(2),
    CRYPTO_TASK_TIMEOUT_MS: int(1_000, 120_000).default(30_000),
    // Solo se validan cuando la instalación aún no tiene empresa (loadInitialAdmin).
    INITIAL_USER_EMAIL: z.string().optional(),
    INITIAL_USER_PASSWORD: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.PASSWORD_MAX_LENGTH < env.PASSWORD_MIN_LENGTH) {
      ctx.addIssue({
        code: "custom",
        path: ["PASSWORD_MAX_LENGTH"],
        message: "menor que el mínimo",
      });
    }
    if (env.NODE_ENV === "production" && env.BETTER_AUTH_SECRET === EXAMPLE_AUTH_SECRET) {
      ctx.addIssue({ code: "custom", path: ["BETTER_AUTH_SECRET"], message: "es el de ejemplo" });
    }
    if (env.NODE_ENV === "production" && env.CERTIFICATE_CUSTODY === "disabled") {
      ctx.addIssue({ code: "custom", path: ["CERTIFICATE_CUSTODY"], message: "disabled" });
    }
  });

export type Env = z.infer<typeof envSchema>;

export class EnvError extends Error {
  readonly variables: string[];

  constructor(variables: string[], details: string[]) {
    super(`Configuración de entorno inválida:\n${details.map((d) => `  - ${d}`).join("\n")}`);
    this.name = "EnvError";
    this.variables = variables;
  }
}

/** Valida el entorno. Los mensajes nombran la variable y el problema, nunca su valor. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (result.success) return result.data;
  throw toEnvError(result.error.issues, source);
}

function toEnvError(issues: z.core.$ZodIssue[], source: NodeJS.ProcessEnv): EnvError {
  const variables = [...new Set(issues.map((issue) => String(issue.path[0] ?? "?")))];
  const details = issues.map((issue) => {
    const name = String(issue.path[0] ?? "?");
    return issue.code === "invalid_type" && source[name] === undefined
      ? `${name}: es obligatoria`
      : `${name}: valor inválido`;
  });
  return new EnvError(variables, details);
}

export function passwordPolicy(env: Env): PasswordPolicy {
  return { minLength: env.PASSWORD_MIN_LENGTH, maxLength: env.PASSWORD_MAX_LENGTH };
}

export type InitialAdmin = Readonly<{ email: string; password: string }>;

/**
 * Administrador inicial del aprovisionamiento (design D7). Se valida solo cuando la instalación
 * aún no tiene empresa; los mensajes nombran la variable y la regla, nunca su valor.
 */
export function loadInitialAdmin(env: Env): InitialAdmin {
  const policy = passwordPolicy(env);
  const result = z
    .object({ INITIAL_USER_EMAIL: emailSchema, INITIAL_USER_PASSWORD: passwordSchema(policy) })
    .safeParse({
      INITIAL_USER_EMAIL: env.INITIAL_USER_EMAIL,
      INITIAL_USER_PASSWORD: env.INITIAL_USER_PASSWORD,
    });
  if (result.success) {
    return { email: result.data.INITIAL_USER_EMAIL, password: result.data.INITIAL_USER_PASSWORD };
  }
  const variables = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))];
  const details = variables.map((name) => {
    if (env[name as keyof Env] === undefined)
      return `${name}: es obligatoria mientras la instalación no tiene empresa`;
    return name === "INITIAL_USER_PASSWORD"
      ? `${name}: debe tener entre ${policy.minLength} y ${policy.maxLength} caracteres`
      : `${name}: valor inválido`;
  });
  throw new EnvError(variables, details);
}

export type CertificateCustodyConfig =
  Readonly<{ enabled: false }> | Readonly<{ enabled: true; keyVersion: string; key: Buffer }>;

function decodeMasterKey(value: string): Buffer | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  const key = Buffer.from(value, "base64");
  return key.length === 32 && key.toString("base64") === value ? key : null;
}

/**
 * Clave maestra de la custodia de firmas (ADR 0011, design D6). La API la exige al arrancar
 * mientras la custodia esté habilitada; los mensajes nombran la variable, nunca su valor ni la
 * ruta del archivo.
 */
export function loadCertificateCustody(
  env: Env,
  readFile: (path: string) => string = (path) => readFileSync(path, "utf8"),
): CertificateCustodyConfig {
  if (env.CERTIFICATE_CUSTODY === "disabled") return { enabled: false };
  const inline = env.CERTIFICATE_MASTER_KEY;
  const file = env.CERTIFICATE_MASTER_KEY_FILE;
  if (inline !== undefined && file !== undefined) {
    throw new EnvError(
      ["CERTIFICATE_MASTER_KEY", "CERTIFICATE_MASTER_KEY_FILE"],
      [
        "CERTIFICATE_MASTER_KEY: usa solo una de CERTIFICATE_MASTER_KEY o CERTIFICATE_MASTER_KEY_FILE",
      ],
    );
  }
  if (inline === undefined && file === undefined) {
    throw new EnvError(
      ["CERTIFICATE_MASTER_KEY"],
      [
        "CERTIFICATE_MASTER_KEY: es obligatoria (o CERTIFICATE_MASTER_KEY_FILE) mientras la custodia de firmas esté habilitada",
      ],
    );
  }
  const name = inline !== undefined ? "CERTIFICATE_MASTER_KEY" : "CERTIFICATE_MASTER_KEY_FILE";
  let raw: string;
  try {
    raw = (inline ?? readFile(file!)).trim();
  } catch {
    throw new EnvError([name], [`${name}: no se puede leer el archivo`]);
  }
  const key = decodeMasterKey(raw);
  if (!key) throw new EnvError([name], [`${name}: debe contener 32 bytes en base64`]);
  if (env.NODE_ENV === "production" && raw === EXAMPLE_CERTIFICATE_MASTER_KEY) {
    key.fill(0);
    throw new EnvError([name], [`${name}: es la de ejemplo`]);
  }
  return { enabled: true, keyVersion: env.CERTIFICATE_MASTER_KEY_VERSION, key };
}
