// Errores de la portabilidad (add-data-portability, design D10 y D17). Una falla de la generación
// lleva un código seguro, sin rutas ni detalles internos; las de la API, su estado HTTP.
import type { DataExportFailureCode } from "@facturador/contracts";
import { AppError } from "../../../platform/http/errors.ts";

/** Una falla determinista de la generación: la exportación queda `FAILED` con su código. */
export class ExportFailure extends Error {
  readonly code: DataExportFailureCode;
  constructor(code: DataExportFailureCode) {
    super(code);
    this.code = code;
  }
}

export class DataExportInProgressError extends AppError {
  constructor() {
    super("DATA_EXPORT_IN_PROGRESS", 409, "Ya hay una exportación en cola o generándose.");
  }
}

export class DataExportNotFoundError extends AppError {
  constructor() {
    super("DATA_EXPORT_NOT_FOUND", 404, "La exportación no existe.");
  }
}

export class DataExportNotReadyError extends AppError {
  constructor() {
    super("DATA_EXPORT_NOT_READY", 409, "La exportación todavía no está lista.");
  }
}

export class DataExportExpiredError extends AppError {
  constructor() {
    super("DATA_EXPORT_EXPIRED", 410, "El paquete caducó; genera una exportación nueva.");
  }
}

/**
 * El cliente se desconectó durante la verificación, antes del primer byte: no hay respuesta que
 * enviar ni una descarga que registrar.
 */
export class DownloadAbortedError extends Error {
  constructor() {
    super("el cliente abandonó la descarga antes del primer byte");
    this.name = "DownloadAbortedError";
  }
}

/** El paquete listo falta o no coincide: no se envía ningún byte y la exportación queda fallida. */
export class DataExportPackageError extends AppError {
  constructor(code: "DATA_EXPORT_PACKAGE_MISSING" | "DATA_EXPORT_PACKAGE_INTEGRITY") {
    super(
      code,
      500,
      code === "DATA_EXPORT_PACKAGE_MISSING"
        ? "El paquete de la exportación ya no está disponible; genera uno nuevo."
        : "El paquete de la exportación no pasó la verificación de integridad; genera uno nuevo.",
    );
  }
}
