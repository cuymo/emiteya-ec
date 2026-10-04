// Puertos del transporte SOAP con el SRI (add-sri-transmission, design D10; enmienda del ADR 0018).
// El transporte conserva el estado HTTP, las cabeceras seguras, el cuerpo exacto, los tiempos y la
// clase de fallo sin reinterpretarlos; la clasificación del cuerpo es de los parsers (D11 y D12).
import type { Environment } from "../../taxpayer/domain/taxpayer-config.ts";

/** Servicios web del SRI: recepción, autorización y consulta de validez (CTX §7). */
export const SRI_SERVICES = ["RECEPTION", "AUTHORIZATION", "VALIDITY"] as const;
export type SriService = (typeof SRI_SERVICES)[number];

/**
 * Resultado del transporte (design D10). Solo `NOT_SENT` demuestra que la solicitud no salió; los
 * plazos propios, un corte o una causa desconocida pudieron ocurrir después de enviarla.
 */
export const TRANSPORT_FAILURES = [
  "NOT_SENT",
  "REQUEST_TIMEOUT",
  "BODY_TIMEOUT",
  "CONNECTION_LOST",
] as const;
export type TransportFailure = (typeof TRANSPORT_FAILURES)[number];

/** Cabeceras seguras de la respuesta (lista permitida, design D7). */
export type SafeHeaders = Readonly<
  Partial<Record<"content-type" | "content-length" | "date", string>>
>;

export type TransportTimings = Readonly<{
  startedAt: Date;
  /** Llegada de las cabeceras; null si no llegaron. */
  headersAt: Date | null;
  completedAt: Date;
}>;

export type TransportOutcome =
  | (TransportTimings &
      Readonly<{
        kind: TransportFailure;
        /** Código de la causa (`ECONNREFUSED`, `UND_ERR_SOCKET`…), sin el mensaje original. */
        errorCode: string;
      }>)
  | (TransportTimings &
      Readonly<{
        kind: "RESPONSE";
        httpStatus: number;
        headers: SafeHeaders;
        /** Bytes exactos recibidos, hasta el límite configurado. */
        body: Buffer;
        /** El cuerpo superó el límite y se cortó: el intento queda incierto (design D7). */
        truncated: boolean;
      }>);

export type SriExchangeRequest = Readonly<{
  environment: Environment;
  service: SriService;
  envelope: Buffer;
}>;

/** Un intercambio con el SRI: dónde, qué se envió y qué volvió. */
export type SriExchange = Readonly<{
  service: SriService;
  environment: Environment;
  endpoint: string;
  envelope: Buffer;
  outcome: TransportOutcome;
}>;

export interface SriTransport {
  exchange(request: SriExchangeRequest): Promise<SriExchange>;
}

/** El circuit breaker del servicio está abierto: no hubo llamada (design D6). */
export type BreakerOpen = Readonly<{ breakerOpen: true; service: SriService; retryAt: Date }>;

/**
 * Operaciones con el SRI que usan los handlers de la transmisión. Las consultas por clave forman
 * el `SriInquiryPort` de la reconciliación (design D15).
 */
export interface SriGateway {
  /** `validarComprobante` con los bytes firmados exactos. */
  submit(environment: Environment, signedXml: Buffer): Promise<SriExchange | BreakerOpen>;
  /** `autorizacionComprobante` por la clave de acceso. */
  queryAuthorization(
    environment: Environment,
    accessKey: string,
  ): Promise<SriExchange | BreakerOpen>;
  /** `consultarEstadoAutorizacionComprobante` por la clave de acceso. */
  queryValidity(environment: Environment, accessKey: string): Promise<SriExchange | BreakerOpen>;
}

export type SriInquiryPort = Pick<SriGateway, "queryAuthorization" | "queryValidity">;

export const isBreakerOpen = (value: SriExchange | BreakerOpen): value is BreakerOpen =>
  "breakerOpen" in value;
