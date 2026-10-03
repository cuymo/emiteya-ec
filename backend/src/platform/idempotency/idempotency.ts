// Idempotencia durable de las operaciones con efecto fiscal (add-invoice-emission, design D8; Q-30):
// la cabecera `Idempotency-Key`, la huella canónica de la solicitud y el registro con alcance
// empresa, operación y clave. El registro no expira durante la vida fiscal del comprobante: no hay
// TTL corto. La base de datos es la última defensa (índice único).
import { createHash } from "node:crypto";
import { IDEMPOTENCY_KEY_HEADER, IDEMPOTENCY_KEY_PATTERN } from "@facturador/contracts";
import { AppError, ConflictError } from "../http/errors.ts";

/** Operaciones con registro de idempotencia; la base de datos acepta solo estas. */
export const IDEMPOTENT_OPERATIONS = ["invoice.emit"] as const;
export type IdempotentOperation = (typeof IDEMPOTENT_OPERATIONS)[number];

export const idempotencyKeyRequired = (message: string) =>
  new AppError("IDEMPOTENCY_KEY_REQUIRED", 400, message);

export const idempotencyKeyReused = () =>
  new ConflictError(
    "IDEMPOTENCY_KEY_REUSED",
    "Esta clave de idempotencia ya se usó con otra solicitud. Genera una clave nueva para otra emisión.",
  );

/** La clave de la cabecera; sin ella o con otro formato, `400 IDEMPOTENCY_KEY_REQUIRED`. */
export function readIdempotencyKey(value: string | readonly string[] | undefined): string {
  if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) {
    throw idempotencyKeyRequired(
      `La cabecera ${IDEMPOTENCY_KEY_HEADER} es obligatoria: identifica la solicitud para no emitir dos veces.`,
    );
  }
  if (typeof value !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw idempotencyKeyRequired(
      `La cabecera ${IDEMPOTENCY_KEY_HEADER} debe tener de 1 a 100 caracteres ASCII visibles.`,
    );
  }
  return value;
}

/** JSON canónico: claves ordenadas, sin espacios; solo valores JSON simples. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, field]) => field !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, field]) => `${JSON.stringify(key)}:${canonicalJson(field)}`).join(",")}}`;
}

/** SHA-256 hexadecimal del JSON canónico de la solicitud, con su operación. */
export const requestFingerprint = (operation: IdempotentOperation, request: object): string =>
  createHash("sha256")
    .update(canonicalJson({ ...request, operation }))
    .digest("hex");

export type IdempotencyRecord = Readonly<{
  companyId: string;
  operation: IdempotentOperation;
  key: string;
  fingerprint: string;
  documentId: string;
  createdBy: string;
  createdAt: Date;
}>;

/** Otra transacción confirmó antes la misma empresa, operación y clave. */
export class IdempotencyCollisionError extends Error {
  constructor() {
    super("La clave de idempotencia ya está registrada.");
    this.name = "IdempotencyCollisionError";
  }
}

export interface IdempotencyStore {
  find(
    companyId: string,
    operation: IdempotentOperation,
    key: string,
  ): Promise<IdempotencyRecord | null>;
  /** Dentro de la transacción de la operación; lanza IdempotencyCollisionError si ya existe. */
  insert(record: Omit<IdempotencyRecord, "createdAt">): Promise<void>;
}
