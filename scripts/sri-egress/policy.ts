// Política de salida de la sesión de certificación en Pruebas (docs/quality/sri-egress-allowlist.md).
// La única salida admitida es CONNECT a celcer.sri.gob.ec:443. Producción (cel.sri.gob.ec) queda
// bloqueada siempre, con un motivo propio. La decisión se toma sobre el nombre pedido, antes de
// resolver DNS o de abrir una conexión.

export const SRI_TEST_HOST = "celcer.sri.gob.ec";
export const SRI_TEST_PORT = 443;
export const SRI_PRODUCTION_HOSTS: readonly string[] = ["cel.sri.gob.ec"];

export type EgressReason =
  | "ALLOWED_SRI_TEST"
  | "PRODUCTION_ACCESS_BLOCKED"
  | "HOST_NOT_ALLOWED"
  | "PORT_NOT_ALLOWED"
  | "METHOD_NOT_ALLOWED"
  | "MALFORMED_TARGET";

export type EgressDecision = Readonly<{
  allowed: boolean;
  reason: EgressReason;
  host: string | null;
  port: number | null;
}>;

/** Nombre normalizado: en minúsculas y sin el punto final de un FQDN. */
const normalize = (host: string) => host.toLowerCase().replace(/\.$/, "");

export const isProductionHost = (host: string): boolean =>
  SRI_PRODUCTION_HOSTS.includes(normalize(host));

/** `host:puerto` de un CONNECT. Un literal IPv6 o cualquier otra forma es malformado. */
export function parseConnectTarget(target: string): { host: string; port: number } | null {
  const match = /^([A-Za-z0-9.-]+):(\d{1,5})$/.exec(target.trim());
  if (!match) return null;
  const port = Number(match[2]);
  if (port < 1 || port > 65_535) return null;
  return { host: normalize(match[1]!), port };
}

/** Destino de una petición HTTP de proxy (`GET http://host/...`), que nunca se reenvía. */
export function parseAbsoluteTarget(url: string): { host: string; port: number } | null {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname) return null;
    return {
      host: normalize(parsed.hostname),
      port: Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80)),
    };
  } catch {
    return null;
  }
}

const decision = (
  allowed: boolean,
  reason: EgressReason,
  target: { host: string; port: number } | null,
): EgressDecision => ({ allowed, reason, host: target?.host ?? null, port: target?.port ?? null });

/**
 * Decide una petición del proxy. Producción se reconoce antes que el método, para que todo intento de
 * llegar a ella quede marcado como PRODUCTION_ACCESS_BLOCKED.
 */
export function decideEgress(method: string, target: string): EgressDecision {
  const isConnect = method.toUpperCase() === "CONNECT";
  const parsed = isConnect ? parseConnectTarget(target) : parseAbsoluteTarget(target);
  if (!parsed) return decision(false, "MALFORMED_TARGET", null);
  if (isProductionHost(parsed.host)) return decision(false, "PRODUCTION_ACCESS_BLOCKED", parsed);
  if (!isConnect) return decision(false, "METHOD_NOT_ALLOWED", parsed);
  if (parsed.host !== SRI_TEST_HOST) return decision(false, "HOST_NOT_ALLOWED", parsed);
  if (parsed.port !== SRI_TEST_PORT) return decision(false, "PORT_NOT_ALLOWED", parsed);
  return decision(true, "ALLOWED_SRI_TEST", parsed);
}
