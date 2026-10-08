// Manejador 404 y manejador de errores con el sobre { error: { code, message, requestId } }.
import type { ErrorRequestHandler, RequestHandler } from "express";
import type { ErrorEnvelope } from "@facturador/contracts";
import { AppError, NotFoundError, ServiceUnavailableError } from "./errors.ts";

type BodyParserError = Error & { type?: string };

export const notFound: RequestHandler = (_req, _res, next) => {
  next(new NotFoundError("ROUTE_NOT_FOUND", "La ruta solicitada no existe."));
};

function toAppError(error: unknown): AppError | undefined {
  if (error instanceof AppError) return error;
  const type = (error as BodyParserError | undefined)?.type;
  if (type === "entity.too.large")
    return new AppError("PAYLOAD_TOO_LARGE", 413, "El cuerpo de la solicitud es demasiado grande.");
  if (type === "entity.parse.failed")
    return new AppError("INVALID_JSON", 400, "El cuerpo de la solicitud no es JSON válido.");
  return undefined;
}

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const known = toAppError(error);
  if (!known) req.log.error({ err: error }, "error no controlado");
  const status = known?.status ?? 500;
  if (known instanceof ServiceUnavailableError) {
    res.set("Retry-After", String(known.retryAfterSeconds));
  }
  const body: ErrorEnvelope = {
    error: {
      code: known?.code ?? "INTERNAL_ERROR",
      message: known?.message ?? "Ocurrió un error interno. Intenta de nuevo más tarde.",
      requestId: req.requestId,
    },
  };
  res.status(status).json(body);
};
