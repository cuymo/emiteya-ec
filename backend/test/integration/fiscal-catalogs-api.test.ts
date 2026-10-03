// API de los catálogos fiscales con dos empresas (add-fiscal-catalogs, design D9, D11, D12 y D13):
// consulta de ambos roles, versión aplicable por fecha, valores por defecto y decisiones de la
// empresa, habilitación como estado deseado con auditoría solo de la transición real, aislamiento y
// ninguna ruta para modificar datos oficiales.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DATASET_FILES } from "../../src/modules/catalogs/datasets/index.ts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { createMember } from "./auth-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertCompany } from "./fixtures.ts";
import { buildTaxpayerApp, sessionCookie } from "./taxpayer-harness.ts";

type Entry = {
  entryKey: string;
  code: string;
  versions: { id: string; effectiveTo: string | null }[];
  applicable: {
    id: string;
    officialLabel: string;
    effectiveFrom: string;
    effectiveFromBasis: string;
    rate: { percentage: string | null; rateKind: string } | null;
  } | null;
  enablement: { enabled: boolean; source: string };
  usable: boolean;
};
type Body = { data: Record<string, unknown> & { entries?: Entry[] }; error: { code: string } };
const bodyOf = (res: { body: unknown }) => res.body as Body;

// 10:00 del 3 de octubre de 2026 en Ecuador.
const NOW = new Date("2026-10-03T15:00:00Z");
const IVA = 2;
const ICE = 3;

describe("API de los catálogos fiscales", () => {
  let db: MigratedSchema;
  let api: ReturnType<typeof buildTaxpayerApp>;
  let companyA: string;
  let companyB: string;
  const cookies: Record<string, string> = {};
  const call = (who: string, method: "get" | "put" | "post" | "patch", path: string) =>
    request(api.app)[method](`/api/v1${path}`).set("Cookie", cookies[who]!);
  const entries = async (who: string, catalog: string, query = "") =>
    bodyOf(await call(who, "get", `/fiscal-catalogs/${catalog}/entries${query}`)).data.entries!;
  const entry = async (who: string, catalog: string, key: string, query = "") =>
    (await entries(who, catalog, query)).find((e) => e.entryKey === key)!;
  const setEnablement = (who: string, catalog: string, key: string, enabled: unknown) =>
    call(who, "put", `/fiscal-catalogs/${catalog}/entries/${key}/enablement`).send({ enabled });
  const audits = (companyId: string) =>
    db.database.prisma.auditEvent.findMany({
      where: { companyId, action: { startsWith: "fiscal_catalog." } },
      orderBy: { occurredAt: "asc" },
    });

  beforeAll(async () => {
    db = await createMigratedSchema("fiscal_catalogs_api");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    api = buildTaxpayerApp(db, { now: () => NOW });
    companyA = await insertCompany(db.database.prisma, "Empresa A");
    companyB = await insertCompany(db.database.prisma, "Empresa B");
    for (const [name, companyId, email, role] of [
      ["adminA", companyA, "admin@a.ec", "ADMIN"],
      ["adminA2", companyA, "admin2@a.ec", "ADMIN"],
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
    it("ambos roles ven los seis catálogos con su fuente y su política", async () => {
      for (const who of ["adminA", "operatorA"]) {
        const res = await call(who, "get", "/fiscal-catalogs");
        expect(res.status).toBe(200);
        const catalogs = bodyOf(res).data as unknown as {
          catalogType: string;
          enablementPolicy: string;
          source: { version: string };
        }[];
        expect(catalogs.map((c) => [c.catalogType, c.enablementPolicy])).toEqual([
          ["identification-type", "NOT_ENABLEABLE"],
          ["tax", "NOT_ENABLEABLE"],
          ["iva-rate", "DEFAULT_ENABLED"],
          ["ice-rate", "DEFAULT_DISABLED"],
          ["irbpnr-rate", "DEFAULT_DISABLED"],
          ["payment-method", "DEFAULT_ENABLED"],
        ]);
        expect(catalogs.every((c) => c.source.version === "2.34")).toBe(true);
      }
    });

    it("las tarifas de IVA, con su versión aplicable hoy y la base de su fecha de inicio", async () => {
      const iva = await entries("operatorA", "iva-rate");
      expect(iva.map((e) => e.code)).toEqual(["0", "2", "3", "4", "5", "6", "7", "8", "10"]);
      const fifteen = iva.find((e) => e.code === "4")!;
      expect(fifteen.applicable).toMatchObject({
        officialLabel: "15%",
        effectiveFrom: "2026-07-27",
        effectiveFromBasis: "PROJECT_BASELINE",
        rate: { rateKind: "PERCENTAGE", percentage: "15" },
      });
      expect(fifteen.enablement).toEqual({ enabled: true, source: "DEFAULT" });
      expect(fifteen.usable).toBe(true);
      expect(iva.find((e) => e.code === "8")?.applicable?.rate).toMatchObject({
        rateKind: "DIFFERENTIATED",
        percentage: null,
      });
    });

    it("la versión aplicable sigue la fecha consultada, con sus bordes", async () => {
      expect((await entry("adminA", "iva-rate", "4", "?at=2026-07-26")).applicable).toBeNull();
      expect((await entry("adminA", "iva-rate", "4", "?at=2026-07-26")).usable).toBe(false);
      expect((await entry("adminA", "iva-rate", "4", "?at=2026-07-27")).applicable).not.toBeNull();
      const card = await entry("adminA", "payment-method", "19", "?at=2016-05-31");
      expect(card.applicable).toBeNull();
      expect(
        (await entry("adminA", "payment-method", "19", "?at=2016-06-01")).applicable,
      ).toMatchObject({
        effectiveFromBasis: "SOURCE_STATED",
      });
    });

    it("valores por defecto: ICE e IRBPNR deshabilitados; los demás, habilitados", async () => {
      expect((await entry("adminA", "ice-rate", "3041-GRAN-ESCALA")).enablement).toEqual({
        enabled: false,
        source: "DEFAULT",
      });
      expect((await entry("adminA", "irbpnr-rate", "5001")).usable).toBe(false);
      expect((await entry("adminA", "payment-method", "01")).enablement.enabled).toBe(true);
      expect((await entry("adminA", "identification-type", "04")).enablement).toEqual({
        enabled: true,
        source: "NOT_ENABLEABLE",
      });
      expect(await entries("adminA", "ice-rate", "?enabled=true")).toEqual([]);
      expect(await db.database.prisma.companyFiscalCatalogSetting.count()).toBe(0);
    });

    it("el código no es identidad: 3041 tiene tres entradas", async () => {
      const ice = await entries("adminA", "ice-rate");
      expect(ice).toHaveLength(75);
      expect(ice.filter((e) => e.code === "3041").map((e) => e.entryKey)).toEqual([
        "3041-GRAN-ESCALA",
        "3041-MEDIANA-ESCALA",
        "3041-PEQUENA-ESCALA",
      ]);
    });

    it("política de consumidor final, registro de esquemas y matriz", async () => {
      const policy = bodyOf(
        await call("operatorA", "get", "/fiscal-catalogs/consumer-final-policy"),
      ).data as { applicable: Record<string, unknown> };
      expect(policy.applicable).toMatchObject({
        maxAmount: "50",
        currency: "USD",
        identificationType: "07",
        identification: "9999999999999",
        canonicalName: "CONSUMIDOR FINAL",
        effectiveFromBasis: "PROJECT_BASELINE",
      });
      const schemas = bodyOf(await call("adminA", "get", "/fiscal-catalogs/schemas"))
        .data as unknown as {
        documentType: string;
      }[];
      expect(schemas.map((s) => s.documentType)).toEqual(["01", "03", "04", "05", "06", "07"]);
      const cases = bodyOf(await call("operatorA", "get", "/fiscal-catalogs/special-cases"))
        .data as unknown as { annex: number; category: string }[];
      expect(cases).toHaveLength(26);
      expect(cases.find((c) => c.annex === 26)?.category).toBe("CONDITIONAL_GO_LIVE");
    });

    it("las consultas no se auditan", async () => {
      expect(await audits(companyA)).toEqual([]);
    });
  });

  describe("habilitación", () => {
    it("el operador no cambia la habilitación", async () => {
      const res = await setEnablement("operatorA", "iva-rate", "3", false);
      expect(res.status).toBe(403);
      expect(await audits(companyA)).toEqual([]);
    });

    it("rechaza un catálogo sin habilitación, una entrada o un catálogo inexistente y campos ajenos", async () => {
      expect(
        bodyOf(await setEnablement("adminA", "identification-type", "04", false)).error.code,
      ).toBe("FISCAL_CATALOG_NOT_ENABLEABLE");
      expect((await setEnablement("adminA", "iva-rate", "99", false)).status).toBe(404);
      expect(bodyOf(await setEnablement("adminA", "otro", "4", false)).error.code).toBe(
        "FISCAL_CATALOG_NOT_FOUND",
      );
      const withCompany = await call(
        "adminA",
        "put",
        "/fiscal-catalogs/iva-rate/entries/3/enablement",
      ).send({
        enabled: false,
        companyId: companyB,
      });
      expect(withCompany.status).toBe(400);
      expect(await audits(companyA)).toEqual([]);
      expect(await db.database.prisma.companyFiscalCatalogSetting.count()).toBe(0);
    });

    it("deshabilitar es una decisión de la empresa, auditada una vez; repetirla no cambia nada", async () => {
      const res = await setEnablement("adminA", "iva-rate", "3", false);
      expect(res.status).toBe(200);
      expect(bodyOf(res).data).toMatchObject({
        entryKey: "3",
        enablement: { enabled: false, source: "COMPANY" },
        usable: false,
      });
      expect((await setEnablement("adminA", "iva-rate", "3", false)).status).toBe(200);
      const events = await audits(companyA);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        action: "fiscal_catalog.entry_disabled",
        actorType: "USER",
        changes: {
          catalogType: "iva-rate",
          entryKey: "3",
          code: "3",
          "enabled.from": true,
          "enabled.to": false,
        },
      });
    });

    it("volver al valor por defecto conserva la decisión y se audita", async () => {
      const res = await setEnablement("adminA", "iva-rate", "3", true);
      expect(bodyOf(res).data).toMatchObject({ enablement: { enabled: true, source: "COMPANY" } });
      expect((await audits(companyA)).map((e) => e.action)).toEqual([
        "fiscal_catalog.entry_disabled",
        "fiscal_catalog.entry_enabled",
      ]);
      expect(await db.database.prisma.companyFiscalCatalogSetting.count()).toBe(1);
    });

    it("la empresa B no ve ningún indicio de las decisiones de A", async () => {
      await setEnablement("adminA", "iva-rate", "2", false);
      expect((await entry("adminB", "iva-rate", "2")).enablement).toEqual({
        enabled: true,
        source: "DEFAULT",
      });
      expect(await audits(companyB)).toEqual([]);
    });

    it("habilitar un código de ICE lo hace utilizable para la empresa", async () => {
      const res = await setEnablement("adminA", "ice-rate", "3041-GRAN-ESCALA", true);
      expect(bodyOf(res).data).toMatchObject({
        code: "3041",
        enablement: { enabled: true, source: "COMPANY" },
        usable: true,
      });
      expect((await entry("adminA", "ice-rate", "3041-MEDIANA-ESCALA")).enablement.enabled).toBe(
        false,
      );
    });

    it("cambios simultáneos de la misma entrada dejan una sola transición auditada", async () => {
      const before = (await audits(companyA)).length;
      const results = await Promise.all([
        setEnablement("adminA", "payment-method", "17", false),
        setEnablement("adminA2", "payment-method", "17", false),
      ]);
      expect(results.map((r) => r.status)).toEqual([200, 200]);
      const events = await audits(companyA);
      expect(events).toHaveLength(before + 1);
      expect(events.at(-1)?.changes).toMatchObject({ entryKey: "17", "enabled.to": false });
    });
  });

  describe("versiones posteriores de los datasets", () => {
    it("una entrada nueva toma el valor por defecto sin copiar filas", async () => {
      const ice = structuredClone(DATASET_FILES[ICE]) as {
        version: number;
        entries: Record<string, unknown>[];
      };
      ice.version = 2;
      ice.entries.push({
        ...ice.entries[0]!,
        entryKey: "3999",
        code: "3999",
        officialLabel: "ICE de prueba",
      });
      const iva = structuredClone(DATASET_FILES[IVA]) as {
        version: number;
        entries: Record<string, unknown>[];
      };
      iva.version = 2;
      // El 12 % cerrado antes de hoy, y una tarifa nueva desde el próximo año.
      iva.entries[1] = { ...iva.entries[1]!, effectiveTo: "2026-08-31" };
      iva.entries.push({
        ...iva.entries[4]!,
        entryKey: "11",
        code: "11",
        officialLabel: "16%",
        percentage: "16",
        effectiveFrom: "2027-01-01",
      });
      const settings = await db.database.prisma.companyFiscalCatalogSetting.count();
      await loadInstalledFiscalCatalogs(db.database.prisma, [...DATASET_FILES, ice, iva]);
      expect((await entry("adminA", "ice-rate", "3999")).enablement).toEqual({
        enabled: false,
        source: "DEFAULT",
      });
      expect((await entry("adminB", "iva-rate", "11")).enablement).toEqual({
        enabled: true,
        source: "DEFAULT",
      });
      expect(await db.database.prisma.companyFiscalCatalogSetting.count()).toBe(settings);
    });

    it("una entrada vencida no es utilizable aunque la empresa la tenga habilitada", async () => {
      expect(await setEnablement("adminA", "iva-rate", "2", true)).toMatchObject({ status: 400 });
      const twelve = await entry("adminB", "iva-rate", "2");
      expect(twelve.enablement.enabled).toBe(true);
      expect(twelve.applicable).toBeNull();
      expect(twelve.usable).toBe(false);
      expect(bodyOf(await setEnablement("adminB", "iva-rate", "2", true)).error.code).toBe(
        "FISCAL_CATALOG_ENTRY_NOT_IN_FORCE",
      );
    });

    it("una entrada futura se puede habilitar, y aplica desde su inicio", async () => {
      expect((await setEnablement("adminA", "iva-rate", "11", false)).status).toBe(200);
      expect((await setEnablement("adminA", "iva-rate", "11", true)).status).toBe(200);
      const sixteen = await entry("adminA", "iva-rate", "11");
      expect(sixteen.applicable).toBeNull();
      expect((await entry("adminA", "iva-rate", "11", "?at=2027-01-01")).usable).toBe(true);
    });
  });

  it("no hay rutas para crear ni modificar datos oficiales", async () => {
    expect(
      (await call("adminA", "post", "/fiscal-catalogs/iva-rate/entries").send({ code: "99" }))
        .status,
    ).toBe(404);
    expect(
      (
        await call("adminA", "put", "/fiscal-catalogs/iva-rate/entries/4").send({
          percentage: "14",
        })
      ).status,
    ).toBe(404);
    expect(
      (await call("adminA", "patch", "/fiscal-catalogs/special-cases").send({ annex: 26 })).status,
    ).toBe(404);
    expect(
      (
        await call("adminA", "put", "/fiscal-catalogs/consumer-final-policy").send({
          maxAmount: "60",
        })
      ).status,
    ).toBe(404);
  });
});
