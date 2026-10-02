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

type ApiFetchOptions<T> = RequestInit & { schema?: z.ZodType<T> };

/** Llama a una ruta bajo /api/v1 y devuelve `data`, o lanza ApiError con el código y el requestId. */
export async function apiFetch<T = unknown>(
  path: string,
  options: ApiFetchOptions<T> = {},
): Promise<T> {
  const { schema, headers, ...init } = options;
  const response = await fetch(`${API_BASE_PATH}${path}`, {
    ...init,
    headers: { accept: "application/json", ...headers },
  });

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
