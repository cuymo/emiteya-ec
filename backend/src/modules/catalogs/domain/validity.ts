// Vigencia de las versiones de una entrada (add-fiscal-catalogs, design D4 y D5). Fechas ISO
// (YYYY-MM-DD) del calendario de Ecuador, inclusivas en ambos extremos; sin fin, abierta. La
// comparación de cadenas ISO es cronológica.

export type IsoDate = string;

export type VersionRange = { effectiveFrom: IsoDate; effectiveTo: IsoDate | null };

const ECUADOR_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Guayaquil",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Fecha de hoy en Ecuador (ERS RNF-010), para los valores por defecto de la API. */
export const ecuadorDate = (now: Date): IsoDate => ECUADOR_DATE.format(now);

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const covers = (version: VersionRange, date: IsoDate) =>
  version.effectiveFrom <= date && (version.effectiveTo === null || date <= version.effectiveTo);

export function rangesOverlap(a: VersionRange, b: VersionRange): boolean {
  const aEnd = a.effectiveTo ?? "9999-12-31";
  const bEnd = b.effectiveTo ?? "9999-12-31";
  return a.effectiveFrom <= bEnd && b.effectiveFrom <= aEnd;
}

/**
 * La única regla de vigencia del producto: la versión que empieza en la fecha o antes y termina
 * en la fecha o después (o no termina). Las versiones de una entrada no se superponen, así que hay
 * como mucho una; si hubiera dos, los datos están corruptos y la resolución falla.
 */
export function resolveCatalogEntry<T extends VersionRange>(
  versions: readonly T[],
  effectiveDate: IsoDate,
): T | null {
  if (!ISO_DATE.test(effectiveDate))
    throw new Error(`fecha de vigencia inválida: ${effectiveDate}`);
  const matching = versions.filter((version) => covers(version, effectiveDate));
  if (matching.length > 1) throw new Error("versiones superpuestas de una misma entrada");
  return matching[0] ?? null;
}

/** true si alguna versión está vigente en la fecha o empieza después. */
export const hasCurrentOrFutureVersion = (versions: readonly VersionRange[], date: IsoDate) =>
  versions.some((version) => version.effectiveTo === null || version.effectiveTo >= date);
