// Contratos de la numeración fiscal (add-fiscal-numbering, design D6, D9 y D12). Los seis códigos de
// comprobante son datos estructurales estables del protocolo (CTX §56) y viven solo aquí. El valor
// interno de agotado nunca forma parte de estos contratos: un contador agotado se representa con
// `exhausted: true` y `nextNumber: null`.
import { z } from "zod";
import { establishmentStatusSchema } from "./establishments.ts";
import { environmentSchema } from "./taxpayer.ts";

export const DOCUMENT_TYPES = ["01", "03", "04", "05", "06", "07"] as const;
export const documentTypeSchema = z.enum(DOCUMENT_TYPES, {
  error: "El tipo de comprobante no es válido.",
});
export type DocumentType = z.infer<typeof documentTypeSchema>;

/** Primer y último secuencial válidos: nueve dígitos (ERS RF-124, CTX §8.2). */
export const SEQUENTIAL_MIN = 1;
export const SEQUENTIAL_MAX = 999_999_999;
export const REASON_MAX_LENGTH = 300;

/** Secuencial de nueve dígitos con ceros a la izquierda: 1 -> "000000001". */
export function formatSequential(sequential: number): string {
  if (!Number.isInteger(sequential) || sequential < SEQUENTIAL_MIN || sequential > SEQUENTIAL_MAX) {
    throw new RangeError(`El secuencial ${sequential} está fuera del rango de nueve dígitos.`);
  }
  return String(sequential).padStart(9, "0");
}

/** Número del comprobante `EEE-PPP-SSSSSSSSS`. */
export function documentNumber(
  establishmentCode: string,
  emissionPointCode: string,
  sequential: number,
): string {
  return `${establishmentCode}-${emissionPointCode}-${formatSequential(sequential)}`;
}

const strict = <T extends z.core.$ZodLooseShape>(shape: T) =>
  z.strictObject(shape, {
    error: (issue) =>
      issue.code === "unrecognized_keys"
        ? "La solicitud contiene campos no permitidos."
        : "La solicitud no es válida.",
  });

const sequential = (message: string) =>
  z
    .number({ error: message })
    .int(message)
    .min(SEQUENTIAL_MIN, message)
    .max(SEQUENTIAL_MAX, message);

const reasonSchema = z
  .string({ error: "El motivo no es válido." })
  .normalize("NFC")
  .trim()
  .nullish()
  .transform((value) => (value ? value : null))
  .pipe(
    z
      .string()
      .max(REASON_MAX_LENGTH, `El motivo debe tener como máximo ${REASON_MAX_LENGTH} caracteres.`)
      .regex(/^[^\r\n]*$/, "El motivo no puede tener saltos de línea.")
      .nullable(),
  );

/**
 * PUT del ajuste: el siguiente secuencial deseado y el que el administrador vio. Retroceder exige
 * un motivo (ERS RF-125).
 */
export const adjustSequenceSchema = strict({
  nextNumber: sequential("El siguiente secuencial debe ser un número entero entre 1 y 999999999."),
  expectedNextNumber: sequential("El secuencial esperado no es válido."),
  reason: reasonSchema,
}).superRefine((input, ctx) => {
  if (input.nextNumber < input.expectedNextNumber && !input.reason) {
    ctx.addIssue({
      code: "custom",
      path: ["reason"],
      message: "Retroceder el secuencial exige un motivo.",
    });
  }
});
export type AdjustSequenceInput = z.input<typeof adjustSequenceSchema>;

export const sequenceParamsSchema = z.strictObject({
  establishmentId: z.string().min(1),
  emissionPointId: z.string().min(1),
  environment: environmentSchema,
  documentType: documentTypeSchema,
});

/** Consulta de la lista: no es estricta, de modo que un `companyId` en la consulta se ignora. */
export const sequencesQuerySchema = z.object({
  environment: environmentSchema,
});

export const fiscalSequenceViewSchema = z.strictObject({
  establishment: z.strictObject({
    id: z.string(),
    code: z.string(),
    status: establishmentStatusSchema,
  }),
  emissionPoint: z.strictObject({
    id: z.string(),
    code: z.string(),
    status: establishmentStatusSchema,
    available: z.boolean(),
  }),
  environment: environmentSchema,
  documentType: documentTypeSchema,
  /** `null` solo cuando el contador está agotado. */
  nextNumber: z.number().int().min(SEQUENTIAL_MIN).max(SEQUENTIAL_MAX).nullable(),
  lastReserved: z.number().int().min(SEQUENTIAL_MIN).max(SEQUENTIAL_MAX).nullable(),
  exhausted: z.boolean(),
});
export type FiscalSequenceView = z.infer<typeof fiscalSequenceViewSchema>;
