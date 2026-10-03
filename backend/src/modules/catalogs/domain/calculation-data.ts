// Si el catálogo publica los datos para calcular el impuesto de una tarifa (add-parties-and-products,
// design D2). Que una entrada exista no implica que se pueda calcular: hoy el ICE, el IRBPNR y el
// IVA diferenciado no tienen valores transcritos. Cuando un dataset posterior los traiga con su
// fuente, esta función lo reflejará sin que los consumidores cambien.
import type { RateKind } from "@facturador/contracts";

export type CalculationData = "COMPLETE" | "MISSING";

export function calculationDataStatus(version: {
  rateKind: RateKind | null;
  percentage: string | null;
}): CalculationData {
  switch (version.rateKind) {
    case "PERCENTAGE":
      return version.percentage === null ? "MISSING" : "COMPLETE";
    case "NOT_SUBJECT":
    case "EXEMPT":
      return "COMPLETE";
    default:
      // DIFFERENTIATED, PER_NORMATIVE, PER_UNIT o una entrada que no es una tarifa.
      return "MISSING";
  }
}
