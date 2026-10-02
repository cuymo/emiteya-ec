// Esquemas de establecimientos, puntos de emisión y punto predeterminado propio
// (add-taxpayer-setup, design D7, D8 y D12). Los códigos tienen tres dígitos (XSD `estab` y
// `ptoEmi`) y no cambian después del alta, así que ninguna edición acepta `code`. Un punto no tiene
// más atributos que su código y su estado: editarlo es activarlo o desactivarlo.
import { z } from "zod";
import { fiscalText } from "./taxpayer.ts";

export const SRI_CODE_PATTERN = /^[0-9]{3}$/;

export const sriCodeSchema = z
  .string({ error: "El código es obligatorio." })
  .regex(SRI_CODE_PATTERN, "El código debe tener exactamente tres dígitos.");

export const establishmentStatusSchema = z.enum(["ACTIVE", "INACTIVE"], {
  error: "El estado no es válido.",
});
export type EstablishmentStatus = z.infer<typeof establishmentStatusSchema>;

const strict = <T extends z.core.$ZodLooseShape>(shape: T) =>
  z.strictObject(shape, {
    error: (issue) =>
      issue.code === "unrecognized_keys"
        ? "La solicitud contiene campos no permitidos."
        : "La solicitud no es válida.",
  });

/** XSD `dirEstablecimiento`; obligatoria por ERS RF-110 aunque el XSD la haga opcional. */
const addressSchema = fiscalText(
  "La dirección del establecimiento",
  "La dirección del establecimiento es obligatoria.",
);

export const createEstablishmentSchema = strict({ code: sriCodeSchema, address: addressSchema });
export const updateEstablishmentSchema = strict({ address: addressSchema });
export const changeEstablishmentStatusSchema = strict({ status: establishmentStatusSchema });
export const createEmissionPointSchema = strict({ code: sriCodeSchema });
export const setDefaultEmissionPointSchema = strict({
  emissionPointId: z
    .string({ error: "El punto de emisión no es válido." })
    .min(1, "El punto de emisión no es válido.")
    .nullable(),
});

export type CreateEstablishmentInput = z.infer<typeof createEstablishmentSchema>;
export type UpdateEstablishmentInput = z.infer<typeof updateEstablishmentSchema>;
export type ChangeEstablishmentStatusInput = z.infer<typeof changeEstablishmentStatusSchema>;
export type CreateEmissionPointInput = z.infer<typeof createEmissionPointSchema>;
export type SetDefaultEmissionPointInput = z.infer<typeof setDefaultEmissionPointSchema>;

export const establishmentIdParamsSchema = z.strictObject({ establishmentId: z.string().min(1) });
export const emissionPointParamsSchema = z.strictObject({
  establishmentId: z.string().min(1),
  emissionPointId: z.string().min(1),
});

/** Un punto está disponible para emitir solo si él y su establecimiento están activos. */
export const emissionPointViewSchema = z.strictObject({
  id: z.string(),
  code: z.string(),
  status: establishmentStatusSchema,
  available: z.boolean(),
});

export const establishmentViewSchema = z.strictObject({
  id: z.string(),
  code: z.string(),
  address: z.string(),
  status: establishmentStatusSchema,
  emissionPoints: z.array(emissionPointViewSchema),
});

export const defaultEmissionPointViewSchema = z
  .strictObject({
    establishment: z.strictObject({
      id: z.string(),
      code: z.string(),
      address: z.string(),
      status: establishmentStatusSchema,
    }),
    emissionPoint: z.strictObject({
      id: z.string(),
      code: z.string(),
      status: establishmentStatusSchema,
    }),
    available: z.boolean(),
  })
  .nullable();

export type EmissionPointView = z.infer<typeof emissionPointViewSchema>;
export type EstablishmentView = z.infer<typeof establishmentViewSchema>;
export type DefaultEmissionPointView = z.infer<typeof defaultEmissionPointViewSchema>;
