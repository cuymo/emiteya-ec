// Lecturas internas de los catálogos fiscales sin sesión (add-parties-and-products, design D2):
// política de consumidor final por fecha, reglas de identificación y disponibilidad de entradas por
// empresa y fecha, con aislamiento entre empresas.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DATASET_FILES } from "../../src/modules/catalogs/datasets/index.ts";
import {
  fiscalCatalogQueries,
  loadInstalledFiscalCatalogs,
  type FiscalCatalogQueries,
} from "../../src/modules/catalogs/infrastructure/index.ts";
import { createEnablementRepository } from "../../src/modules/catalogs/infrastructure/prisma-catalogs.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertCompany, insertMember } from "./fixtures.ts";

const TODAY = "2026-10-03";
const IVA = 2;

describe("lecturas internas de los catálogos fiscales", () => {
  let db: MigratedSchema;
  let queries: FiscalCatalogQueries;
  let companyA: string;
  let companyB: string;
  let userA: string;

  beforeAll(async () => {
    db = await createMigratedSchema("fiscal_catalog_queries");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    queries = fiscalCatalogQueries(db.database.prisma);
    companyA = await insertCompany(db.database.prisma, "Empresa A");
    companyB = await insertCompany(db.database.prisma, "Empresa B");
    userA = (await insertMember(db.database.prisma, companyA, { name: "Ana", role: "ADMIN" }))
      .userId;
  });

  afterAll(async () => {
    await db.drop();
  });

  it("la política de consumidor final se resuelve por fecha, con sus bordes", async () => {
    expect(await queries.consumerFinalPolicy("2026-07-26")).toBeNull();
    expect(await queries.consumerFinalPolicy("2026-07-27")).toMatchObject({
      identificationType: "07",
      identification: "9999999999999",
      canonicalName: "CONSUMIDOR FINAL",
      maxAmount: "50",
    });
  });

  it("las reglas de identificación salen del catálogo vigente", async () => {
    expect(await queries.identificationRule("04", TODAY)).toMatchObject({
      officialLabel: "RUC",
      pattern: "^[0-9]{10}001$",
      reservedFor: null,
    });
    expect(await queries.identificationRule("07", TODAY)).toMatchObject({
      reservedFor: "CONSUMER_FINAL",
    });
    expect(await queries.identificationRule("09", TODAY)).toBeNull();
    expect(await queries.identificationRule("04", "2026-07-26")).toBeNull();
  });

  it("IVA: habilitado por defecto, con datos de cálculo salvo el diferenciado", async () => {
    const iva = await queries.availability(companyA, "iva-rate", TODAY);
    expect(iva.size).toBe(9);
    expect(iva.get("4")).toMatchObject({
      code: "4",
      enablement: { enabled: true, source: "DEFAULT" },
      usable: true,
      withdrawn: false,
      calculationData: "COMPLETE",
    });
    expect(iva.get("4")!.applicable?.percentage).toBe("15");
    expect(iva.get("8")).toMatchObject({ usable: true, calculationData: "MISSING" });
    expect(iva.get("6")!.calculationData).toBe("COMPLETE");
  });

  it("ICE: deshabilitado por defecto, sin datos de cálculo, y la decisión de A no alcanza a B", async () => {
    const before = await queries.availability(companyA, "ice-rate", TODAY);
    expect(before.size).toBe(75);
    expect(before.get("3011")).toMatchObject({
      enablement: { enabled: false, source: "DEFAULT" },
      usable: false,
      calculationData: "MISSING",
    });
    await createEnablementRepository(db.database.prisma).saveDecision(
      companyA,
      "ice-rate",
      "3011",
      true,
      userA,
    );
    expect((await queries.availability(companyA, "ice-rate", TODAY)).get("3011")).toMatchObject({
      enablement: { enabled: true, source: "COMPANY" },
      usable: true,
    });
    expect((await queries.availability(companyB, "ice-rate", TODAY)).get("3011")).toMatchObject({
      enablement: { enabled: false, source: "DEFAULT" },
      usable: false,
    });
  });

  it("una entrada antes de su inicio no es utilizable", async () => {
    const card = (await queries.availability(companyA, "payment-method", "2016-05-31")).get("19")!;
    expect(card.applicable).toBeNull();
    expect(card.usable).toBe(false);
  });

  it("vencida, retirada y futura, según una versión posterior del dataset", async () => {
    const iva = structuredClone(DATASET_FILES[IVA]) as {
      version: number;
      entries: Record<string, unknown>[];
    };
    iva.version = 2;
    iva.entries[1] = { ...iva.entries[1]!, effectiveTo: "2026-08-31" };
    iva.entries[2] = {
      ...iva.entries[2]!,
      effectiveTo: "2026-09-30",
      normativeStatus: "WITHDRAWN",
    };
    iva.entries.push({
      ...iva.entries[4]!,
      entryKey: "11",
      code: "11",
      officialLabel: "16%",
      percentage: "16",
      effectiveFrom: "2027-01-01",
    });
    await loadInstalledFiscalCatalogs(db.database.prisma, [...DATASET_FILES, iva]);
    const today = await queries.availability(companyA, "iva-rate", TODAY);
    expect(today.get("2")).toMatchObject({ applicable: null, withdrawn: false, usable: false });
    expect(today.get("3")).toMatchObject({ applicable: null, withdrawn: true, usable: false });
    expect(today.get("11")).toMatchObject({ applicable: null, usable: false });
    expect(today.get("11")!.latest.officialLabel).toBe("16%");
    expect((await queries.availability(companyA, "iva-rate", "2026-08-31")).get("2")!.usable).toBe(
      true,
    );
    expect((await queries.availability(companyA, "iva-rate", "2027-01-01")).get("11")!.usable).toBe(
      true,
    );
  });
});
