// Emisión de comprobantes de retención por HTTP (add-withholding-receipts, tarea 7.1, design D12 a
// D17, D23 y D26): una retención de un documento y otra de varios documentos firmadas con su propio
// contador; la vista previa, el snapshot, el XML y la consulta con los mismos valores; cada rechazo de
// la evaluación sin reservar número, incluida la prueba negativa sin documentos ni retenciones; un
// porcentaje que cambia en el catálogo después de reservar no cambia el XML firmado; el doble envío
// secuencial y simultáneo con una sola retención; la repetición que reanuda la firma; la clave
// reutilizada o ausente; la auditoría sin XML ni SOAP; y las métricas.
import { randomUUID } from "node:crypto";
import { Registry } from "@prometheus-io/client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { WithholdingDraftView, WithholdingReceiptView } from "@facturador/contracts";
import { DATASET_FILES } from "../../src/modules/catalogs/datasets/index.ts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { certificateTasksEntry } from "../../src/modules/signing/infrastructure/index.ts";
import type { WithholdingSnapshot } from "../../src/modules/withholding-receipts/domain/snapshot.ts";
import { createWithholdingDraftRepository } from "../../src/modules/withholding-receipts/infrastructure/prisma-drafts.ts";
import { createCryptoWorkerPool } from "../../src/platform/workers/crypto-worker-pool.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { CUSTODY, readyCompany, type ReadyCompany } from "./emission-harness.ts";
import { buildTaxpayerApp } from "./taxpayer-harness.ts";

type Body = {
  data: WithholdingReceiptView & WithholdingDraftView;
  error: { code: string; message: string };
};
const bodyOf = (res: { body: unknown }) => res.body as Body;
type App = ReturnType<typeof buildTaxpayerApp>;
const compact = (xml: string) => xml.replace(/>\s+</g, "><");

// 10:00 del 6 de octubre de 2026 en Ecuador.
let clock = new Date("2026-10-06T15:00:00Z");
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

describe("emisión de comprobantes de retención", () => {
  let db: MigratedSchema;
  let api: App;
  let reserving: App;
  let a: ReadyCompany;
  let unsigned: ReadyCompany;
  const registry = new Registry();
  const pool = createCryptoWorkerPool({
    entry: certificateTasksEntry(),
    size: 2,
    timeoutMs: 30_000,
  });

  const draft = async (overrides: Record<string, unknown> = {}, company = a) => {
    const res = await request(api.app)
      .post("/api/v1/withholding-receipts/drafts")
      .set("Cookie", company.cookies.operator)
      .send({
        partyId: company.supplierId,
        relatedParty: "NO",
        emissionPointId: company.emissionPointId,
        supports: [SUPPORT],
        ...overrides,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return bodyOf(res).data;
  };
  const emit = (
    app: App,
    created: { id: string; version: number },
    key: string | null = randomUUID(),
    company = a,
  ) => {
    const req = request(app.app)
      .post("/api/v1/withholding-receipts")
      .set("Cookie", company.cookies.operator);
    return (key === null ? req : req.set("Idempotency-Key", key)).send({
      draftId: created.id,
      expectedVersion: created.version,
    });
  };
  const trace = async () => ({
    documents: await db.database.prisma.electronicDocument.count({ where: { documentType: "07" } }),
    sequences: await db.database.prisma.fiscalSequenceReservation.count({
      where: { documentType: "07" },
    }),
    counters: (
      await db.database.prisma.fiscalSequence.findMany({
        where: { documentType: "07" },
        orderBy: { id: "asc" },
      })
    ).map((counter) => counter.nextNumber),
    receipts: await db.database.prisma.withholdingReceipt.count(),
    lines: await db.database.prisma.withholdingReceiptLine.count(),
    audit: await db.database.prisma.auditEvent.count({
      where: { action: { startsWith: "withholding_receipt." } },
    }),
    idempotency: await db.database.prisma.idempotencyRecord.count({
      where: { operation: "withholding_receipt.emit" },
    }),
  });
  const signedXml = async (documentId: string) =>
    Buffer.from(
      (
        await db.database.prisma.documentArtifact.findFirstOrThrow({
          where: { documentId, kind: "SIGNED_XML" },
        })
      ).content,
    ).toString("utf8");
  const metric = async (name: string) => (await registry.getSingleMetricAsString(name)) ?? "";

  beforeAll(async () => {
    db = await createMigratedSchema("withholding_emission");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    const now = () => clock;
    api = buildTaxpayerApp(db, {
      signing: { pool, custody: CUSTODY },
      withholdingReceipts: { metrics: registry },
      now,
    });
    reserving = buildTaxpayerApp(db, {
      signing: { pool, custody: CUSTODY },
      withholdingReceipts: { signAfterReserve: false },
      now,
    });
    a = await readyCompany(api, db, {
      slug: "emision-ret",
      pool,
      p12Dir: inject("p12FixturesDir"),
      profile: { withholdingAgentResolution: "1" },
    });
    unsigned = await readyCompany(api, db, { slug: "emision-ret-sin-firma" });
  }, 180_000);

  afterAll(async () => {
    await pool.close();
    await db?.drop();
  });

  it("una retención de un documento y otra de varios quedan firmadas con su propio contador", async () => {
    const single = await emit(api, await draft());
    expect(single.status, JSON.stringify(single.body)).toBe(201);
    const receipt = bodyOf(single).data;
    expect(receipt).toMatchObject({
      documentType: "07",
      state: "SIGNED",
      documentNumber: "001-001-000000001",
      fiscalPeriod: "10/2026",
      subject: { partyId: a.supplierId, identificationType: "04", identification: "1791234567001" },
      relatedParty: { value: "NO", basis: "USER_DECLARED", declaredBy: a.operatorId },
      totals: { withheld: "6.27" },
    });
    expect(receipt.relatedParty.declaredByName).toBe("Operador emision-ret");
    expect(receipt.accessKey.slice(8, 10)).toBe("07");
    expect(receipt.supports[0]).toMatchObject({
      position: 1,
      documentType: "01",
      documentTypeLabel: "Factura",
      supportCode: "01",
      number: "001001000000123",
      taxes: [{ tax: "2", taxLabel: "IVA", rateCode: "4", rate: "15", rateBasis: "CATALOG" }],
      payments: [{ code: "20", total: "115.33" }],
    });
    expect(
      receipt.supports[0]!.withholdings.map((w) => [w.tax, w.code, w.percentage, w.amount]),
    ).toEqual([
      ["1", "312C", "1.75", "1.76"],
      ["2", "1", "30", "4.51"],
    ]);

    const multiple = await emit(
      api,
      await draft({
        supports: [
          SUPPORT,
          {
            ...SUPPORT,
            documentType: "02",
            supportCode: "02",
            number: "002001000000045",
            authorizationNumber: "1122334455",
            withholdings: [{ tax: "1", entryKey: "303", base: "500.00" }],
          },
          {
            ...SUPPORT,
            documentType: "03",
            supportCode: "07",
            number: "001002000000007",
            authorizationNumber: null,
            withholdings: [{ tax: "2", entryKey: "7", base: "15.04" }],
          },
        ],
      }),
    );
    expect(multiple.status, JSON.stringify(multiple.body)).toBe(201);
    expect(bodyOf(multiple).data).toMatchObject({
      documentNumber: "001-001-000000002",
      totals: { withheld: "56.27" },
    });
    // El contador del tipo 07 es propio: una factura nueva sigue su numeración.
    const counters = await db.database.prisma.fiscalSequence.findMany({
      where: { companyId: a.companyId },
      select: { documentType: true, nextNumber: true },
    });
    expect(counters.find((c) => c.documentType === "07")?.nextNumber).toBe(3);
    expect(counters.some((c) => c.documentType === "01")).toBe(false);

    const artifact = await db.database.prisma.documentArtifact.findFirstOrThrow({
      where: { documentId: bodyOf(multiple).data.id, kind: "SIGNED_XML" },
    });
    expect(artifact.metadata).toMatchObject({
      documentType: "07",
      schemaPath: "sri-xsd/ComprobanteRetencion_V2.0.0.xsd",
    });
    const xml = compact(await signedXml(bodyOf(multiple).data.id));
    for (const code of ["01", "02", "03"]) {
      expect(xml).toContain(`<codDocSustento>${code}</codDocSustento>`);
    }
    expect(xml).toContain("<agenteRetencion>1</agenteRetencion>");
    expect(xml).toContain(
      "<retencion><codigo>2</codigo><codigoRetencion>7</codigoRetencion><baseImponible>15.04</baseImponible><porcentajeRetener>0</porcentajeRetener><valorRetenido>0.00</valorRetenido></retencion>",
    );
  });

  it("la vista previa, el snapshot, el XML y la consulta llevan los mismos valores", async () => {
    const created = await draft({ fiscalPeriod: "09/2026", relatedParty: "SI" });
    expect(created.preview.totals).toEqual({ withheld: "6.27" });
    const res = await emit(api, created);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const receipt = bodyOf(res).data;
    const stored = await db.database.prisma.electronicDocument.findUniqueOrThrow({
      where: { id: receipt.id },
    });
    const snapshot = stored.snapshot as unknown as WithholdingSnapshot;
    expect(snapshot.totals).toEqual({ withheld: "6.27" });
    expect(snapshot.fiscalPeriod).toBe("09/2026");
    expect(snapshot.relatedParty).toMatchObject({ value: "SI", basis: "USER_DECLARED" });
    expect(
      snapshot.supports[0]!.withholdings.map((w) => [w.code, w.base, w.percentage, w.amount]),
    ).toEqual(
      created.preview.supports[0]!.withholdings.map((w) => [
        w.code,
        w.base,
        w.percentage,
        w.amount,
      ]),
    );
    expect(stored).toMatchObject({
      buyerIdentification: "1791234567001",
      buyerName: "PROVEEDORA DEL SUR S.A.",
    });
    expect(stored.total?.toFixed()).toBe("6.27");
    const lines = await db.database.prisma.withholdingReceiptLine.findMany({
      where: { documentId: receipt.id },
      orderBy: [{ supportPosition: "asc" }, { position: "asc" }],
    });
    expect(
      lines.map((l) => [
        l.tax,
        l.withholdingCode,
        l.base.toFixed(),
        l.percentage.toFixed(),
        l.amount.toFixed(),
      ]),
    ).toEqual([
      ["1", "312C", "100.29", "1.75", "1.76"],
      ["2", "1", "15.04", "30", "4.51"],
    ]);
    expect(
      await db.database.prisma.withholdingReceipt.findFirstOrThrow({
        where: { documentId: receipt.id },
      }),
    ).toMatchObject({ partyId: a.supplierId, relatedParty: "SI", fiscalPeriod: "09/2026" });
    const xml = compact(await signedXml(receipt.id));
    expect(xml).toContain("<parteRel>SI</parteRel>");
    expect(xml).toContain("<periodoFiscal>09/2026</periodoFiscal>");
    expect(xml).toContain(
      "<porcentajeRetener>1.75</porcentajeRetener><valorRetenido>1.76</valorRetenido>",
    );
    expect(xml).toContain(
      "<porcentajeRetener>30</porcentajeRetener><valorRetenido>4.51</valorRetenido>",
    );
    expect(receipt.totals).toEqual({ withheld: "6.27" });
    expect(
      await db.database.prisma.withholdingReceiptDraft.findUniqueOrThrow({
        where: { id: created.id },
      }),
    ).toMatchObject({ status: "EMITTED", documentId: receipt.id });
  });

  it("un porcentaje que cambia en el catálogo después de reservar no cambia el XML firmado", async () => {
    const created = await draft();
    const reserved = await emit(reserving, created);
    expect([reserved.status, bodyOf(reserved).data.state]).toEqual([201, "RESERVED"]);
    // Una versión nueva del catálogo cambia el 312C desde mañana, y la empresa lo deshabilita.
    const concepts = structuredClone(
      DATASET_FILES.find(
        (file) => (file as { catalogType: string }).catalogType === "withholding-income-concept",
      ),
    ) as { version: number; entries: Record<string, unknown>[] };
    concepts.version = 2;
    const current = concepts.entries.find((entry) => entry.entryKey === "312C")!;
    concepts.entries.push({
      ...current,
      effectiveFrom: "2026-10-07",
      effectiveTo: null,
      percentage: "2",
    });
    current.effectiveTo = "2026-10-06";
    await loadInstalledFiscalCatalogs(db.database.prisma, [...DATASET_FILES, concepts]);
    await db.database.prisma.companyFiscalCatalogSetting.create({
      data: {
        companyId: a.companyId,
        catalogType: "withholding-income-concept",
        entryKey: "312C",
        enabled: false,
        updatedBy: a.adminId,
      },
    });
    clock = new Date("2026-10-08T15:00:00Z");
    try {
      const retried = await request(api.app)
        .post(`/api/v1/withholding-receipts/${bodyOf(reserved).data.id}/signing-attempts`)
        .set("Cookie", a.cookies.operator);
      expect([retried.status, bodyOf(retried).data.state]).toEqual([200, "SIGNED"]);
      expect(bodyOf(retried).data.supports[0]!.withholdings[0]).toMatchObject({
        code: "312C",
        percentage: "1.75",
        amount: "1.76",
      });
      const xml = compact(await signedXml(bodyOf(reserved).data.id));
      expect(xml).toContain(
        "<codigoRetencion>312C</codigoRetencion><baseImponible>100.29</baseImponible><porcentajeRetener>1.75</porcentajeRetener><valorRetenido>1.76</valorRetenido>",
      );
      expect(xml).toContain("<fechaEmision>06/10/2026</fechaEmision>");
      // Una retención nueva con el 312C ya no es utilizable: la empresa lo deshabilitó.
      const blocked = await emit(api, await draft());
      expect([blocked.status, bodyOf(blocked).error.code]).toEqual([
        409,
        "WITHHOLDING_ENTRY_NOT_USABLE",
      ]);
    } finally {
      clock = new Date("2026-10-06T15:00:00Z");
      await db.database.prisma.companyFiscalCatalogSetting.delete({
        where: {
          companyId_catalogType_entryKey: {
            companyId: a.companyId,
            catalogType: "withholding-income-concept",
            entryKey: "312C",
          },
        },
      });
    }
  });

  it("prueba negativa: sin documentos ni retenciones no se reserva, no se consume secuencial ni se recibe clave", async () => {
    const before = await trace();
    const empty = await emit(api, await draft({ supports: [] }));
    expect([empty.status, bodyOf(empty).error.code]).toEqual([
      409,
      "WITHHOLDING_SUPPORTS_REQUIRED",
    ]);
    const noItems = await emit(api, await draft({ supports: [{ ...SUPPORT, withholdings: [] }] }));
    expect([noItems.status, bodyOf(noItems).error.code]).toEqual([
      409,
      "WITHHOLDING_ITEMS_REQUIRED",
    ]);
    // El rechazo indica el documento sin retenciones.
    expect(bodyOf(noItems).error.message).toBe(
      "El documento sustento 1 no tiene retenciones: agrega al menos una.",
    );
    expect(await trace()).toEqual(before);
  });

  it("rechaza cada problema de la evaluación sin reservar número ni auditar", async () => {
    const before = await trace();
    const rejected = async (overrides: Record<string, unknown>, code: string, company = a) => {
      const res = await emit(api, await draft(overrides, company), randomUUID(), company);
      expect([res.status, bodyOf(res).error.code], code).toEqual([409, code]);
      return bodyOf(res).error;
    };
    await rejected({ relatedParty: null }, "WITHHOLDING_RELATED_PARTY_REQUIRED");
    await rejected({ fiscalPeriod: "11/2026" }, "WITHHOLDING_FISCAL_PERIOD_IN_FUTURE");
    await rejected(
      { supports: [{ ...SUPPORT, issueDate: "2026-10-07" }] },
      "WITHHOLDING_SUPPORT_DATE_AFTER_ISSUE",
    );
    const incompatible = await rejected(
      { supports: [{ ...SUPPORT, documentType: "02" }] },
      "WITHHOLDING_SUPPORT_CODE_INCOMPATIBLE",
    );
    expect(incompatible.message).toContain("Sustentos admitidos: 02, 04, 05, 07, 14, 15.");
    const dividends = await rejected(
      { supports: [{ ...SUPPORT, withholdings: [{ tax: "1", entryKey: "325", base: "1.00" }] }] },
      "WITHHOLDING_CONCEPT_NOT_SUPPORTED",
    );
    expect(dividends.message).toContain("los dividendos están fuera del alcance actual");
    const nonResident = await rejected(
      { supports: [{ ...SUPPORT, withholdings: [{ tax: "1", entryKey: "500", base: "1.00" }] }] },
      "WITHHOLDING_CONCEPT_NOT_SUPPORTED",
    );
    expect(nonResident.message).toContain("los pagos al exterior están fuera del alcance actual");
    await rejected(
      { supports: [{ ...SUPPORT, withholdings: [{ tax: "1", entryKey: "346", base: "1.00" }] }] },
      "WITHHOLDING_CONCEPT_NOT_SUPPORTED",
    );
    await rejected(
      { supports: [{ ...SUPPORT, withholdings: [{ tax: "1", entryKey: "323-M", base: "1.00" }] }] },
      "WITHHOLDING_CONCEPT_NOT_SUPPORTED",
    );
    const notApplicable = await rejected(
      { supports: [{ ...SUPPORT, withholdings: [{ tax: "2", entryKey: "8", base: "1.00" }] }] },
      "WITHHOLDING_IVA_CODE_NOT_SUPPORTED",
    );
    expect(notApplicable.message).toContain("no se emite como retención en el alcance actual");
    await rejected(
      {
        supports: [
          { ...SUPPORT, taxes: [{ tax: "2", rateEntryKey: "8", base: "1.00", amount: "0.00" }] },
        ],
      },
      "WITHHOLDING_SUPPORT_TAX_INVALID",
    );
    await rejected(
      { supports: [{ ...SUPPORT, payments: [{ paymentMethod: "02", total: "1.00" }] }] },
      "WITHHOLDING_SUPPORT_PAYMENT_NOT_USABLE",
    );
    // Un borrador guardado directamente con el consumidor final: la emisión lo rechaza citando la ficha.
    const consumer = await createWithholdingDraftRepository(db.database.prisma).create(
      a.companyId,
      {
        partyId: a.consumerFinalId,
        relatedParty: "NO",
        fiscalPeriod: "10/2026",
        emissionPointId: a.emissionPointId,
        supports: [SUPPORT as never],
      },
      a.operatorId,
    );
    const consumerRes = await emit(api, consumer);
    expect([consumerRes.status, bodyOf(consumerRes).error.code]).toEqual([
      409,
      "WITHHOLDING_SUBJECT_CONSUMER_FINAL",
    ]);
    expect(bodyOf(consumerRes).error.message).toContain("página 13");
    // Un cliente sin el rol de proveedor.
    const customer = await createWithholdingDraftRepository(db.database.prisma).create(
      a.companyId,
      {
        partyId: a.customerId,
        relatedParty: "NO",
        fiscalPeriod: "10/2026",
        emissionPointId: a.emissionPointId,
        supports: [SUPPORT as never],
      },
      a.operatorId,
    );
    const customerRes = await emit(api, customer);
    expect([customerRes.status, bodyOf(customerRes).error.code]).toEqual([
      409,
      "WITHHOLDING_SUBJECT_NOT_SUPPLIER",
    ]);
    // Una empresa sin firma utilizable.
    await rejected({}, "SIGNING_CERTIFICATE_NOT_USABLE", unsigned);
    const anonymous = await request(api.app)
      .post("/api/v1/withholding-receipts")
      .set("Idempotency-Key", randomUUID())
      .send({ draftId: consumer.id, expectedVersion: 1 });
    expect(anonymous.status).toBe(401);
    // Ningún rechazo reservó número ni dejó registro, idempotencia o auditoría.
    expect(await trace()).toEqual(before);
  });

  it("un contribuyente especial que la retención 2.0.0 no admite se rechaza antes de reservar", async () => {
    const special = await readyCompany(api, db, {
      slug: "emision-ret-especial",
      pool,
      p12Dir: inject("p12FixturesDir"),
      profile: { specialTaxpayerNumber: "1234567" },
    });
    const before = await trace();
    const res = await emit(api, await draft({}, special), randomUUID(), special);
    expect([res.status, bodyOf(res).error.code]).toEqual([
      409,
      "WITHHOLDING_SPECIAL_TAXPAYER_INCOMPATIBLE",
    ]);
    expect(await trace()).toEqual(before);
  });

  it("el doble envío secuencial y simultáneo deja una sola retención; otra solicitud con la clave es un conflicto", async () => {
    const created = await draft();
    const key = randomUUID();
    const before = await trace();
    const [one, two] = await Promise.all([emit(api, created, key), emit(api, created, key)]);
    expect([one.status, two.status].sort()).toEqual([200, 201]);
    expect(bodyOf(one).data.id).toBe(bodyOf(two).data.id);
    const again = await emit(api, created, key);
    expect([again.status, bodyOf(again).data.id]).toEqual([200, bodyOf(one).data.id]);
    const after = await trace();
    expect([
      after.documents - before.documents,
      after.sequences - before.sequences,
      after.receipts - before.receipts,
      after.lines - before.lines,
      after.idempotency - before.idempotency,
    ]).toEqual([1, 1, 1, 2, 1]);

    const other = await draft({ relatedParty: "SI" });
    const reused = await emit(api, other, key);
    expect([reused.status, bodyOf(reused).error.code]).toEqual([409, "IDEMPOTENCY_KEY_REUSED"]);
    expect(
      (
        await db.database.prisma.withholdingReceiptDraft.findUniqueOrThrow({
          where: { id: other.id },
        })
      ).status,
    ).toBe("DRAFT");
    const twice = await emit(api, created, randomUUID());
    expect([twice.status, bodyOf(twice).error.code]).toEqual([
      409,
      "WITHHOLDING_DRAFT_ALREADY_EMITTED",
    ]);
    const beforeRejections = await trace();
    const keyless = await emit(api, other, null);
    expect([keyless.status, bodyOf(keyless).error.code]).toEqual([400, "IDEMPOTENCY_KEY_REQUIRED"]);
    const stale = await emit(api, { id: other.id, version: other.version + 1 });
    expect([stale.status, bodyOf(stale).error.code]).toEqual([409, "WITHHOLDING_DRAFT_CHANGED"]);
    // Una versión ya reemplazada: el borrador se corrigió después de leerlo.
    const corrected = await request(api.app)
      .put(`/api/v1/withholding-receipts/drafts/${other.id}`)
      .set("Cookie", a.cookies.operator)
      .send({
        partyId: a.supplierId,
        relatedParty: "NO",
        emissionPointId: a.emissionPointId,
        supports: [SUPPORT],
        expectedVersion: other.version,
      });
    expect(corrected.status, JSON.stringify(corrected.body)).toBe(200);
    const replaced = await emit(api, other);
    expect([replaced.status, bodyOf(replaced).error.code]).toEqual([
      409,
      "WITHHOLDING_DRAFT_CHANGED",
    ]);
    // Ninguno de estos rechazos reserva, audita ni guarda una clave.
    expect(await trace()).toEqual(beforeRejections);
  });

  it("sin withholdings.emit responde 403, y un límite configurado se aplica también al emitir", async () => {
    const created = await draft({
      supports: [
        {
          ...SUPPORT,
          withholdings: [
            { tax: "1", entryKey: "312", base: "10.00" },
            { tax: "1", entryKey: "303", base: "10.00" },
            { tax: "2", entryKey: "1", base: "1.50" },
          ],
        },
      ],
    });
    const before = await trace();
    const denied = buildTaxpayerApp(db, {
      signing: { pool, custody: CUSTODY },
      withholdingReceipts: { deny: ["withholdings.emit"] },
      now: () => clock,
    });
    const forbidden = await emit(denied, created);
    expect([forbidden.status, bodyOf(forbidden).error.code]).toEqual([403, "FORBIDDEN"]);
    // La instalación baja el máximo de retenciones por documento: el borrador guardado con tres ya
    // no se emite.
    const limited = buildTaxpayerApp(db, {
      signing: { pool, custody: CUSTODY },
      withholdingReceipts: { limits: { itemsPerSupport: 2 } },
      now: () => clock,
    });
    const overLimit = await emit(limited, created);
    expect([overLimit.status, bodyOf(overLimit).error.code]).toEqual([
      409,
      "WITHHOLDING_RESOURCE_LIMIT",
    ]);
    expect(bodyOf(overLimit).error.message).toContain(
      "Es una defensa de recursos del sistema, no un límite del SRI.",
    );
    expect(await trace()).toEqual(before);
  });

  it("la repetición de una retención que quedó reservada reanuda su firma sin otro número", async () => {
    const created = await draft();
    const key = randomUUID();
    const reserved = await emit(reserving, created, key);
    expect([reserved.status, bodyOf(reserved).data.state]).toEqual([201, "RESERVED"]);
    const before = await trace();
    const resumed = await emit(api, created, key);
    expect([resumed.status, bodyOf(resumed).data.state]).toEqual([200, "SIGNED"]);
    expect(bodyOf(resumed).data).toMatchObject({
      id: bodyOf(reserved).data.id,
      documentNumber: bodyOf(reserved).data.documentNumber,
      accessKey: bodyOf(reserved).data.accessKey,
    });
    const after = await trace();
    expect([after.documents, after.sequences, after.receipts, after.idempotency]).toEqual([
      before.documents,
      before.sequences,
      before.receipts,
      before.idempotency,
    ]);
  });

  it("audita la reserva y la firma con hechos seguros, sin XML ni SOAP, y cuenta las métricas", async () => {
    const res = await emit(api, await draft());
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const receipt = bodyOf(res).data;
    const own = (
      await db.database.prisma.auditEvent.findMany({
        where: { companyId: a.companyId, action: { startsWith: "withholding_receipt." } },
        orderBy: { occurredAt: "asc" },
      })
    ).filter(
      (event) =>
        (event.changes as { withholdingReceiptId?: string }).withholdingReceiptId === receipt.id,
    );
    expect(own.map((event) => [event.action, event.actorUserId])).toEqual([
      ["withholding_receipt.reserved", a.operatorId],
      ["withholding_receipt.signed", a.operatorId],
    ]);
    expect(own[0]!.changes).toEqual({
      withholdingReceiptId: receipt.id,
      documentNumber: receipt.documentNumber,
      accessKey: receipt.accessKey,
      environment: "TEST",
      totalWithheld: "6.27",
      subjectIdentification: "1791234567001",
      subjectName: "PROVEEDORA DEL SUR S.A.",
      fiscalPeriod: "10/2026",
      relatedParty: "NO",
      relatedPartyBasis: "USER_DECLARED",
      supportCount: 1,
      withholdingCount: 2,
      taxes: ["1", "2"],
    });
    expect(JSON.stringify(own.map((event) => event.changes))).not.toMatch(
      /<\?xml|soap|claveAcceso/i,
    );
    expect(await metric("withholding_receipt_reservations_total")).toMatch(
      /withholding_receipt_reservations_total \d+/,
    );
    const items = await metric("withholding_receipt_items_total");
    expect(items).toContain('tax="income"');
    expect(items).toContain('tax="iva"');
  });
});
