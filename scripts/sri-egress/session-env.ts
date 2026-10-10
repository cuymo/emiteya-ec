// Comprobaciones del archivo de entorno de la sesión de certificación
// (docs/quality/sri-egress-allowlist.md). El archivo vive fuera del repositorio y no se imprime.
// - Los endpoints de Producción deben estar sobrescritos con una dirección local que no lleva a
//   ningún sitio. Sin ellos, la aplicación usaría cel.sri.gob.ec por defecto.
// - Ningún endpoint puede nombrar a Producción.
// - Los de Pruebas, si se sobrescriben, solo pueden ser celcer.
// - La base de datos se alcanza por el puente local del espacio de nombres.
import { isProductionHost, SRI_TEST_HOST } from "./policy.ts";

export const SERVICES = ["RECEPTION", "AUTHORIZATION", "VALIDITY"] as const;
export const PRODUCTION_ENDPOINT_VARIABLES = SERVICES.map((s) => `SRI_ENDPOINT_PRODUCTION_${s}`);
export const TEST_ENDPOINT_VARIABLES = SERVICES.map((s) => `SRI_ENDPOINT_TEST_${s}`);
/** Variables que fija la herramienta: el archivo no puede definirlas. */
export const MANAGED_VARIABLES = ["NODE_USE_ENV_PROXY", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY"];

export type EnvCheck = Readonly<{ name: string; ok: boolean; detail: string }>;

/** `KEY=VALUE` por línea, con comentarios y comillas simples o dobles. */
export function parseEnvFile(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2]!.trim();
    if (value.length >= 2 && /^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    values[match[1]!] = value;
  }
  return values;
}

const hostOf = (value: string) => {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
};
const isLoopback = (host: string | null) =>
  host === "127.0.0.1" || host === "localhost" || host === "[::1]";

/** Comprobaciones del entorno; ninguna imprime un valor. */
export function checkSessionEnv(env: Record<string, string>, pgPort: number): EnvCheck[] {
  const checks: EnvCheck[] = [];
  const productionNamed = Object.entries(env).some(
    ([name, value]) => name.startsWith("SRI_ENDPOINT_") && isProductionHost(hostOf(value) ?? ""),
  );
  checks.push({
    name: "no-production-endpoint",
    ok: !productionNamed,
    detail: productionNamed ? "PRODUCTION_ACCESS_BLOCKED" : "ningún endpoint nombra a Producción",
  });
  for (const name of PRODUCTION_ENDPOINT_VARIABLES) {
    const value = env[name];
    const host = value ? hostOf(value) : null;
    checks.push({
      name: `${name}-overridden`,
      ok: Boolean(value) && value!.startsWith("https://") && isLoopback(host),
      detail: !value
        ? "PRODUCTION_ACCESS_BLOCKED: sin sobrescribir, la aplicación usaría Producción"
        : "debe ser una URL https a una dirección local cerrada",
    });
  }
  for (const name of TEST_ENDPOINT_VARIABLES) {
    const value = env[name];
    if (value === undefined) continue;
    checks.push({
      name: `${name}-is-celcer`,
      ok: value.startsWith("https://") && hostOf(value) === SRI_TEST_HOST,
      detail: "un endpoint de Pruebas sobrescrito solo puede ser celcer.sri.gob.ec",
    });
  }
  const database = (() => {
    try {
      return env.DATABASE_URL ? new URL(env.DATABASE_URL) : null;
    } catch {
      return null;
    }
  })();
  checks.push({
    name: "database-through-local-bridge",
    ok:
      database !== null &&
      isLoopback(database.hostname.toLowerCase()) &&
      Number(database.port || 5432) === pgPort,
    detail: `DATABASE_URL debe apuntar a 127.0.0.1:${pgPort}, el puente del espacio de nombres`,
  });
  checks.push({
    name: "transmission-flag-defined",
    ok: env.SRI_TRANSMISSION_ENABLED === "0" || env.SRI_TRANSMISSION_ENABLED === "1",
    detail: `SRI_TRANSMISSION_ENABLED=${env.SRI_TRANSMISSION_ENABLED === "1" ? "1" : env.SRI_TRANSMISSION_ENABLED === "0" ? "0" : "sin definir"}`,
  });
  const managed = MANAGED_VARIABLES.filter((name) => name in env);
  checks.push({
    name: "proxy-variables-managed-by-tool",
    ok: managed.length === 0,
    detail:
      managed.length === 0
        ? "las fija la herramienta"
        : `quitar del archivo: ${managed.join(", ")}`,
  });
  return checks;
}
