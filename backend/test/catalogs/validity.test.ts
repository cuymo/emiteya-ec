// La única regla de vigencia del producto (add-fiscal-catalogs, design D4 y D5).
import { describe, expect, it } from "vitest";
import { createCatalogResolver } from "../../src/modules/catalogs/application/resolver.ts";
import type { StoredEntryVersion } from "../../src/modules/catalogs/application/ports.ts";
import {
  ecuadorDate,
  hasCurrentOrFutureVersion,
  resolveCatalogEntry,
} from "../../src/modules/catalogs/domain/validity.ts";

const versions = [
  { id: "a", effectiveFrom: "2026-07-27", effectiveTo: "2026-12-31" },
  { id: "b", effectiveFrom: "2027-01-01", effectiveTo: null },
];

describe("resolveCatalogEntry", () => {
  it("el último día de vigencia aplica, y el siguiente ya no", () => {
    expect(resolveCatalogEntry(versions, "2026-12-31")?.id).toBe("a");
    expect(resolveCatalogEntry(versions, "2027-01-01")?.id).toBe("b");
  });

  it("antes del inicio no aplica ninguna; sin fin, aplica siempre después", () => {
    expect(resolveCatalogEntry(versions, "2026-07-26")).toBeNull();
    expect(resolveCatalogEntry(versions, "2026-07-27")?.id).toBe("a");
    expect(resolveCatalogEntry(versions, "2099-01-01")?.id).toBe("b");
  });

  it("una entrada cerrada no aplica después de su fin", () => {
    expect(resolveCatalogEntry([versions[0]!], "2027-01-01")).toBeNull();
  });

  it("falla con versiones superpuestas o una fecha inválida", () => {
    expect(() =>
      resolveCatalogEntry(
        [versions[1]!, { id: "c", effectiveFrom: "2027-06-01", effectiveTo: null }],
        "2027-07-01",
      ),
    ).toThrow("versiones superpuestas");
    expect(() => resolveCatalogEntry(versions, "01/01/2027")).toThrow("fecha de vigencia inválida");
  });

  it("vigente o futura", () => {
    expect(hasCurrentOrFutureVersion([versions[0]!], "2026-12-31")).toBe(true);
    expect(hasCurrentOrFutureVersion([versions[0]!], "2027-01-01")).toBe(false);
    expect(
      hasCurrentOrFutureVersion([{ effectiveFrom: "2030-01-01", effectiveTo: null }], "2027-01-01"),
    ).toBe(true);
  });

  it("la fecha de hoy es la de Ecuador", () => {
    // 2026-10-03T03:00Z son todavía las 22:00 del 2 de octubre en Guayaquil (UTC-5).
    expect(ecuadorDate(new Date("2026-10-03T03:00:00Z"))).toBe("2026-10-02");
    expect(ecuadorDate(new Date("2026-10-03T06:00:00Z"))).toBe("2026-10-03");
  });
});

describe("resolveCatalogEntry como puerto de aplicación", () => {
  const version = (
    id: string,
    effectiveFrom: string,
    effectiveTo: string | null,
  ): StoredEntryVersion => ({
    id,
    catalogType: "iva-rate",
    entryKey: "4",
    code: "4",
    officialLabel: "15%",
    effectiveFrom,
    effectiveFromBasis: "PROJECT_BASELINE",
    effectiveTo,
    normativeStatus: "OFFICIAL",
    sourceRef: "Tabla 17, página 30",
    datasetVersion: 1,
    taxKind: "IVA",
    sriTaxCode: "2",
    rateKind: "PERCENTAGE",
    percentage: "15",
    identificationPattern: null,
    identificationRule: null,
    reservedFor: null,
  });

  it("reproduce la misma versión de una fecha pasada después de añadir otra", async () => {
    let stored = [version("v1", "2026-07-27", null)];
    const resolver = createCatalogResolver({ entryVersions: () => Promise.resolve(stored) });
    const before = await resolver.resolveCatalogEntry("iva-rate", "4", "2026-10-03");
    stored = [
      version("v1", "2026-07-27", "2026-12-31"),
      { ...version("v2", "2027-01-01", null), percentage: "13" },
    ];
    const after = await resolver.resolveCatalogEntry("iva-rate", "4", "2026-10-03");
    expect(after?.id).toBe(before?.id);
    expect(after?.percentage).toBe("15");
    expect((await resolver.resolveCatalogEntry("iva-rate", "4", "2027-02-01"))?.id).toBe("v2");
  });
});
