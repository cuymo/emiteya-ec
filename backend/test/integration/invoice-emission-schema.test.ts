// Invariantes de la migración add_invoice_emission en PostgreSQL (design D2, D3, D8 y D9): borradores
// con escalas del XSD y referencias de la misma empresa, inmutables una vez emitidos; comprobante
// inmutable desde RESERVED que solo pasa a SIGNED con su artefacto; historial, artefacto y registro
// de idempotencia de solo agregado. Escribe directamente en las tablas.
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { createSequentialReservation } from "../../src/modules/fiscal/application/reservation.ts";
import { createFiscalUnitOfWork } from "../../src/modules/fiscal/infrastructure/unit-of-work.ts";
import type { DbClient } from "../../src/platform/db/database.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import {
  insertFiscalCompany,
  key,
  reservationInput,
  type FiscalCompany,
} from "./fiscal-harness.ts";

describe("invariantes de la emisión de facturas en la base de datos", () => {
  let db: MigratedSchema;
  let prisma: DbClient;
  let companyA: FiscalCompany;
  let companyB: FiscalCompany;
  let productA: string;
  let productB: string;
  let consumerFinalA: string;
  let consumerFinalB: string;

  const table = (name: string) => `"${db.name}"."${name}"`;
  const fails = (promise: Promise<unknown>) =>
    promise.then(
      () => null,
      (error: unknown) => String(error),
    );
  const createProduct = (company: FiscalCompany) =>
    db.database.prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          companyId: company.companyId,
          kind: "GOOD",
          name: "Cemento 50 kg",
          unitPrice: "8.75",
          searchName: "cemento 50 kg",
          createdBy: company.adminId,
          updatedBy: company.adminId,
        },
      });
      await tx.productTax.create({
        data: {
          productId: created.id,
          companyId: company.companyId,
          catalogType: "iva-rate",
          entryKey: "4",
        },
      });
      return created.id;
    });
  const draft = (company: FiscalCompany, overrides: Record<string, unknown> = {}) =>
    prisma.invoiceDraft.create({
      data: {
        companyId: company.companyId,
        emissionPointId: company.points[0]!.emissionPointId,
        createdBy: company.adminId,
        updatedBy: company.adminId,
        ...overrides,
      },
    });
  const line = (draftId: string, overrides: Record<string, unknown> = {}) =>
    prisma.invoiceDraftLine.create({
      data: {
        draftId,
        companyId: companyA.companyId,
        position: 1,
        productId: productA,
        quantity: "1",
        discount: "0",
        ...overrides,
      },
    });
  const payment = (draftId: string, overrides: Record<string, unknown> = {}) =>
    prisma.invoiceDraftPayment.create({
      data: { draftId, companyId: companyA.companyId, position: 1, entryKey: "01", ...overrides },
    });

  /** Reserva un número real y crea su comprobante RESERVED, como lo hará la emisión. */
  async function reservedDocument(overrides: Record<string, unknown> = {}) {
    const reservation = await createSequentialReservation(
      createFiscalUnitOfWork(db.database.prisma),
    ).reserve(reservationInput(key(companyA)));
    const sequential = String(reservation.sequential).padStart(9, "0");
    return prisma.electronicDocument.create({
      data: {
        companyId: companyA.companyId,
        documentType: "01",
        environment: "TEST",
        establishmentId: companyA.points[0]!.establishmentId,
        emissionPointId: companyA.points[0]!.emissionPointId,
        documentNumber: `001-001-${sequential}`,
        sequential: reservation.sequential,
        reservationId: reservation.reservationId,
        accessKey: `031020260117900123450011001001${sequential}1234567810`.slice(0, 49),
        numericCode: "12345678",
        issueDate: new Date("2026-10-03"),
        state: "RESERVED",
        snapshot: { snapshotVersion: 1 },
        schemaVersion: "1.1.0",
        buyerIdentification: "9999999999999",
        buyerName: "CONSUMIDOR FINAL",
        total: "11.50",
        createdBy: companyA.adminId,
        ...overrides,
      },
    });
  }
  const artifact = (documentId: string, content = Buffer.from("<factura/>")) => ({
    companyId: companyA.companyId,
    documentId,
    kind: "SIGNED_XML",
    mediaType: "application/xml",
    content,
    sizeBytes: content.length,
    sha256: createHash("sha256").update(content).digest("hex"),
    metadata: { schemaVersion: "1.1.0" },
  });

  beforeAll(async () => {
    db = await createMigratedSchema("invoice_emission_schema");
    prisma = db.database.prisma;
    await loadInstalledFiscalCatalogs(db.database.prisma);
    companyA = await insertFiscalCompany(prisma, "Empresa A", 1);
    companyB = await insertFiscalCompany(prisma, "Empresa B", 1);
    productA = await createProduct(companyA);
    productB = await createProduct(companyB);
    const consumerFinal = (companyId: string) =>
      prisma.party.findFirstOrThrow({ where: { companyId, systemRecord: "CONSUMER_FINAL" } });
    consumerFinalA = (await consumerFinal(companyA.companyId)).id;
    consumerFinalB = (await consumerFinal(companyB.companyId)).id;
  });

  afterAll(async () => {
    await db.drop();
  });

  describe("borradores", () => {
    it("aceptan líneas y pagos con las escalas del XSD", async () => {
      const created = await draft(companyA, { buyerPartyId: consumerFinalA });
      expect(
        await fails(line(created.id, { quantity: "999999999999.999999", discount: "1.25" })),
      ).toBeNull();
      expect(await fails(payment(created.id, { amount: "99999999999999" }))).toBeNull();
      expect(await fails(payment(created.id, { position: 2, amount: null }))).toBeNull();
    });

    it("rechazan escalas fuera del dominio por su CHECK, sin redondear", async () => {
      const created = await draft(companyA);
      for (const overrides of [
        { quantity: "1.1234567" },
        { quantity: "1000000000000000000" },
        { quantity: "-1" },
        { discount: "1.255" },
        { discount: "-0.01" },
      ]) {
        expect(await fails(line(created.id, overrides)), JSON.stringify(overrides)).toMatch(
          /invoice_draft_line_values_check/,
        );
      }
      for (const amount of ["1.005", "-1", "100000000000000"]) {
        expect(await fails(payment(created.id, { amount })), amount).toMatch(
          /invoice_draft_payment_values_check/,
        );
      }
      expect(await fails(payment(created.id, { entryKey: "99" }))).toMatch(
        /invoice_draft_payment_catalog_type_entry_key_fkey|Foreign key/,
      );
    });

    it("solo refieren puntos, terceros y productos de su empresa", async () => {
      expect(
        await fails(draft(companyA, { emissionPointId: companyB.points[0]!.emissionPointId })),
      ).toMatch(/invoice_draft_company_id_emission_point_id_fkey|Foreign key/);
      expect(await fails(draft(companyA, { buyerPartyId: consumerFinalB }))).toMatch(
        /invoice_draft_company_id_buyer_party_id_fkey|Foreign key/,
      );
      const created = await draft(companyA);
      expect(await fails(line(created.id, { productId: productB }))).toMatch(
        /invoice_draft_line_company_id_product_id_fkey|Foreign key/,
      );
    });

    it("un borrador DRAFT se elimina con sus líneas y pagos", async () => {
      const created = await draft(companyA);
      await line(created.id);
      await payment(created.id);
      await prisma.invoiceDraft.delete({ where: { id: created.id } });
      expect(await prisma.invoiceDraftLine.count({ where: { draftId: created.id } })).toBe(0);
    });

    it("un borrador emitido, sus líneas y sus pagos no cambian ni se borran", async () => {
      const document = await reservedDocument();
      const created = await draft(companyA, { buyerPartyId: consumerFinalA });
      await line(created.id);
      await payment(created.id);
      expect(
        await fails(
          prisma.invoiceDraft.update({ where: { id: created.id }, data: { status: "EMITTED" } }),
        ),
      ).toMatch(/invoice_draft_values_check/);
      await prisma.invoiceDraft.update({
        where: { id: created.id },
        data: { status: "EMITTED", documentId: document.id, version: { increment: 1 } },
      });
      expect(
        await fails(
          prisma.invoiceDraft.update({ where: { id: created.id }, data: { version: 9 } }),
        ),
      ).toMatch(/un borrador emitido no cambia/);
      expect(await fails(prisma.invoiceDraft.delete({ where: { id: created.id } }))).toMatch(
        /un borrador emitido no cambia/,
      );
      expect(await fails(line(created.id, { position: 2 }))).toMatch(
        /un borrador emitido no cambia/,
      );
      expect(
        await fails(
          prisma.invoiceDraftLine.update({
            where: { draftId_position: { draftId: created.id, position: 1 } },
            data: { quantity: "2" },
          }),
        ),
      ).toMatch(/un borrador emitido no cambia/);
      expect(
        await fails(
          prisma.invoiceDraftPayment.delete({
            where: { draftId_position: { draftId: created.id, position: 1 } },
          }),
        ),
      ).toMatch(/un borrador emitido no cambia/);
    });
  });

  describe("comprobante reservado", () => {
    it("no cambia sus datos fiscales ni se borra", async () => {
      const document = await reservedDocument();
      for (const data of [
        { snapshot: { snapshotVersion: 2 } },
        { accessKey: "1".repeat(49) },
        { sequential: 999 },
        { issueDate: new Date("2026-10-04") },
        { total: "12.00" },
      ]) {
        expect(
          await fails(prisma.electronicDocument.update({ where: { id: document.id }, data })),
          JSON.stringify(data),
        ).toMatch(/un comprobante reservado no cambia sus datos fiscales/);
      }
      expect(await fails(prisma.electronicDocument.delete({ where: { id: document.id } }))).toMatch(
        /no admite DELETE/,
      );
      expect(
        await fails(prisma.$executeRawUnsafe(`TRUNCATE ${table("electronic_document")} CASCADE`)),
      ).toMatch(/no admite TRUNCATE/);
    });

    it("el diagnóstico del intento cambia sin tocar el estado fiscal", async () => {
      const document = await reservedDocument();
      const updated = await prisma.electronicDocument.update({
        where: { id: document.id },
        data: {
          lastAttemptStage: "SIGN",
          lastAttemptCode: "CRYPTO_BUSY",
          lastAttemptClass: "RETRYABLE_OPERATIONAL",
          lastAttemptAt: new Date(),
          attemptCount: { increment: 1 },
        },
      });
      expect(updated).toMatchObject({ state: "RESERVED", attemptCount: 1 });
      expect(
        await fails(
          prisma.electronicDocument.update({
            where: { id: document.id },
            data: { lastAttemptClass: "OTRA" },
          }),
        ),
      ).toMatch(/electronic_document_values_check/);
    });

    it("la clave de acceso y el número son únicos", async () => {
      const first = await reservedDocument();
      expect(await fails(reservedDocument({ accessKey: first.accessKey }))).toMatch(
        /electronic_document_access_key_key|Unique constraint/,
      );
      const reservation = await prisma.fiscalSequenceReservation.findUniqueOrThrow({
        where: { id: first.reservationId },
      });
      expect(
        await fails(
          prisma.electronicDocument.create({
            data: {
              ...(({ id: _id, lastAttemptDetail: _detail, ...rest }) => rest)(first),
              snapshot: { snapshotVersion: 1 },
              total: "11.50",
              accessKey: "2".repeat(49),
              reservationId: reservation.id,
            },
          }),
        ),
      ).toMatch(/Unique constraint|electronic_document_reservation_id_key/);
    });

    it("el historial de transiciones es de solo agregado", async () => {
      const document = await reservedDocument();
      const transition = await prisma.documentStateTransition.create({
        data: {
          companyId: companyA.companyId,
          documentId: document.id,
          toState: "RESERVED",
          cause: "EMISSION",
          actorType: "USER",
          actorUserId: companyA.adminId,
        },
      });
      expect(
        await fails(
          prisma.documentStateTransition.update({
            where: { id: transition.id },
            data: { cause: "OTRA" },
          }),
        ),
      ).toMatch(/no admite UPDATE/);
      expect(
        await fails(prisma.documentStateTransition.delete({ where: { id: transition.id } })),
      ).toMatch(/no admite DELETE/);
      expect(
        await fails(
          prisma.documentStateTransition.create({
            data: {
              companyId: companyA.companyId,
              documentId: document.id,
              toState: "SIGNED",
              cause: "SIGNING",
              actorType: "SYSTEM",
              actorUserId: companyA.adminId,
            },
          }),
        ),
      ).toMatch(/document_state_transition_values_check/);
    });
  });

  describe("firma y artefacto", () => {
    it("SIGNED sin artefacto se rechaza al confirmar; con su artefacto se confirma", async () => {
      const document = await reservedDocument();
      expect(
        await fails(
          prisma.electronicDocument.update({
            where: { id: document.id },
            data: { state: "SIGNED", signedAt: new Date() },
          }),
        ),
      ).toMatch(/firmado sin su artefacto/);
      await db.database.prisma.$transaction(async (tx) => {
        await tx.documentArtifact.create({ data: artifact(document.id) });
        await tx.electronicDocument.update({
          where: { id: document.id },
          data: { state: "SIGNED", signedAt: new Date() },
        });
      });
      expect(
        (await prisma.electronicDocument.findUniqueOrThrow({ where: { id: document.id } })).state,
      ).toBe("SIGNED");
      expect(
        await fails(
          prisma.electronicDocument.update({
            where: { id: document.id },
            data: { state: "RESERVED" },
          }),
        ),
      ).toMatch(/solo pasa de RESERVED a SIGNED/);
    });

    it("el artefacto es inmutable, único por tipo y con su tamaño y hash", async () => {
      const document = await reservedDocument();
      const created = await prisma.documentArtifact.create({ data: artifact(document.id) });
      expect(
        await fails(
          prisma.documentArtifact.update({
            where: { id: created.id },
            data: { content: Buffer.from("<otra/>") },
          }),
        ),
      ).toMatch(/no admite UPDATE/);
      expect(await fails(prisma.documentArtifact.delete({ where: { id: created.id } }))).toMatch(
        /no admite DELETE/,
      );
      expect(await fails(prisma.documentArtifact.create({ data: artifact(document.id) }))).toMatch(
        /document_artifact_document_id_kind_key|Unique constraint/,
      );
      const other = await reservedDocument();
      expect(
        await fails(
          prisma.documentArtifact.create({ data: { ...artifact(other.id), sizeBytes: 3 } }),
        ),
      ).toMatch(/document_artifact_values_check/);
    });
  });

  describe("registro de idempotencia", () => {
    it("una clave por empresa y operación, de solo agregado", async () => {
      const document = await reservedDocument();
      const record = (overrides: Record<string, unknown> = {}) =>
        prisma.idempotencyRecord.create({
          data: {
            companyId: companyA.companyId,
            operation: "invoice.emit",
            idempotencyKey: "clave-1",
            requestFingerprint: "a".repeat(64),
            documentId: document.id,
            createdBy: companyA.adminId,
            ...overrides,
          },
        });
      await record();
      expect(await fails(record({ requestFingerprint: "b".repeat(64) }))).toMatch(
        /idempotency_record_pkey|Unique constraint/,
      );
      expect(await fails(record({ idempotencyKey: "con espacio" }))).toMatch(
        /idempotency_record_values_check/,
      );
      expect(await fails(record({ idempotencyKey: randomUUID(), operation: "otra" }))).toMatch(
        /idempotency_record_values_check/,
      );
      expect(
        await fails(
          prisma.$executeRawUnsafe(
            `UPDATE ${table("idempotency_record")} SET request_fingerprint = '${"c".repeat(64)}'`,
          ),
        ),
      ).toMatch(/no admite UPDATE/);
    });
  });
});
