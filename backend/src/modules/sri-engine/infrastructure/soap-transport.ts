// Transporte SOAP propio sobre el `fetch` nativo de Node (add-sri-transmission, design D10;
// enmienda del ADR 0018, excepción a Axios). Es el único lugar del producto que llama al SRI.
//
// Frontera conservadora: solo es `NOT_SENT` lo que se puede demostrar. `fetch` escribe la solicitud
// después de conectar y completar el TLS, así que un fallo de DNS, una conexión rechazada, el plazo
// de conexión interno de Node o un fallo de verificación TLS prueban que nada salió. Un plazo
// propio es siempre ambiguo, porque `fetch` no expone si ya conectó: por eso no hay plazo de
// conexión propio, y el de cabeceras, el de cuerpo, un corte o una causa desconocida son inciertos.
import type {
  SafeHeaders,
  SriExchange,
  SriExchangeRequest,
  SriTransport,
  TransportDiagnostic,
  TransportFailure,
} from "../application/transport.ts";
import type { SriEndpoints } from "./endpoints.ts";

const PRE_CONNECTION_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "UND_ERR_CONNECT_TIMEOUT",
]);

/**
 * Fallos de verificación del certificado del servidor (Node y OpenSSL): el handshake TLS falló
 * antes de escribir nada. Otros errores TLS, que pueden ocurrir con la conexión ya abierta, no
 * prueban nada y quedan inciertos.
 */
const TLS_VERIFICATION =
  /^CERT_|SELF_SIGNED|^DEPTH_ZERO_|^UNABLE_TO_(?:GET_ISSUER_CERT|GET_ISSUER_CERT_LOCALLY|VERIFY_LEAF_SIGNATURE|DECRYPT_CERT_SIGNATURE)$|^ERR_TLS_CERT_ALTNAME_INVALID$|^HOSTNAME_MISMATCH$/;

const SAFE_HEADERS = ["content-type", "content-length", "date"] as const;

/** Códigos de la cadena de causas de un error de `fetch`, del más externo al más interno. */
export function causeCodes(error: unknown): string[] {
  const codes: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") codes.push(code);
    current = (current as { cause?: unknown }).cause;
  }
  return codes;
}

const text = (value: unknown, max: number): string | null =>
  typeof value === "string" || typeof value === "number" ? String(value).slice(0, max) : null;

/**
 * Diagnóstico de un fallo sin contenido (improve-sri-transport-failure-diagnostics, design D1): de la
 * cadena de causas solo el nombre, el código y la llamada al sistema, y los bytes escritos y leídos
 * del primer eslabón que los trae (el `SocketError` de undici). Nunca el mensaje, que puede llevar el
 * host o la dirección, ni la dirección o el puerto del socket.
 */
export function failureDiagnostic(
  error: unknown,
  phase: TransportDiagnostic["phase"],
): TransportDiagnostic {
  const causes: { name: string; code: string | null; syscall: string | null }[] = [];
  let socket: TransportDiagnostic["socket"] = null;
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    const link = current as { name?: unknown; code?: unknown; syscall?: unknown; socket?: unknown };
    causes.push({
      name: text(link.name, 40) ?? "Error",
      code: text(link.code, 40),
      syscall: text(link.syscall, 20),
    });
    const counters = link.socket as { bytesWritten?: unknown; bytesRead?: unknown } | undefined;
    if (
      socket === null &&
      typeof counters?.bytesWritten === "number" &&
      typeof counters.bytesRead === "number"
    )
      socket = { bytesWritten: counters.bytesWritten, bytesRead: counters.bytesRead };
    current = (current as { cause?: unknown }).cause;
  }
  return { phase, causes, socket };
}

/**
 * Clase de un fallo de `fetch` antes de recibir las cabeceras. `NOT_SENT` solo con una causa
 * anterior a la conexión; cualquier otra, o ninguna, puede haber ocurrido después de enviar.
 */
export function classifyRequestFailure(error: unknown): {
  kind: TransportFailure;
  errorCode: string;
} {
  const codes = causeCodes(error);
  const proof = codes.find((code) => PRE_CONNECTION_CODES.has(code) || TLS_VERIFICATION.test(code));
  if (proof) return { kind: "NOT_SENT", errorCode: proof };
  return { kind: "CONNECTION_LOST", errorCode: codes[0] ?? "UNKNOWN" };
}

class OwnTimeout extends Error {
  readonly phase: "REQUEST" | "BODY";
  constructor(phase: "REQUEST" | "BODY") {
    super(`plazo de ${phase === "REQUEST" ? "cabeceras" : "cuerpo"} agotado`);
    this.name = "OwnTimeout";
    this.phase = phase;
  }
}

function safeHeaders(headers: Headers): SafeHeaders {
  const safe: Partial<Record<(typeof SAFE_HEADERS)[number], string>> = {};
  for (const name of SAFE_HEADERS) {
    const value = headers.get(name);
    if (value !== null) safe[name] = value.slice(0, 200);
  }
  return safe;
}

/** Lee el cuerpo hasta `maxBytes`; si lo supera, corta la lectura y lo marca. */
async function readLimited(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<{ body: Buffer; truncated: boolean }> {
  if (!body) return { body: Buffer.alloc(0), truncated: false };
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return { body: Buffer.concat(chunks, size), truncated: false };
    const remaining = maxBytes - size;
    if (value.byteLength > remaining) {
      chunks.push(Buffer.from(value.subarray(0, remaining)));
      await reader.cancel().catch(() => {});
      return { body: Buffer.concat(chunks, maxBytes), truncated: true };
    }
    chunks.push(Buffer.from(value));
    size += value.byteLength;
  }
}

export type SoapTransportOptions = Readonly<{
  endpoints: SriEndpoints;
  /** Plazo desde el inicio hasta recibir las cabeceras (`SRI_REQUEST_TIMEOUT_MS`). */
  requestTimeoutMs: number;
  /** Plazo de lectura del cuerpo (`SRI_BODY_TIMEOUT_MS`). */
  bodyTimeoutMs: number;
  /** Tamaño máximo de una respuesta (`SRI_RESPONSE_MAX_BYTES`). */
  maxResponseBytes: number;
  now?: () => Date;
}>;

export function createSoapTransport(options: SoapTransportOptions): SriTransport {
  const now = options.now ?? (() => new Date());

  return {
    async exchange({ environment, service, envelope }: SriExchangeRequest): Promise<SriExchange> {
      const endpoint = options.endpoints[environment][service];
      const exchange = { service, environment, endpoint, envelope };
      const controller = new AbortController();
      const startedAt = now();
      let timer = setTimeout(
        () => controller.abort(new OwnTimeout("REQUEST")),
        options.requestTimeoutMs,
      );
      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "text/xml; charset=utf-8",
            accept: "text/xml",
            soapaction: '""',
          },
          body: envelope,
          signal: controller.signal,
          // Un 307 o 308 repetiría el envío en otra dirección: la redirección se clasifica.
          redirect: "manual",
        });
      } catch (error) {
        clearTimeout(timer);
        const failure =
          controller.signal.reason instanceof OwnTimeout
            ? { kind: "REQUEST_TIMEOUT" as const, errorCode: "REQUEST_TIMEOUT" }
            : classifyRequestFailure(error);
        return {
          ...exchange,
          outcome: {
            ...failure,
            diagnostic: failureDiagnostic(error, "BEFORE_HEADERS"),
            startedAt,
            headersAt: null,
            completedAt: now(),
          },
        };
      }
      clearTimeout(timer);
      const headersAt = now();
      timer = setTimeout(() => controller.abort(new OwnTimeout("BODY")), options.bodyTimeoutMs);
      try {
        const { body, truncated } = await readLimited(response.body, options.maxResponseBytes);
        return {
          ...exchange,
          outcome: {
            kind: "RESPONSE",
            httpStatus: response.status,
            headers: safeHeaders(response.headers),
            body,
            truncated,
            startedAt,
            headersAt,
            completedAt: now(),
          },
        };
      } catch (error) {
        const timedOut = controller.signal.reason instanceof OwnTimeout;
        return {
          ...exchange,
          outcome: {
            kind: timedOut ? "BODY_TIMEOUT" : "CONNECTION_LOST",
            errorCode: timedOut ? "BODY_TIMEOUT" : (causeCodes(error)[0] ?? "UNKNOWN"),
            diagnostic: failureDiagnostic(error, "BODY"),
            startedAt,
            headersAt,
            completedAt: now(),
          },
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
