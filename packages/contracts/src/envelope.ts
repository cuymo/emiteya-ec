// Sobres de respuesta de la API (docs/architecture/backend.md, REST / API Conventions).
import { z } from "zod";

export const errorBodySchema = z.strictObject({
  code: z.string().min(1),
  message: z.string().min(1),
  requestId: z.string().min(1),
});

export const errorEnvelopeSchema = z.strictObject({ error: errorBodySchema });

export const metaSchema = z.record(z.string(), z.unknown());

export function successEnvelope<T extends z.ZodType>(data: T) {
  return z.strictObject({ data, meta: metaSchema.optional() });
}

export type ErrorBody = z.infer<typeof errorBodySchema>;
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
export type SuccessEnvelope<T> = { data: T; meta?: Record<string, unknown> };
