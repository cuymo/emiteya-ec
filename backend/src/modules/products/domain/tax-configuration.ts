// Estado derivado de la configuración tributaria de un producto (add-parties-and-products, design
// D8). Se calcula en cada consulta con la disponibilidad de sus referencias en una fecha y nunca se
// guarda ni cambia las referencias. Que una entrada exista no implica que haya datos para calcular
// su impuesto.
import type { TaxConfigurationStatus, TaxReviewReason } from "@facturador/contracts";
import type { TaxReference } from "./product.ts";

/** Lo que `catalogs` publica de una entrada para la empresa en la fecha (design D2). */
export type ReferenceAvailability = {
  code: string;
  applicable: boolean;
  withdrawn: boolean;
  usable: boolean;
  calculationData: "COMPLETE" | "MISSING";
};

const REVIEW: readonly TaxReviewReason[] = ["NOT_IN_FORCE", "WITHDRAWN", "DISABLED"];

/** Motivo de una referencia, o null si está lista. */
export function referenceReason(
  availability: ReferenceAvailability | undefined,
): TaxReviewReason | null {
  if (!availability || !availability.applicable) {
    return availability?.withdrawn ? "WITHDRAWN" : "NOT_IN_FORCE";
  }
  if (!availability.usable) return "DISABLED";
  if (availability.calculationData === "MISSING") return "NO_CALCULATION_DATA";
  return null;
}

export type TaxConfiguration = {
  status: TaxConfigurationStatus;
  reasons: (TaxReference & { code: string; reason: TaxReviewReason })[];
};

/** `REVIEW_REQUIRED` > `INCOMPLETE` > `READY`, con el motivo de cada referencia afectada. */
export function taxConfiguration(
  references: readonly TaxReference[],
  lookup: (reference: TaxReference) => ReferenceAvailability | undefined,
): TaxConfiguration {
  const reasons = references.flatMap((reference) => {
    const availability = lookup(reference);
    const reason = referenceReason(availability);
    return reason ? [{ ...reference, code: availability?.code ?? reference.entryKey, reason }] : [];
  });
  const status: TaxConfigurationStatus = reasons.some((r) => REVIEW.includes(r.reason))
    ? "REVIEW_REQUIRED"
    : reasons.length > 0
      ? "INCOMPLETE"
      : "READY";
  return { status, reasons };
}

export const isReviewReason = (reason: TaxReviewReason) => REVIEW.includes(reason);
