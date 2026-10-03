// Invariantes de la migración add_parties_and_products en PostgreSQL (design D5 a D7, D14 y D15):
// unicidad por empresa, consumidor final coherente e inmutable, IVA obligatorio y IRBPNR solo en
// bienes al confirmar, control de stock solo en bienes y referencias a entradas fiscales existentes.
// Escribe directamente en las tablas.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/platform/db/database.ts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertCompany, insertMember } from "./fixtures.ts";

describe("invariantes de terceros y productos en la base de datos", () => {
  let db: MigratedSchema;
  let prisma: DbClient;
  let companyA: string;
  let companyB: string;
  let userA: string;

  const fails = (promise: Promise<unknown>) =>
    promise.then(
      () => null,
      (error: unknown) => String(error),
    );
  const party = (companyId: string, overrides: Record<string, unknown> = {}) => ({
    companyId,
    identificationType: "04",
    identification: "1790012345001",
    legalName: "Comercial Andina S.A.",
    searchName: "comercial andina s.a.",
    searchIdentification: "1790012345001",
    createdBy: userA,
    updatedBy: userA,
    ...overrides,
  });
  const productData = (overrides: Record<string, unknown> = {}) => ({
    companyId: companyA,
    kind: "GOOD",
    name: "Cemento 50 kg",
    unitPrice: "8.75",
    searchName: "cemento 50 kg",
    createdBy: userA,
    updatedBy: userA,
    ...overrides,
  });
  /** Crea un producto con sus impuestos en una transacción, como lo hará el repositorio. */
  const createProduct = (
    overrides: Record<string, unknown> = {},
    taxes: [string, string][] = [["iva-rate", "4"]],
  ) =>
    db.database.prisma.$transaction(async (tx) => {
      const created = await tx.product.create({ data: productData(overrides) });
      for (const [catalogType, entryKey] of taxes) {
        await tx.productTax.create({
          data: { productId: created.id, companyId: companyA, catalogType, entryKey },
        });
      }
      return created.id;
    });

  beforeAll(async () => {
    db = await createMigratedSchema("parties_products_schema");
    prisma = db.database.prisma;
    await loadInstalledFiscalCatalogs(db.database.prisma);
    companyA = await insertCompany(prisma, "Empresa A");
    companyB = await insertCompany(prisma, "Empresa B");
    userA = (await insertMember(prisma, companyA, { name: "Admin A", role: "ADMIN" })).userId;
  });

  afterAll(async () => {
    await db.drop();
  });

  describe("terceros", () => {
    it("la identificación es única por empresa, tipo y número, también si está desactivado", async () => {
      await prisma.party.create({ data: party(companyA, { status: "INACTIVE" }) });
      expect(await fails(prisma.party.create({ data: party(companyA) }))).toMatch(
        /party_company_id_identification_type_identification_key|Unique constraint/,
      );
      expect(await fails(prisma.party.create({ data: party(companyB) }))).toBeNull();
      // Otro tipo con el mismo número no choca.
      expect(
        await fails(prisma.party.create({ data: party(companyA, { identificationType: "06" }) })),
      ).toBeNull();
    });

    it("rechaza roles fuera de los tres, saltos de línea y textos vacíos", async () => {
      const id = { identification: "0102030405", identificationType: "05" };
      expect(
        await fails(
          prisma.party.create({ data: party(companyA, { ...id, roles: ["DESTINATARIO"] }) }),
        ),
      ).toMatch(/party_roles_check/);
      expect(
        await fails(prisma.party.create({ data: party(companyA, { ...id, legalName: "A\nB" }) })),
      ).toMatch(/party_text_check/);
      expect(
        await fails(prisma.party.create({ data: party(companyA, { ...id, email: "" }) })),
      ).toMatch(/party_text_check/);
      expect(
        await fails(
          prisma.party.create({ data: party(companyA, { ...id, identificationType: "4" }) }),
        ),
      ).toMatch(/party_identification_check|value too long|character/);
    });

    it("un tercero normal no usa el 07 y no hay dos consumidores finales", async () => {
      expect(
        await fails(
          prisma.party.create({
            data: party(companyA, { identificationType: "07", identification: "9999999999999" }),
          }),
        ),
      ).toMatch(/party_system_record_check/);
      expect(
        await fails(
          prisma.party.create({
            data: {
              companyId: companyA,
              identificationType: "07",
              identification: "9999999999999",
              legalName: "CONSUMIDOR FINAL",
              roles: ["CUSTOMER"],
              systemRecord: "CONSUMER_FINAL",
              searchName: "consumidor final",
              searchIdentification: "9999999999999",
            },
          }),
        ),
      ).toMatch(/party_company_id_identification_type_identification_key|Unique constraint/);
    });

    it("el consumidor final no se corrige, no se desactiva ni se borra", async () => {
      const consumer = await prisma.party.findFirstOrThrow({
        where: { companyId: companyA, systemRecord: "CONSUMER_FINAL" },
      });
      for (const data of [{ legalName: "OTRO" }, { status: "INACTIVE" }, { systemRecord: null }]) {
        expect(await fails(prisma.party.update({ where: { id: consumer.id }, data }))).toMatch(
          /registro del sistema/,
        );
      }
      expect(await fails(prisma.party.delete({ where: { id: consumer.id } }))).toMatch(
        /registro del sistema/,
      );
      expect(
        await fails(prisma.$executeRawUnsafe(`TRUNCATE "${db.name}"."party" CASCADE`)),
      ).toMatch(/no se truncan/);
      expect(await prisma.party.findUniqueOrThrow({ where: { id: consumer.id } })).toEqual(
        consumer,
      );
    });

    it("un tercero normal no se convierte en registro del sistema", async () => {
      const normal = await prisma.party.create({
        data: party(companyA, { identificationType: "08", identification: "X-1" }),
      });
      expect(
        await fails(
          prisma.party.update({
            where: { id: normal.id },
            data: { systemRecord: "CONSUMER_FINAL" },
          }),
        ),
      ).toMatch(/marca de registro del sistema|party_system_record_check/);
    });
  });

  describe("productos", () => {
    it("exige exactamente un IVA al confirmar", async () => {
      expect(await fails(createProduct({ mainCode: "SIN-IVA" }, []))).toMatch(/no tiene IVA/);
      expect(
        await fails(
          createProduct({ mainCode: "DOS-IVA" }, [
            ["iva-rate", "4"],
            ["iva-rate", "2"],
          ]),
        ),
      ).toMatch(/product_tax_pkey|Unique constraint/);
      const id = await createProduct({ mainCode: "CON-IVA" });
      expect(
        await fails(
          prisma.productTax.delete({
            where: { productId_catalogType: { productId: id, catalogType: "iva-rate" } },
          }),
        ),
      ).toMatch(/no tiene IVA/);
    });

    it("el IRBPNR solo en bienes; pasar a servicio quitándolo en la misma transacción se acepta", async () => {
      expect(
        await fails(
          createProduct({ kind: "SERVICE", mainCode: "SRV-IRB" }, [
            ["iva-rate", "4"],
            ["irbpnr-rate", "5001"],
          ]),
        ),
      ).toMatch(/no admite IRBPNR/);
      const good = await createProduct({ mainCode: "BOT-1" }, [
        ["iva-rate", "4"],
        ["irbpnr-rate", "5001"],
      ]);
      expect(
        await fails(prisma.product.update({ where: { id: good }, data: { kind: "SERVICE" } })),
      ).toMatch(/no admite IRBPNR/);
      // En cualquier orden dentro de la transacción: primero el tipo, después el IRBPNR.
      await db.database.prisma.$transaction(async (tx) => {
        await tx.product.update({ where: { id: good }, data: { kind: "SERVICE" } });
        await tx.productTax.delete({
          where: { productId_catalogType: { productId: good, catalogType: "irbpnr-rate" } },
        });
      });
      expect((await prisma.product.findUniqueOrThrow({ where: { id: good } })).kind).toBe(
        "SERVICE",
      );
    });

    it("el control de stock solo en bienes, el precio no negativo y el tipo cerrado", async () => {
      expect(await fails(createProduct({ kind: "SERVICE", stockTracked: true }))).toMatch(
        /product_stock_tracked_check/,
      );
      expect(await fails(createProduct({ unitPrice: "-1" }))).toMatch(/product_unit_price_check/);
      expect(await fails(createProduct({ kind: "OTRO" }))).toMatch(/product_kind_check/);
    });

    it("el precio sigue el dominio, no la escala de NUMERIC: 18 dígitos y 6 decimales", async () => {
      for (const [unitPrice, mainCode] of [
        ["0", "P-0"],
        ["0.000001", "P-1"],
        ["999999999999999999", "P-2"],
        ["999999999999.999999", "P-3"],
      ]) {
        const id = await createProduct({ unitPrice, mainCode });
        const stored = await prisma.product.findUniqueOrThrow({ where: { id } });
        expect(stored.unitPrice.toFixed()).toBe(unitPrice);
      }
      // Un NUMERIC sin escala los guardaría tal cual; el CHECK de dominio los rechaza, sin redondear.
      for (const unitPrice of ["1000000000000000000", "1234567890123.123456", "0.1234567"]) {
        expect(await fails(createProduct({ unitPrice })), unitPrice).toMatch(
          /product_unit_price_check/,
        );
      }
    });

    it("el código principal es único por empresa; los productos sin código no chocan", async () => {
      await createProduct({ mainCode: "CEM-50" });
      expect(await fails(createProduct({ mainCode: "CEM-50" }))).toMatch(
        /product_company_id_main_code_key|Unique constraint/,
      );
      expect(await fails(createProduct({ mainCode: null }))).toBeNull();
      expect(await fails(createProduct({ mainCode: null }))).toBeNull();
    });

    it("una referencia fiscal apunta a una entrada existente de los tres catálogos", async () => {
      expect(
        await fails(
          createProduct({ mainCode: "REF-1" }, [
            ["iva-rate", "4"],
            ["ice-rate", "9999"],
          ]),
        ),
      ).toMatch(/product_tax_catalog_type_entry_key_fkey|Foreign key/);
      expect(
        await fails(
          createProduct({ mainCode: "REF-2" }, [
            ["iva-rate", "4"],
            ["payment-method", "01"],
          ]),
        ),
      ).toMatch(/product_tax_catalog_type_check/);
    });
  });
});
