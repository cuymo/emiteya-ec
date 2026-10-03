// Contrato de los catálogos de facturacion-electronica-ec frente a nuestros datasets (ADR 0018 y
// 0020; add-fiscal-catalogs, design D16). Compara los valores coincidentes (códigos y tarifas; las
// descripciones de la librería no son oficiales y no se comparan). Las divergencias conocidas están
// listadas: la prueba falla con cualquiera nueva, y ninguna se resuelve adoptando la librería.
import { canonicalDecimal } from "@facturador/contracts";
import { describe, expect, it } from "vitest";
import { DATASET_FILES } from "../../src/modules/catalogs/datasets/index.ts";
import { validateDatasets } from "../../src/modules/catalogs/domain/datasets.ts";
import { libraryCatalogs } from "../../src/modules/sri-engine/infrastructure/library-catalogs.ts";

type Entry = { code: string; rateKind?: string; percentage?: string | null };
const datasets = validateDatasets(DATASET_FILES);
const ours = (type: string) =>
  (datasets.find((d) => d.catalogType === type) as unknown as { entries: Entry[] }).entries;
const codes = (type: string) => [...new Set(ours(type).map((e) => e.code))].sort();

/** Divergencias conocidas, investigadas contra la ficha v2.34 (tabla 17 y su nota 3). */
const KNOWN_DIVERGENCES = [
  "iva-rate:5 ausente en la librería (la ficha publica el 5 %)",
  "iva-rate:8 la librería fija la tarifa 5; la ficha no fija tarifa para el IVA diferenciado",
  "iva-rate:10 ausente en la librería (la ficha publica el 13 %)",
];

function ivaDivergences(): string[] {
  const library = new Map(
    libraryCatalogs().ivaRates.map((r) => [r.code, canonicalDecimal(r.rate)]),
  );
  const found: string[] = [];
  for (const entry of ours("iva-rate")) {
    const rate = library.get(entry.code);
    if (rate === undefined) {
      found.push(
        `iva-rate:${entry.code} ausente en la librería (la ficha publica el ${entry.percentage} %)`,
      );
    } else if (entry.rateKind === "PERCENTAGE") {
      if (rate !== canonicalDecimal(entry.percentage!)) {
        found.push(
          `iva-rate:${entry.code} la librería fija la tarifa ${rate}; la ficha, ${entry.percentage}`,
        );
      }
    } else if (entry.rateKind === "DIFFERENTIATED") {
      found.push(
        `iva-rate:${entry.code} la librería fija la tarifa ${rate}; la ficha no fija tarifa para el IVA diferenciado`,
      );
    } else if (rate !== "0") {
      found.push(
        `iva-rate:${entry.code} la librería fija la tarifa ${rate} a una entrada sin porcentaje`,
      );
    }
  }
  for (const code of library.keys()) {
    if (!ours("iva-rate").some((e) => e.code === code))
      found.push(`iva-rate:${code} ausente en la ficha`);
  }
  return found.sort((a, b) => Number(/:(\d+)/.exec(a)![1]) - Number(/:(\d+)/.exec(b)![1]));
}

describe("catálogos de facturacion-electronica-ec frente a los datasets (ADR 0018)", () => {
  it("tipos de identificación, impuestos y formas de pago coinciden en sus códigos", () => {
    const library = libraryCatalogs();
    expect(library.identificationTypes).toEqual(codes("identification-type"));
    expect(library.taxCodes).toEqual(codes("tax"));
    expect(library.paymentMethods).toEqual(codes("payment-method"));
  });

  it("las tarifas de IVA solo divergen en lo conocido", () => {
    expect(ivaDivergences()).toEqual(KNOWN_DIVERGENCES);
  });

  it("nuestros datasets conservan sus propios valores donde la librería diverge", () => {
    const iva = ours("iva-rate");
    expect(iva.find((e) => e.code === "8")).toMatchObject({
      rateKind: "DIFFERENTIATED",
      percentage: null,
    });
    expect(iva.find((e) => e.code === "10")).toMatchObject({ percentage: "13" });
  });
});
