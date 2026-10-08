// Errores de aplicación con código estable y mensaje para el usuario.
import type { ZodError } from "zod";

export class AppError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.status = status;
  }
}

export class NotFoundError extends AppError {
  constructor(code = "NOT_FOUND", message = "El recurso solicitado no existe.") {
    super(code, 404, message);
  }
}

export class ConflictError extends AppError {
  constructor(code: string, message: string) {
    super(code, 409, message);
  }
}

/** `503` con la espera sugerida, que el manejador de errores envía en `Retry-After`. */
export class ServiceUnavailableError extends AppError {
  readonly retryAfterSeconds: number;

  constructor(code: string, message: string, retryAfterSeconds: number) {
    super(code, 503, message);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class ValidationError extends AppError {
  readonly fields: string[];

  constructor(error: ZodError, message = "La solicitud no es válida.") {
    super("VALIDATION_ERROR", 400, message);
    this.fields = [...new Set(error.issues.map((issue) => issue.path.join(".")))];
  }
}

export class UnauthenticatedError extends AppError {
  constructor() {
    super("UNAUTHENTICATED", 401, "Inicia sesión para continuar.");
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "No tienes permiso para realizar esta acción.") {
    super("FORBIDDEN", 403, message);
  }
}
