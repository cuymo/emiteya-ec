// Invariantes de la migración add_shipping_guides en PostgreSQL (design D3 a D8, D14, D15 y D26): una
// guía 06 no se confirma sin su registro ni sus destinatarios; el registro es de una guía de la empresa
// con el inicio no anterior a la emisión; un destinatario con factura la referencia autorizada, de la
// empresa y del ambiente de la guía; la propia empresa exige origen distinto de destino; registro,
// destinatarios y borrador emitido son inmutables; y la emisión tiene su operación de idempotencia.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import type { PrismaClient } from "../../src/generated/prisma/client.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertFiscalCompany, type FiscalCompany } from "./fiscal-harness.ts";
import {
  insertGuideParty,
  insertShippingGuide,
  type GuideRecipientRow,
} from "./shipping-guide-harness.ts";
import { insertDocument } from "./transmission-harness.ts";

describe("guías de remisión en la base de datos", () => {
  let db: MigratedSchema;
  let prisma: PrismaClient;
  let companyA: FiscalCompany;
  let companyB: FiscalCompany;
  let partyA: string;

  const table = (name: string) => `"${db.name}"."${name}"`;
  const fails = (promise: Promise<unknown>) =>
    promise.then(
      () => null,
      (error: unknown) => String(error),
    );
  const recipient = (overrides: Partial<GuideRecipientRow> = {}): GuideRecipientRow => ({
    identification: "1790012345001",
    name: "Comercial Andina S.A.",
    partyId: partyA,
    ...overrides,
  });
  const own = (destination: number): GuideRecipientRow => ({
    identification: "1790000000001",
    name: "Empresa A",
    destinationEstablishmentId: companyA.points[destination]!.establishmentId,
  });

  beforeAll(async () => {
    db = await createMigratedSchema("shipping_guides_schema");
    prisma = db.database.prisma;
    await loadInstalledFiscalCatalogs(prisma);
    companyA = await insertFiscalCompany(prisma, "Guías A", 3);
    companyB = await insertFiscalCompany(prisma, "Guías B", 1);
    partyA = await insertGuideParty(prisma, companyA, "1790012345001");
  });

  afterAll(async () => {
    await db.drop();
  });

  it("guarda una guía con su registro y sus destinatarios", async () => {
    const invoice = await insertDocument(prisma, companyA, "AUTHORIZED");
    const guide = await insertShippingGuide(prisma, companyA, "SIGNED", {
      originEstablishmentId: companyA.points[0]!.establishmentId,
      recipients: [recipient({ invoiceId: invoice.id, detailCount: 2 }), own(1)],
    });
    const record = await prisma.shippingGuide.findUniqueOrThrow({
      where: { companyId_documentId: { companyId: companyA.companyId, documentId: guide.id } },
      include: { recipients: { orderBy: { position: "asc" } } },
    });
    expect(record.detailCount).toBe(3);
    expect(record.recipients.map((row) => [row.supportKind, row.exceptionCase])).toEqual([
      ["INTERNAL_INVOICE", null],
      ["DECLARED_EXCEPTION", "OWN_ESTABLISHMENT_TRANSFER"],
    ]);
  });

  it("no confirma una guía sin su registro ni con destinatarios que no coinciden", async () => {
    expect(
      await fails(insertDocument(prisma, companyA, "RESERVED", { documentType: "06" })),
    ).toContain("no tiene su registro");
    const mismatch = await fails(
      insertDocument(prisma, companyA, "RESERVED", {
        documentType: "06",
        recipients: [
          { identification: "1790012345001", name: "Uno" },
          { identification: "0102030405", name: "Dos" },
        ],
        alongside: async (tx, document) => {
          await tx.shippingGuide.create({
            data: {
              companyId: companyA.companyId,
              documentId: document.id,
              transporterSource: "SELF",
              carrierIdentificationType: "04",
              carrierIdentification: "1790000000001",
              carrierName: "Empresa A",
              plate: "PAA-1234",
              transportStart: new Date("2026-10-04"),
              transportEnd: new Date("2026-10-04"),
              recipientCount: 2,
              detailCount: 2,
            },
          });
          await tx.shippingGuideRecipient.create({
            data: {
              companyId: companyA.companyId,
              documentId: document.id,
              position: 1,
              recipientKind: "PARTY",
              partyId: partyA,
              supportKind: "DECLARED_EXCEPTION",
              exceptionCase: "CONSIGNMENT",
              exceptionPolicyVersion: 1,
              declaredBy: companyA.adminId,
              declaredAt: new Date(),
              detailCount: 1,
            },
          });
        },
      }),
    );
    expect(mismatch).toContain("no coinciden con su registro");
  });

  it("las facturas, las notas y las retenciones no disparan el trigger de la guía", async () => {
    expect(await fails(insertDocument(prisma, companyA, "RESERVED"))).toBeNull();
  });

  it("rechaza una factura sustento de otra empresa, de otro ambiente, sin autorizar o de otro tipo", async () => {
    const foreign = await insertDocument(prisma, companyB, "AUTHORIZED");
    const production = await insertDocument(prisma, companyA, "AUTHORIZED", {
      environment: "PRODUCTION",
    });
    const signed = await insertDocument(prisma, companyA, "SIGNED");
    const otherGuide = await insertShippingGuide(prisma, companyA, "AUTHORIZED");
    for (const invoiceId of [foreign.id, production.id, signed.id, otherGuide.id]) {
      const error = await fails(
        insertShippingGuide(prisma, companyA, "RESERVED", {
          recipients: [recipient({ invoiceId })],
        }),
      );
      expect(error).not.toBeNull();
    }
    // La factura autorizada del ambiente de la guía sí es sustento, también en Producción.
    expect(
      await fails(
        insertShippingGuide(prisma, companyA, "RESERVED", {
          environment: "PRODUCTION",
          recipients: [recipient({ invoiceId: production.id })],
        }),
      ),
    ).toBeNull();
  });

  it("exige origen distinto de destino y la excepción propia para la propia empresa", async () => {
    const origin = companyA.points[0]!.establishmentId;
    expect(
      await fails(insertShippingGuide(prisma, companyA, "RESERVED", { recipients: [own(1)] })),
    ).toContain("origen distinto de su destino");
    expect(
      await fails(
        insertShippingGuide(prisma, companyA, "RESERVED", {
          originEstablishmentId: origin,
          recipients: [own(0)],
        }),
      ),
    ).toContain("origen distinto de su destino");
    // La propia empresa con otra excepción, o un tercero con la excepción propia.
    expect(
      await fails(
        insertShippingGuide(prisma, companyA, "RESERVED", {
          originEstablishmentId: origin,
          recipients: [{ ...own(1), exceptionCase: "CONSIGNMENT" }],
        }),
      ),
    ).toContain("shipping_guide_recipient_values_check");
    expect(
      await fails(
        insertShippingGuide(prisma, companyA, "RESERVED", {
          recipients: [recipient({ exceptionCase: "OWN_ESTABLISHMENT_TRANSFER" })],
        }),
      ),
    ).toContain("shipping_guide_recipient_values_check");
    // El establecimiento emisor puede ser el de destino (punto del 002, destino 002).
    expect(
      await fails(
        insertShippingGuide(prisma, companyA, "RESERVED", {
          point: 1,
          originEstablishmentId: origin,
          recipients: [own(1)],
        }),
      ),
    ).toBeNull();
  });

  it("rechaza un inicio del transporte anterior a la fecha de emisión", async () => {
    expect(
      await fails(
        insertShippingGuide(prisma, companyA, "RESERVED", {
          issueDate: "2026-10-06",
          transportStart: "2026-10-05",
        }),
      ),
    ).toContain("anterior a la fecha de emisión");
  });

  it("defiende el transportista y la placa", async () => {
    const guide = await insertShippingGuide(prisma, companyA, "RESERVED");
    const copy = (changes: string) =>
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          `CREATE TEMP TABLE "copia" ON COMMIT DROP AS SELECT * FROM ${table("shipping_guide")}
           WHERE "document_id" = $1`,
          guide.id,
        );
        await tx.$executeRawUnsafe(`UPDATE "copia" SET ${changes}`);
        await tx.$executeRawUnsafe(`INSERT INTO ${table("shipping_guide")} SELECT * FROM "copia"`);
      });
    for (const change of [
      `"carrier_identification_type" = '05'`,
      `"transporter_source" = 'PARTY'`,
      `"plate" = ' PAA-1234'`,
      `"plate" = ''`,
      `"transport_end" = DATE '2026-10-03'`,
      `"carrier_identification_type" = '08'`,
    ]) {
      expect(await fails(copy(change)), change).toContain("shipping_guide_values_check");
    }
  });

  it("el registro, los destinatarios y el borrador emitido no cambian", async () => {
    const guide = await insertShippingGuide(prisma, companyA, "RESERVED");
    const where = `WHERE "document_id" = '${guide.id}'`;
    for (const statement of [
      `UPDATE ${table("shipping_guide")} SET "plate" = 'OTRA' ${where}`,
      `DELETE FROM ${table("shipping_guide")} ${where}`,
      `UPDATE ${table("shipping_guide_recipient")} SET "detail_count" = 2 ${where}`,
      `DELETE FROM ${table("shipping_guide_recipient")} ${where}`,
      `TRUNCATE ${table("shipping_guide_recipient")}`,
    ]) {
      expect(await fails(prisma.$executeRawUnsafe(statement)), statement).toContain("no admite");
    }
    const draft = await prisma.shippingGuideDraft.create({
      data: {
        companyId: companyA.companyId,
        status: "EMITTED",
        documentId: guide.id,
        createdBy: companyA.adminId,
        updatedBy: companyA.adminId,
      },
    });
    expect(
      await fails(
        prisma.shippingGuideDraft.update({ where: { id: draft.id }, data: { plate: "X" } }),
      ),
    ).toContain("un borrador emitido no cambia");
  });

  it("defiende el borrador: origen y partida libre no van juntos, y los destinatarios son un arreglo", async () => {
    const draft = (data: Record<string, unknown>) =>
      prisma.shippingGuideDraft.create({
        data: {
          companyId: companyA.companyId,
          createdBy: companyA.adminId,
          updatedBy: companyA.adminId,
          ...data,
        },
      });
    expect(await fails(draft({}))).toBeNull();
    expect(
      await fails(
        draft({
          originEstablishmentId: companyA.points[0]!.establishmentId,
          departureAddress: "Bodega",
        }),
      ),
    ).toContain("shipping_guide_draft_values_check");
    expect(await fails(draft({ transporterSource: "SELF", carrierPartyId: partyA }))).toContain(
      "shipping_guide_draft_values_check",
    );
    expect(await fails(draft({ recipients: { no: "arreglo" } }))).toContain(
      "shipping_guide_draft_recipients_check",
    );
  });

  it("registra la operación de idempotencia de la emisión de guías", async () => {
    const guide = await insertShippingGuide(prisma, companyA, "RESERVED");
    const record = (operation: string) =>
      prisma.$executeRawUnsafe(
        `INSERT INTO ${table("idempotency_record")}
           ("company_id", "operation", "idempotency_key", "request_fingerprint", "document_id", "created_by")
         VALUES ($1, $2, $3, $4, $5, $6)`,
        companyA.companyId,
        operation,
        `clave-${operation}`,
        "a".repeat(64),
        guide.id,
        companyA.adminId,
      );
    expect(await fails(record("shipping_guide.emit"))).toBeNull();
    expect(await fails(record("guia.emitir"))).toContain("idempotency_record_values_check");
  });
});
