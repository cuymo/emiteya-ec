// Configuración por entorno, validada al arrancar (docs/architecture/deployment.md).
import { z } from "zod";

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

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  TRUST_PROXY: trustProxy,
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
  const variables = [...new Set(result.error.issues.map((issue) => String(issue.path[0] ?? "?")))];
  const details = result.error.issues.map((issue) => {
    const name = String(issue.path[0] ?? "?");
    return issue.code === "invalid_type" && source[name] === undefined
      ? `${name}: es obligatoria`
      : `${name}: valor inválido`;
  });
  throw new EnvError(variables, details);
}
