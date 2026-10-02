// Cliente tipado de la API: interpreta los sobres de @facturador/contracts (docs/architecture/backend.md).
import { errorEnvelopeSchema, successEnvelope } from "@facturador/contracts";
import { z } from "zod";

export const API_BASE_PATH = "/api/v1";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId: string | undefined;

  constructor(code: string, status: number, message: string, requestId?: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.requestId = requestId;
  }
}

type ApiFetchOptions<T> = Omit<RequestInit, "body"> & { schema?: z.ZodType<T>; json?: unknown };

/** Llama a una ruta bajo /api/v1 y devuelve `data`, o lanza ApiError con el código y el requestId. */
export async function apiFetch<T = unknown>(
  path: string,
  options: ApiFetchOptions<T> = {},
): Promise<T> {
  const { schema, headers, json, ...init } = options;
  const response = await fetch(`${API_BASE_PATH}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      ...(json === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    ...(json === undefined ? {} : { body: JSON.stringify(json) }),
  });
  if (response.status === 204) return undefined as T;

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError(
      "INVALID_RESPONSE",
      response.status,
      "La respuesta del servidor no es válida.",
    );
  }

  if (!response.ok) {
    const parsed = errorEnvelopeSchema.safeParse(body);
    if (parsed.success) {
      const { code, message, requestId } = parsed.data.error;
      throw new ApiError(code, response.status, message, requestId);
    }
    throw new ApiError(
      "UNEXPECTED_RESPONSE",
      response.status,
      "El servidor respondió con un error inesperado.",
    );
  }

  const envelope = successEnvelope(schema ?? z.unknown()).safeParse(body);
  if (!envelope.success) {
    throw new ApiError(
      "INVALID_RESPONSE",
      response.status,
      "La respuesta del servidor no es válida.",
    );
  }
  return envelope.data.data as T;
}

/** Como apiFetch, pero devuelve también `meta` (listas paginadas). */
export async function apiFetchPage<T, M>(
  path: string,
  options: Omit<RequestInit, "body"> & { schema: z.ZodType<T>; meta: z.ZodType<M> },
): Promise<{ data: T; meta: M }> {
  const { schema, meta, headers, ...init } = options;
  const response = await fetch(`${API_BASE_PATH}${path}`, {
    ...init,
    headers: { accept: "application/json", ...headers },
  });
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const parsed = errorEnvelopeSchema.safeParse(body);
    if (parsed.success) {
      const { code, message, requestId } = parsed.data.error;
      throw new ApiError(code, response.status, message, requestId);
    }
    throw new ApiError(
      "UNEXPECTED_RESPONSE",
      response.status,
      "El servidor respondió con un error inesperado.",
    );
  }
  const page = z.strictObject({ data: schema, meta }).safeParse(body);
  if (!page.success) {
    throw new ApiError(
      "INVALID_RESPONSE",
      response.status,
      "La respuesta del servidor no es válida.",
    );
  }
  return page.data as { data: T; meta: M };
}
