// Catálogos de retención y de sustento en la API y en las lecturas internas (add-withholding-receipts,
// design D7 a D12): consulta con la clasificación, el texto literal y los sustentos admitidos;
// resolución por fecha; utilizable solo si está soportada, vigente y habilitada; habilitación por
// empresa con su aislamiento, el 403 del operador y el rechazo de las entradas fuera de alcance.
import request from "../support/http-client.ts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DATASET_FILES } from "../../src/modules/catalogs/datasets/index.ts";
import {
  fiscalCatalogQueries,
  loadInstalledFiscalCatalogs,
  type FiscalCatalogQueries,
} from "../../src/modules/catalogs/infrastructure/index.ts";
import { createMember } from "./auth-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertCompany } from "./fixtures.ts";
import { buildTaxpayerApp, sessionCookie } from "./taxpayer-harness.ts";

type Withholding = {
  scopeClassification: string;
  selectable: boolean;
  percentage: string | null;
  rateText: string | null;
  allowedSupportCodes: string[] | null;
};
type Version = {
  id: string;
  officialLabel: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  sourceRef: string;
  rate: unknown;
  withholding: Withholding | null;
};
type Entry = {
  entryKey: string;
  code: string;
  applicable: Version | null;
  versions: Version[];
  enablement: { enabled: boolean; source: string };
  usable: boolean;
};
type Body = {
  data: Record<string, unknown> & { entries?: Entry[] };
  error: { code: string; message: string };
};
const bodyOf = (res: { body: unknown }) => res.body as Body;

// 10:00 del 6 de octubre de 2026 en Ecuador.
const NOW = new Date("2026-10-06T15:00:00Z");
const TODAY = "2026-10-06";
const concepts = (
  DATASET_FILES.find(
    (file) => (file as { catalogType: string }).catalogType === "withholding-income-concept",
  ) as { entries: { entryKey: string; scopeClassification: string }[] }
).entries;

describe("catálogos de retención y de sustento", () => {
  let db: MigratedSchema;
  let api: ReturnType<typeof buildTaxpayerApp>;
  let queries: FiscalCatalogQueries;
  let companyA: string;
  let companyB: string;
  const cookies: Record<string, string> = {};
  const call = (who: string, method: "get" | "put", path: string) =>
    request(api.app)[method](`/api/v1${path}`).set("Cookie", cookies[who]!);
  const entries = async (who: string, catalog: string, query = "") =>
    bodyOf(await call(who, "get", `/fiscal-catalogs/${catalog}/entries${query}`)).data.entries!;
  const entry = async (who: string, catalog: string, key: string, query = "") =>
    (await entries(who, catalog, query)).find((e) => e.entryKey === key)!;
  const setEnablement = (who: string, catalog: string, key: string, enabled: boolean) =>
    call(who, "put", `/fiscal-catalogs/${catalog}/entries/${key}/enablement`).send({ enabled });
  const audits = (companyId: string) =>
    db.database.prisma.auditEvent.findMany({
      where: { companyId, action: { startsWith: "fiscal_catalog." } },
      orderBy: { occurredAt: "asc" },
    });

  beforeAll(async () => {
    db = await createMigratedSchema("withholding_catalogs_api");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    api = buildTaxpayerApp(db, { now: () => NOW });
    queries = fiscalCatalogQueries(db.database.prisma);
    companyA = await insertCompany(db.database.prisma, "Empresa A");
    companyB = await insertCompany(db.database.prisma, "Empresa B");
    for (const [name, companyId, email, role] of [
      ["adminA", companyA, "admin@a.ec", "ADMIN"],
      ["operatorA", companyA, "operador@a.ec", "OPERATOR"],
      ["adminB", companyB, "admin@b.ec", "ADMIN"],
    ] as const) {
      await createMember(api.uow, companyId, { name, email, role });
      cookies[name] = await sessionCookie(api.app, email);
    }
  });

  afterAll(async () => {
    await db.drop();
  });

  describe("consulta", () => {
    it("los conceptos de la renta traen su clasificación, su porcentaje o su texto literal y su fuente", async () => {
      const list = await entries("operatorA", "withholding-income-concept");
      expect(list).toHaveLength(concepts.length);
      expect(list.find((e) => e.entryKey === "312C")).toMatchObject({
        code: "312C",
        applicable: {
          effectiveFrom: "2026-08-06",
          withholding: {
            scopeClassification: "SUPPORTED_FIXED_RESIDENT",
            selectable: true,
            percentage: "1.75",
            rateText: null,
            allowedSupportCodes: null,
          },
          rate: null,
        },
        enablement: { enabled: true, source: "DEFAULT" },
        usable: true,
      });
      expect(list.find((e) => e.entryKey === "346")?.applicable?.withholding).toMatchObject({
        scopeClassification: "OUT_OF_SCOPE_VARIABLE",
        selectable: false,
        percentage: null,
        rateText: "varios porcentajes",
      });
      expect(list.find((e) => e.entryKey === "500")?.applicable?.withholding).toMatchObject({
        scopeClassification: "OUT_OF_SCOPE_NON_RESIDENT",
        rateText: "25 o 37",
      });
      const catalog = bodyOf(
        await call("operatorA", "get", "/fiscal-catalogs/withholding-income-concept/entries"),
      ).data.catalog as { source: { sha256: string; publishedOn: string } };
      expect(catalog.source).toMatchObject({
        sha256: "bd3f7834f2cd31187af39cd2f4c685a646d7e49316e92ee493da5f2dd9776e3e",
        publishedOn: "2026-08-06",
      });
    });

    it("un código publicado con un espacio conserva el código literal y no es utilizable", async () => {
      expect(await entry("operatorA", "withholding-income-concept", "323-M")).toMatchObject({
        code: "323 M",
        applicable: {
          withholding: {
            scopeClassification: "OUT_OF_SCOPE_AMBIGUOUS_REPRESENTATION",
            selectable: false,
            percentage: "3",
          },
        },
        usable: false,
      });
    });

    it("solo los conceptos soportados son utilizables, sin un número fijado", async () => {
      const list = await entries("operatorA", "withholding-income-concept");
      const usable = list.filter((e) => e.usable).map((e) => e.entryKey);
      expect(usable).toEqual(
        list
          .filter(
            (e) => e.applicable?.withholding?.scopeClassification === "SUPPORTED_FIXED_RESIDENT",
          )
          .map((e) => e.entryKey),
      );
      expect(usable.sort()).toEqual(
        concepts
          .filter((c) => c.scopeClassification === "SUPPORTED_FIXED_RESIDENT")
          .map((c) => c.entryKey)
          .sort(),
      );
    });

    it("el código 7 del IVA es utilizable con 0 % y el 8 se conserva sin ser utilizable", async () => {
      const list = await entries("operatorA", "withholding-iva-code");
      expect(list.map((e) => [e.code, e.applicable?.withholding?.percentage, e.usable])).toEqual([
        ["1", "30", true],
        ["2", "70", true],
        ["3", "100", true],
        ["7", "0", true],
        ["8", "0", false],
        ["9", "10", true],
        ["10", "20", true],
        ["11", "50", true],
      ]);
      expect(list.find((e) => e.code === "7")?.applicable?.sourceRef).toContain(
        "NAC-DGERCGC15-00000284",
      );
    });

    it("los impuestos a retener: renta e IVA soportados, ISD fuera de alcance", async () => {
      const list = await entries("operatorA", "withholding-tax");
      expect(list.map((e) => [e.code, e.applicable?.officialLabel, e.usable])).toEqual([
        ["1", "RENTA", true],
        ["2", "IVA", true],
        ["6", "ISD", false],
      ]);
      expect(list[2]?.enablement).toEqual({ enabled: true, source: "NOT_ENABLEABLE" });
    });

    it("los tipos de documento sustento traen sus sustentos; la nota de venta sin el 01", async () => {
      const saleNote = await entry("operatorA", "support-document-type", "02");
      expect(saleNote).toMatchObject({
        code: "02",
        usable: true,
        applicable: {
          officialLabel: "Nota o boleta de venta",
          withholding: {
            scopeClassification: "SUPPORTED",
            allowedSupportCodes: ["02", "04", "05", "07", "08", "14", "15", "00"],
          },
        },
      });
      expect(saleNote.applicable?.withholding?.allowedSupportCodes).not.toContain("01");
      expect((await entry("operatorA", "support-document-type", "04")).usable).toBe(false);
      expect(
        (await entry("operatorA", "support-document-type", "373")).applicable?.withholding
          ?.allowedSupportCodes,
      ).toEqual([]);
    });

    it("el sustento 00 se ve con su vigencia cerrada y no es utilizable", async () => {
      const closed = await entry("operatorA", "support-code", "00");
      expect(closed.applicable).toBeNull();
      expect(closed.versions[0]).toMatchObject({ effectiveTo: "2015-02-28" });
      expect(closed.usable).toBe(false);
      expect(
        (await entry("operatorA", "support-code", "00", "?at=2015-02-28")).applicable?.withholding
          ?.scopeClassification,
      ).toBe("OUT_OF_SCOPE_EXPIRED");
      expect((await entry("operatorA", "support-code", "00", "?at=2015-02-28")).usable).toBe(false);
      expect((await entry("operatorA", "support-code", "01")).usable).toBe(true);
    });

    it("la versión aplicable se resuelve por fecha: antes del bloque vigente no hay concepto", async () => {
      expect(
        (await entry("operatorA", "withholding-income-concept", "303", "?at=2026-08-05"))
          .applicable,
      ).toBeNull();
      expect(
        (await entry("operatorA", "withholding-income-concept", "303", "?at=2026-08-05")).usable,
      ).toBe(false);
      expect(
        (await entry("operatorA", "withholding-income-concept", "303", "?at=2026-08-06")).usable,
      ).toBe(true);
    });
  });

  describe("lecturas internas", () => {
    it("el resolver da la versión vigente en la fecha y ninguna antes del bloque", async () => {
      expect(
        await queries.resolveCatalogEntry("withholding-income-concept", "312C", TODAY),
      ).toMatchObject({
        code: "312C",
        percentage: "1.75",
        scopeClassification: "SUPPORTED_FIXED_RESIDENT",
        effectiveFrom: "2026-08-06",
      });
      expect(
        await queries.resolveCatalogEntry("withholding-income-concept", "312C", "2026-08-05"),
      ).toBeNull();
      expect(await queries.resolveCatalogEntry("support-document-type", "03", TODAY)).toMatchObject(
        {
          allowedSupportCodes: ["01", "02", "03", "04", "05", "06", "07", "08", "14", "15"],
        },
      );
    });

    it("la disponibilidad combina clasificación, vigencia y habilitación de la empresa", async () => {
      const availability = await queries.availability(companyB, "withholding-iva-code", TODAY);
      expect(availability.get("7")).toMatchObject({ usable: true, enablement: { enabled: true } });
      expect(availability.get("8")).toMatchObject({ usable: false, enablement: { enabled: true } });
    });
  });

  describe("habilitación por empresa", () => {
    it("el operador no cambia la habilitación de un concepto", async () => {
      expect(
        (await setEnablement("operatorA", "withholding-income-concept", "303", false)).status,
      ).toBe(403);
      expect(await audits(companyA)).toEqual([]);
    });

    it("habilitar o deshabilitar una entrada fuera de alcance se rechaza siempre con el mismo motivo y nada cambia", async () => {
      // Una entrada de cada clasificación fuera de alcance de la renta, y el código 8 del IVA.
      const rejections: string[] = [];
      for (const [catalog, key, enabled] of [
        ["withholding-income-concept", "500", true], // no residente
        ["withholding-income-concept", "346", true], // porcentaje variable
        ["withholding-income-concept", "325", true], // estructura especial excluida
        ["withholding-income-concept", "323-M", true], // representación ambigua
        ["withholding-income-concept", "323-M", false],
        ["withholding-income-concept", "500", false],
        ["withholding-iva-code", "8", true],
        ["withholding-iva-code", "8", false],
      ] as const) {
        const res = await setEnablement("adminA", catalog, key, enabled);
        expect(res.status, `${catalog} ${key}`).toBe(400);
        expect(bodyOf(res).error.code).toBe("CATALOG_ENTRY_NOT_SELECTABLE");
        rejections.push(bodyOf(res).error.message);
      }
      expect(new Set(rejections).size).toBe(1);
      expect(await audits(companyA)).toEqual([]);
      expect(await db.database.prisma.companyFiscalCatalogSetting.count()).toBe(0);
      // Las entradas siguen en el catálogo, con su clasificación, sin poder usarse.
      for (const [catalog, key, classification] of [
        ["withholding-income-concept", "500", "OUT_OF_SCOPE_NON_RESIDENT"],
        ["withholding-income-concept", "346", "OUT_OF_SCOPE_VARIABLE"],
        ["withholding-income-concept", "325", "OUT_OF_SCOPE_SPECIAL_STRUCTURE"],
        ["withholding-income-concept", "323-M", "OUT_OF_SCOPE_AMBIGUOUS_REPRESENTATION"],
        ["withholding-iva-code", "8", "OUT_OF_SCOPE_AMBIGUOUS_REPRESENTATION"],
      ] as const) {
        const view = await entry("adminA", catalog, key);
        expect([view.usable, view.applicable?.withholding?.scopeClassification], key).toEqual([
          false,
          classification,
        ]);
      }
    });

    it("los catálogos de impuestos a retener y de sustento no admiten habilitación", async () => {
      for (const [catalog, key] of [
        ["withholding-tax", "1"],
        ["support-document-type", "01"],
        ["support-code", "01"],
      ] as const) {
        expect(bodyOf(await setEnablement("adminA", catalog, key, false)).error.code).toBe(
          "FISCAL_CATALOG_NOT_ENABLEABLE",
        );
      }
    });

    it("deshabilitar un concepto lo deja de ofrecer solo en esa empresa, con auditoría", async () => {
      const res = await setEnablement("adminA", "withholding-income-concept", "303", false);
      expect(res.status).toBe(200);
      expect(bodyOf(res).data).toMatchObject({
        entryKey: "303",
        enablement: { enabled: false, source: "COMPANY" },
        usable: false,
      });
      expect((await audits(companyA)).map((e) => [e.action, e.changes])).toEqual([
        [
          "fiscal_catalog.entry_disabled",
          expect.objectContaining({ catalogType: "withholding-income-concept", entryKey: "303" }),
        ],
      ]);
      expect((await entry("adminB", "withholding-income-concept", "303")).usable).toBe(true);
      expect(await audits(companyB)).toEqual([]);
      expect(
        (await queries.availability(companyA, "withholding-income-concept", TODAY)).get("303")
          ?.usable,
      ).toBe(false);
      expect(
        (await queries.availability(companyB, "withholding-income-concept", TODAY)).get("303")
          ?.usable,
      ).toBe(true);
      // La entrada oficial no cambia.
      expect((await entry("adminA", "withholding-income-concept", "303")).applicable).toEqual(
        (await entry("adminB", "withholding-income-concept", "303")).applicable,
      );
    });

    it("el código 7 de retención en cero se deshabilita y se vuelve a habilitar por empresa", async () => {
      expect(
        bodyOf(await setEnablement("adminB", "withholding-iva-code", "7", false)).data,
      ).toMatchObject({
        enablement: { enabled: false, source: "COMPANY" },
        usable: false,
      });
      expect((await entry("adminA", "withholding-iva-code", "7")).usable).toBe(true);
      const enabled = await setEnablement("adminB", "withholding-iva-code", "7", true);
      expect(enabled.status).toBe(200);
      const view = bodyOf(enabled).data as unknown as Entry;
      expect([view.entryKey, view.enablement, view.usable]).toEqual([
        "7",
        { enabled: true, source: "COMPANY" },
        true,
      ]);
      // Representa explícitamente una retención en cero: el 0 % del catálogo.
      expect(view.applicable?.withholding).toMatchObject({
        scopeClassification: "SUPPORTED_FIXED",
        selectable: true,
        percentage: "0",
      });
    });
  });
});
