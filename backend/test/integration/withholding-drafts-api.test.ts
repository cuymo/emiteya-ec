// API de borradores, vista previa y opciones de las retenciones (add-withholding-receipts, tarea 6.2,
// design D5, D6, D11 a D13, D21 y D25): el período propuesto con el mes de hoy; la vista previa con
// los porcentajes y los valores del servidor y el total retenido; los problemas por documento y por
// retención; las opciones con solo las entradas utilizables, los sustentos compatibles por tipo, las
// tarifas de IVA con su porcentaje y las formas de pago de la empresa; los límites configurados; la
// versión del borrador; y `403`, `401` y otra empresa `404`. Un borrador no reserva número ni crea
// comprobantes.
import request from "../support/http-client.ts";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {
  WithholdingDraftSummaryView,
  WithholdingDraftView,
  WithholdingOptionsView,
} from "@facturador/contracts";
import { DATASET_FILES } from "../../src/modules/catalogs/datasets/index.ts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { certificateTasksEntry } from "../../src/modules/signing/infrastructure/index.ts";
import { createCryptoWorkerPool } from "../../src/platform/workers/crypto-worker-pool.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { CUSTODY, readyCompany, type ReadyCompany } from "./emission-harness.ts";
import { buildTaxpayerApp } from "./taxpayer-harness.ts";

type Body = {
  data: WithholdingDraftView & WithholdingDraftSummaryView[] & WithholdingOptionsView;
  meta?: { page: number; pageSize: number; total: number };
  error: { code: string; message: string };
};
const bodyOf = (res: { body: unknown }) => res.body as Body;

// 10:00 del 6 de octubre de 2026 en Ecuador.
const NOW = new Date("2026-10-06T15:00:00Z");
const SUPPORT = {
  documentType: "01",
  supportCode: "01",
  number: "001001000000123",
  issueDate: "2026-10-01",
  authorizationNumber: "1".repeat(49),
  totalWithoutTaxes: "100.29",
  importTotal: "115.33",
  taxes: [{ tax: "2", rateEntryKey: "4", base: "100.29", amount: "15.04" }],
  payments: [{ paymentMethod: "20", total: "115.33" }],
  withholdings: [
    { tax: "1", entryKey: "312C", base: "100.29" },
    { tax: "2", entryKey: "1", base: "15.04" },
  ],
};
const supportedConcepts = (
  DATASET_FILES.find(
    (file) => (file as { catalogType: string }).catalogType === "withholding-income-concept",
  ) as { entries: { entryKey: string; scopeClassification: string }[] }
).entries.filter((entry) => entry.scopeClassification === "SUPPORTED_FIXED_RESIDENT");

const CONCEPT_312C = (
  DATASET_FILES.find(
    (file) => (file as { catalogType: string }).catalogType === "withholding-income-concept",
  ) as { entries: { code: string; officialLabel: string }[] }
).entries.find((entry) => entry.code === "312C")!.officialLabel;

describe("API de borradores de retención", () => {
  let db: MigratedSchema;
  let api: ReturnType<typeof buildTaxpayerApp>;
  let limited: ReturnType<typeof buildTaxpayerApp>;
  let denied: ReturnType<typeof buildTaxpayerApp>;
  let a: ReadyCompany;
  let b: ReadyCompany;
  const pool = createCryptoWorkerPool({
    entry: certificateTasksEntry(),
    size: 2,
    timeoutMs: 30_000,
  });

  const call = (
    cookie: string,
    method: "get" | "post" | "put" | "delete",
    path: string,
    app = api,
  ) => request(app.app)[method](`/api/v1${path}`).set("Cookie", cookie);
  const draftBody = (overrides: Record<string, unknown> = {}) => ({
    partyId: a.supplierId,
    relatedParty: "NO",
    emissionPointId: a.emissionPointId,
    supports: [SUPPORT],
    ...overrides,
  });
  const createDraft = async (overrides: Record<string, unknown> = {}) => {
    const res = await call(a.cookies.operator, "post", "/withholding-receipts/drafts").send(
      draftBody(overrides),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return bodyOf(res).data;
  };
  const fiscalTrace = async () => ({
    documents: await db.database.prisma.electronicDocument.count({ where: { documentType: "07" } }),
    reservations: await db.database.prisma.fiscalSequenceReservation.count({
      where: { documentType: "07" },
    }),
    receipts: await db.database.prisma.withholdingReceipt.count(),
  });

  beforeAll(async () => {
    db = await createMigratedSchema("withholding_drafts_api");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    const now = () => NOW;
    api = buildTaxpayerApp(db, { signing: { pool, custody: CUSTODY }, now });
    limited = buildTaxpayerApp(db, {
      signing: { pool, custody: CUSTODY },
      now,
      withholdingReceipts: {
        limits: { supports: 1, itemsPerSupport: 2, taxesPerSupport: 1, paymentsPerSupport: 1 },
      },
    });
    denied = buildTaxpayerApp(db, {
      now,
      withholdingReceipts: { deny: ["withholdings.draft"] },
    });
    const p12Dir = inject("p12FixturesDir");
    a = await readyCompany(api, db, { slug: "retencion-a", pool, p12Dir });
    b = await readyCompany(api, db, { slug: "retencion-b", pool, p12Dir });
  }, 180_000);

  afterAll(async () => {
    await pool.close();
    await db?.drop();
  });

  describe("borrador y vista previa", () => {
    it("propone el período del mes de hoy y calcula cada retención con el catálogo, sin reservar nada", async () => {
      const draft = await createDraft();
      expect(draft).toMatchObject({
        version: 1,
        fiscalPeriod: "10/2026",
        relatedParty: "NO",
        party: { id: a.supplierId, identificationType: "04", legalName: "PROVEEDORA DEL SUR S.A." },
        emissionPoint: {
          id: a.emissionPointId,
          establishmentCode: "001",
          code: "001",
          available: true,
        },
      });
      expect(draft.supports[0]).toMatchObject({
        documentType: "01",
        number: "001001000000123",
        taxes: [{ tax: "2", rateEntryKey: "4", rate: null, base: "100.29", amount: "15.04" }],
      });
      expect(draft.preview).toEqual({
        evaluatedOn: "2026-10-06",
        issueMonth: "10/2026",
        periodDiffersFromIssueMonth: false,
        supports: [
          {
            position: 1,
            withholdings: [
              {
                position: 1,
                tax: "1",
                entryKey: "312C",
                code: "312C",
                label: CONCEPT_312C,
                base: "100.29",
                percentage: "1.75",
                amount: "1.76",
              },
              {
                position: 2,
                tax: "2",
                entryKey: "1",
                code: "1",
                label: "RETENCIÓN DEL IVA 30%",
                base: "15.04",
                percentage: "30",
                amount: "4.51",
              },
            ],
          },
        ],
        totals: { withheld: "6.27" },
        issues: [],
      });
      expect(await fiscalTrace()).toEqual({ documents: 0, reservations: 0, receipts: 0 });
    });

    it("un período anterior se conserva y se avisa; uno futuro es un problema", async () => {
      const earlier = await createDraft({ fiscalPeriod: "09/2026" });
      expect(earlier.fiscalPeriod).toBe("09/2026");
      expect(earlier.preview.periodDiffersFromIssueMonth).toBe(true);
      expect(earlier.preview.issues).toEqual([]);
      const future = await createDraft({ fiscalPeriod: "11/2026" });
      expect(future.preview.issues.map((i) => i.code)).toEqual([
        "WITHHOLDING_FISCAL_PERIOD_IN_FUTURE",
      ]);
    });

    it("informa los problemas junto a su documento y su retención, y calcula las válidas", async () => {
      const draft = await createDraft({
        relatedParty: null,
        supports: [
          SUPPORT,
          {
            ...SUPPORT,
            documentType: "02",
            supportCode: "01",
            number: "002001000000045",
            withholdings: [
              { tax: "1", entryKey: "346", base: "10.00" },
              { tax: "2", entryKey: "8", base: "1.00" },
              { tax: "1", entryKey: "303", base: "100.00" },
            ],
          },
        ],
      });
      expect(
        draft.preview.issues.map(({ code, support, withholding }) => [code, support, withholding]),
      ).toEqual([
        ["WITHHOLDING_RELATED_PARTY_REQUIRED", null, null],
        ["WITHHOLDING_SUPPORT_CODE_INCOMPATIBLE", 2, null],
        ["WITHHOLDING_CONCEPT_NOT_SUPPORTED", 2, 1],
        ["WITHHOLDING_IVA_CODE_NOT_SUPPORTED", 2, 2],
      ]);
      expect(
        draft.preview.supports.map((s) => s.withholdings.map((w) => [w.position, w.amount])),
      ).toEqual([
        [
          [1, "1.76"],
          [2, "4.51"],
        ],
        [[3, "10.00"]],
      ]);
      expect(draft.preview.totals).toBeNull();
    });

    it("un borrador incompleto se guarda y la vista previa dice lo que falta", async () => {
      const res = await call(a.cookies.admin, "post", "/withholding-receipts/drafts").send({});
      expect(res.status).toBe(201);
      expect(bodyOf(res).data).toMatchObject({
        party: null,
        relatedParty: null,
        fiscalPeriod: "10/2026",
        supports: [],
      });
      expect(bodyOf(res).data.preview.issues.map((i) => i.code)).toEqual([
        "WITHHOLDING_DRAFT_INCOMPLETE",
        "WITHHOLDING_RELATED_PARTY_REQUIRED",
        "WITHHOLDING_SUPPORTS_REQUIRED",
        "WITHHOLDING_DRAFT_INCOMPLETE",
      ]);
    });

    it("rechaza un cuerpo con porcentaje, valor o empresa, y una referencia de otra empresa", async () => {
      const withPercentage = await call(
        a.cookies.operator,
        "post",
        "/withholding-receipts/drafts",
      ).send(
        draftBody({
          supports: [
            {
              ...SUPPORT,
              withholdings: [{ tax: "1", entryKey: "312C", base: "1.00", percentage: "1.75" }],
            },
          ],
        }),
      );
      expect(withPercentage.status).toBe(400);
      // El ISD (impuesto 6) se rechaza indicando que está fuera del alcance actual.
      const isd = await call(a.cookies.operator, "post", "/withholding-receipts/drafts").send(
        draftBody({
          supports: [{ ...SUPPORT, withholdings: [{ tax: "6", entryKey: "4580", base: "1.00" }] }],
        }),
      );
      expect(isd.status).toBe(400);
      expect(bodyOf(isd).error.message).toContain(
        "el ISD y los demás impuestos están fuera del alcance actual",
      );
      expect(
        (
          await call(a.cookies.operator, "post", "/withholding-receipts/drafts").send(
            draftBody({ companyId: b.companyId }),
          )
        ).status,
      ).toBe(400);
      const foreignSupplier = await call(
        a.cookies.operator,
        "post",
        "/withholding-receipts/drafts",
      ).send(draftBody({ partyId: b.supplierId }));
      expect([foreignSupplier.status, bodyOf(foreignSupplier).error.code]).toEqual([
        404,
        "WITHHOLDING_SUBJECT_NOT_FOUND",
      ]);
      const foreignPoint = await call(
        a.cookies.operator,
        "post",
        "/withholding-receipts/drafts",
      ).send(draftBody({ emissionPointId: b.emissionPointId }));
      expect([foreignPoint.status, bodyOf(foreignPoint).error.code]).toEqual([
        400,
        "EMISSION_POINT_NOT_FOUND",
      ]);
    });

    it("respeta la versión del borrador al corregirlo y lo elimina sin rastro fiscal ni auditoría", async () => {
      const audited = () =>
        db.database.prisma.auditEvent.count({ where: { companyId: a.companyId } });
      const auditBefore = await audited();
      const draft = await createDraft();
      const updated = await call(
        a.cookies.operator,
        "put",
        `/withholding-receipts/drafts/${draft.id}`,
      ).send({
        ...draftBody({ relatedParty: "SI", fiscalPeriod: "09/2026" }),
        expectedVersion: 1,
      });
      expect(updated.status).toBe(200);
      expect(bodyOf(updated).data).toMatchObject({
        version: 2,
        relatedParty: "SI",
        fiscalPeriod: "09/2026",
      });
      const stale = await call(
        a.cookies.operator,
        "put",
        `/withholding-receipts/drafts/${draft.id}`,
      ).send({
        ...draftBody(),
        expectedVersion: 1,
      });
      expect([stale.status, bodyOf(stale).error.code]).toEqual([409, "WITHHOLDING_DRAFT_CHANGED"]);
      const fetched = await call(
        a.cookies.admin,
        "get",
        `/withholding-receipts/drafts/${draft.id}`,
      );
      expect(bodyOf(fetched).data).toMatchObject({ version: 2, relatedParty: "SI" });
      expect(
        (await call(a.cookies.operator, "delete", `/withholding-receipts/drafts/${draft.id}`))
          .status,
      ).toBe(204);
      expect(
        (await call(a.cookies.operator, "get", `/withholding-receipts/drafts/${draft.id}`)).status,
      ).toBe(404);
      expect(await fiscalTrace()).toEqual({ documents: 0, reservations: 0, receipts: 0 });
      // Crear, corregir, consultar y eliminar un borrador no deja eventos de auditoría.
      expect(await audited()).toBe(auditBefore);
    });

    it("lista los borradores con su proveedor, sus documentos y el total de la vista previa", async () => {
      const res = await call(
        a.cookies.operator,
        "get",
        "/withholding-receipts/drafts?pageSize=100",
      );
      expect(res.status).toBe(200);
      const summaries = bodyOf(res).data;
      expect(summaries.length).toBe(bodyOf(res).meta?.total);
      expect(
        summaries.find((s) => s.previewTotal === "6.27" && s.fiscalPeriod === "10/2026"),
      ).toMatchObject({
        partyName: "PROVEEDORA DEL SUR S.A.",
        fiscalPeriod: "10/2026",
        supportCount: 1,
        withholdingCount: 2,
      });
      expect(
        bodyOf(await call(b.cookies.operator, "get", "/withholding-receipts/drafts")).data,
      ).toEqual([]);
    });
  });

  describe("opciones", () => {
    it("ofrece solo los conceptos y códigos utilizables, con el porcentaje del catálogo", async () => {
      const res = await call(a.cookies.operator, "get", "/withholding-receipts/options");
      expect(res.status).toBe(200);
      const options = bodyOf(res).data;
      expect(options.evaluatedOn).toBe("2026-10-06");
      expect(options.withholdingTaxes).toEqual([
        { code: "1", label: "RENTA" },
        { code: "2", label: "IVA" },
      ]);
      expect(options.incomeConcepts.map((c) => c.entryKey).sort()).toEqual(
        supportedConcepts.map((c) => c.entryKey).sort(),
      );
      expect(options.incomeConcepts.find((c) => c.code === "312C")?.percentage).toBe("1.75");
      for (const excluded of ["323 M", "346", "500", "325", "332H"]) {
        expect(
          options.incomeConcepts.some((c) => c.code === excluded),
          excluded,
        ).toBe(false);
      }
      expect(options.ivaCodes.map((c) => [c.code, c.percentage])).toEqual([
        ["1", "30"],
        ["2", "70"],
        ["3", "100"],
        ["7", "0"],
        ["9", "10"],
        ["10", "20"],
        ["11", "50"],
      ]);
      expect(options.ivaCodes.find((c) => c.code === "7")?.sourceRef).toContain(
        "NAC-DGERCGC15-00000284",
      );
    });

    it("ofrece los tipos 01, 02 y 03 con sus sustentos compatibles y vigentes", async () => {
      const { documentTypes } = bodyOf(
        await call(a.cookies.operator, "get", "/withholding-receipts/options"),
      ).data;
      expect(
        documentTypes.map((type) => [type.code, type.supportCodes.map((c) => c.code)]),
      ).toEqual([
        ["01", ["01", "02", "03", "04", "05", "06", "07", "14", "15"]],
        ["02", ["02", "04", "05", "07", "14", "15"]],
        ["03", ["01", "02", "03", "04", "05", "06", "07", "14", "15"]],
      ]);
    });

    it("ofrece las tarifas de IVA con su porcentaje y vigencia, sin el IVA diferenciado, e ICE e IRBPNR", async () => {
      const { supportTaxes } = bodyOf(
        await call(a.cookies.operator, "get", "/withholding-receipts/options"),
      ).data;
      expect(supportTaxes.map((t) => [t.tax, t.label])).toEqual([
        ["2", "IVA"],
        ["3", "ICE"],
        ["5", "IRBPNR"],
      ]);
      const iva = supportTaxes[0]!.rates;
      expect(iva.find((r) => r.code === "4")).toMatchObject({
        rateKind: "PERCENTAGE",
        percentage: "15",
        effectiveFrom: "2026-07-27",
        effectiveTo: null,
      });
      expect(iva.find((r) => r.code === "6")).toMatchObject({
        rateKind: "NOT_SUBJECT",
        percentage: null,
      });
      expect(iva.some((r) => r.code === "8")).toBe(false);
      expect(supportTaxes[1]!.rates.length).toBeGreaterThan(50);
      expect(supportTaxes[2]!.rates.map((r) => r.code)).toEqual(["5001"]);
    });

    it("las formas de pago y los conceptos son los habilitados de la empresa", async () => {
      expect(
        (
          await call(
            a.cookies.admin,
            "put",
            "/fiscal-catalogs/payment-method/entries/17/enablement",
          ).send({ enabled: false })
        ).status,
      ).toBe(200);
      expect(
        (
          await call(
            a.cookies.admin,
            "put",
            "/fiscal-catalogs/withholding-income-concept/entries/303/enablement",
          ).send({ enabled: false })
        ).status,
      ).toBe(200);
      const ofA = bodyOf(
        await call(a.cookies.operator, "get", "/withholding-receipts/options"),
      ).data;
      const ofB = bodyOf(
        await call(b.cookies.operator, "get", "/withholding-receipts/options"),
      ).data;
      expect(ofA.paymentMethods.map((p) => p.code)).toEqual([
        "01",
        "15",
        "16",
        "18",
        "19",
        "20",
        "21",
      ]);
      expect(ofB.paymentMethods.map((p) => p.code)).toEqual([
        "01",
        "15",
        "16",
        "17",
        "18",
        "19",
        "20",
        "21",
      ]);
      expect(ofA.incomeConcepts.some((c) => c.code === "303")).toBe(false);
      expect(ofB.incomeConcepts.some((c) => c.code === "303")).toBe(true);
      // Un concepto deshabilitado deja de ser utilizable también en la vista previa.
      const draft = await createDraft({
        supports: [{ ...SUPPORT, withholdings: [{ tax: "1", entryKey: "303", base: "10.00" }] }],
      });
      expect(draft.preview.issues.map((i) => i.code)).toEqual(["WITHHOLDING_ENTRY_NOT_USABLE"]);
    });

    it("informa los límites efectivos por defecto", async () => {
      const { limits } = bodyOf(
        await call(a.cookies.operator, "get", "/withholding-receipts/options"),
      ).data;
      expect(limits).toEqual({
        supports: 10,
        itemsPerSupport: 5,
        taxesPerSupport: 5,
        paymentsPerSupport: 5,
      });
    });
  });

  describe("límites de recursos configurados", () => {
    it("aplica los límites al guardar, como defensa del sistema", async () => {
      const { limits } = bodyOf(
        await call(a.cookies.operator, "get", "/withholding-receipts/options", limited),
      ).data;
      expect(limits).toEqual({
        supports: 1,
        itemsPerSupport: 2,
        taxesPerSupport: 1,
        paymentsPerSupport: 1,
      });
      const tooMany = await call(
        a.cookies.operator,
        "post",
        "/withholding-receipts/drafts",
        limited,
      ).send(draftBody({ supports: [SUPPORT, SUPPORT] }));
      expect([tooMany.status, bodyOf(tooMany).error.code]).toEqual([
        409,
        "WITHHOLDING_RESOURCE_LIMIT",
      ]);
      expect(bodyOf(tooMany).error.message).toContain("no un límite del SRI");
      const items = await call(
        a.cookies.operator,
        "post",
        "/withholding-receipts/drafts",
        limited,
      ).send(
        draftBody({
          supports: [
            {
              ...SUPPORT,
              withholdings: [...SUPPORT.withholdings, { tax: "1", entryKey: "303", base: "1.00" }],
            },
          ],
        }),
      );
      expect([items.status, bodyOf(items).error.code]).toEqual([409, "WITHHOLDING_RESOURCE_LIMIT"]);
      expect(
        (
          await call(a.cookies.operator, "post", "/withholding-receipts/drafts", limited).send(
            draftBody(),
          )
        ).status,
      ).toBe(201);
    });
  });

  describe("acceso", () => {
    it("sin el permiso del borrador responde 403 sin leer ni escribir", async () => {
      const before = await db.database.prisma.withholdingReceiptDraft.count();
      for (const [method, path] of [
        ["get", "/withholding-receipts/options"],
        ["get", "/withholding-receipts/suppliers"],
        ["get", "/withholding-receipts/drafts"],
        ["post", "/withholding-receipts/drafts"],
      ] as const) {
        const res = await call(a.cookies.operator, method, path, denied).send(
          method === "post" ? draftBody() : undefined,
        );
        expect(res.status, path).toBe(403);
      }
      expect(await db.database.prisma.withholdingReceiptDraft.count()).toBe(before);
    });

    it("sin sesión responde 401 y el borrador de otra empresa, 404", async () => {
      for (const path of [
        "/withholding-receipts/options",
        "/withholding-receipts/drafts",
        "/withholding-receipts/suppliers",
      ]) {
        expect((await request(api.app).get(`/api/v1${path}`)).status, path).toBe(401);
      }
      const draft = await createDraft();
      for (const [method, body] of [
        ["get", undefined],
        ["put", { ...draftBody(), expectedVersion: 1 }],
        ["delete", undefined],
      ] as const) {
        const res = await call(
          b.cookies.admin,
          method,
          `/withholding-receipts/drafts/${draft.id}`,
        ).send(body);
        expect([res.status, bodyOf(res).error.code], method).toEqual([
          404,
          "WITHHOLDING_DRAFT_NOT_FOUND",
        ]);
      }
      expect(
        (await call(a.cookies.operator, "get", `/withholding-receipts/drafts/${draft.id}`)).status,
      ).toBe(200);
    });
  });
});
