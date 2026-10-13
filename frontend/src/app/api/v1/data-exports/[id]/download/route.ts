// Descarga del paquete de portabilidad en el mismo origen (add-data-portability, design D16). El
// reenvío general de /api (next.config.ts) corta una respuesta que tarda más de 30 s en empezar, y
// el backend verifica el SHA-256 completo del paquete antes del primer byte: con varios GB, eso
// supera ese plazo. Esta ruta reenvía la descarga al backend sin plazo de espera, con la cookie de
// la sesión, y devuelve su respuesta tal cual por streaming, sin almacenarla. La autenticación, el
// permiso, la empresa y la verificación siguen siendo del backend. En producción, sin
// API_INTERNAL_URL la descarga falla sin contactar a nadie (harden-production-configuration-and-
// clock-ownership, design D5).
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import { resolveApiInternalUrl } from "@/lib/api-internal-url";

export const dynamic = "force-dynamic";

const FORWARDED = ["cookie", "accept", "accept-language", "user-agent"] as const;
/** Cabeceras de un salto, que no se reenvían en ninguna dirección. */
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "te",
  "trailer",
  "upgrade",
]);

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let apiInternalUrl: string;
  try {
    apiInternalUrl = resolveApiInternalUrl(process.env.API_INTERNAL_URL, {
      required: process.env.NODE_ENV === "production",
    });
  } catch (error) {
    // El mensaje nombra la variable y la regla, nunca el valor.
    console.error((error as Error).message);
    return new Response(null, { status: 500, headers: { "cache-control": "no-store" } });
  }
  const target = new URL(`/api/v1/data-exports/${encodeURIComponent(id)}/download`, apiInternalUrl);
  const headers: Record<string, string> = { "x-forwarded-host": request.headers.get("host") ?? "" };
  for (const name of FORWARDED) {
    const value = request.headers.get(name);
    if (value) headers[name] = value;
  }
  let upstream: IncomingMessage;
  try {
    upstream = await new Promise<IncomingMessage>((resolve, reject) => {
      const send = target.protocol === "https:" ? httpsRequest : httpRequest;
      // Sin plazo: la verificación del paquete puede tardar; una desconexión del navegador la aborta.
      const outgoing = send(target, { method: "GET", headers, signal: request.signal }, resolve);
      outgoing.on("error", reject);
      outgoing.end();
    });
  } catch {
    return new Response(null, { status: 502 });
  }
  const responseHeaders = new Headers();
  for (const [name, value] of Object.entries(upstream.headers)) {
    if (value === undefined || HOP_BY_HOP.has(name)) continue;
    for (const item of Array.isArray(value) ? value : [value]) responseHeaders.append(name, item);
  }
  return new Response(Readable.toWeb(upstream) as ReadableStream<Uint8Array>, {
    status: upstream.statusCode ?? 502,
    headers: responseHeaders,
  });
}

/** Como el backend: HEAD nunca verifica ni audita una descarga. */
export function HEAD() {
  return new Response(null, { status: 405, headers: { Allow: "GET" } });
}
