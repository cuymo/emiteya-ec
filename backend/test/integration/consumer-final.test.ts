// Ciclo de vida del consumidor final (add-parties-and-products, design D5): empresa nueva (A),
// empresa existente sin consumidor final (B), segundo arranque (C), concurrencia y protecciones.
// Cada prueba termina con exactamente un consumidor final por empresa y su identidad intacta.
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  fiscalCatalogQueries,
  loadInstalledFiscalCatalogs,
} from "../../src/modules/catalogs/infrastructure/index.ts";
import { provisionInstallation } from "../../src/modules/identity/application/provisioning.ts";
import {
  createAuth,
  createUnitOfWork,
  type CompanyInitializer,
} from "../../src/modules/identity/infrastructure/better-auth/index.ts";
import { createCompanyReader } from "../../src/modules/identity/infrastructure/prisma-companies.ts";
import {
  consumerFinalInitializer,
  ensureConsumerFinals,
} from "../../src/modules/parties/infrastructure/index.ts";
import { createDatabase, type Database } from "../../src/platform/db/database.ts";
import { testAuthSettings } from "./auth-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertMember } from "./fixtures.ts";

const ADMIN = { email: "admin@consumidor.ec", password: "contrasena-inicial-1" };
const IDENTITY = {
  identificationType: "07",
  identification: "9999999999999",
  legalName: "CONSUMIDOR FINAL",
  roles: ["CUSTOMER"],
  status: "ACTIVE",
  systemRecord: "CONSUMER_FINAL",
};

describe("consumidor final de cada empresa", () => {
  let db: MigratedSchema;
  const extra: Database[] = [];

  beforeEach(async () => {
    db = await createMigratedSchema("consumer_final");
    await loadInstalledFiscalCatalogs(db.database.prisma);
  });

  afterEach(async () => {
    await Promise.all(extra.splice(0).map((d) => d.close()));
    await db.drop();
  });

  const fails = (promise: Promise<unknown>) =>
    promise.then(
      () => null,
      (error: unknown) => String(error),
    );

  function provision(
    database: Database = db.database,
    initializers?: CompanyInitializer[],
  ): Promise<string> {
    const settings = testAuthSettings();
    const uow = createUnitOfWork(
      database.prisma,
      createAuth({ prisma: database.prisma, settings }),
      settings,
      initializers ?? [
        consumerFinalInitializer({ policies: fiscalCatalogQueries(database.prisma) }),
      ],
    );
    return provisionInstallation({
      uow,
      companies: createCompanyReader(database.prisma),
      initialAdmin: () => ADMIN,
      correlationId: `prueba-${randomUUID()}`,
    });
  }

  const reconcile = (database: Database = db.database) =>
    ensureConsumerFinals({
      db: database.prisma,
      policies: fiscalCatalogQueries(database.prisma),
      companyIds: () => createCompanyReader(database.prisma).listIds(),
    });

  /** Empresa anterior a la migración: se inserta con el trigger desactivado, como dato heredado. */
  async function legacyCompany(name: string): Promise<string> {
    const id = randomUUID();
    const table = `"${db.name}"."organization"`;
    await db.database.prisma.$executeRawUnsafe(
      `ALTER TABLE ${table} DISABLE TRIGGER organization_requires_consumer_final`,
    );
    try {
      await db.database.prisma.organization.create({
        data: { id, name, slug: `${name}-${id.slice(0, 8)}`, createdAt: new Date() },
      });
    } finally {
      await db.database.prisma.$executeRawUnsafe(
        `ALTER TABLE ${table} ENABLE TRIGGER organization_requires_consumer_final`,
      );
    }
    return id;
  }

  /** La invariante: cada empresa tiene exactamente un consumidor final con su identidad. */
  async function expectInvariant() {
    const prisma = db.database.prisma;
    const companies = await prisma.organization.findMany({ select: { id: true } });
    for (const { id } of companies) {
      const consumers = await prisma.party.findMany({
        where: { companyId: id, systemRecord: "CONSUMER_FINAL" },
      });
      expect(consumers, id).toHaveLength(1);
      expect(consumers[0]).toMatchObject(IDENTITY);
    }
    return companies.length;
  }

  it("A. el aprovisionamiento crea la empresa y su consumidor final, con la identidad de la política", async () => {
    expect(await provision()).toBe("provisioned");
    expect(await expectInvariant()).toBe(1);
    const consumer = await db.database.prisma.party.findFirstOrThrow({
      where: { systemRecord: "CONSUMER_FINAL" },
    });
    expect(consumer).toMatchObject({ createdBy: null, updatedBy: null, version: 1 });
  });

  it("A. un fallo después de crear la empresa no deja ni la empresa ni el consumidor final", async () => {
    const policies = fiscalCatalogQueries(db.database.prisma);
    const failing: CompanyInitializer = () => Promise.reject(new Error("iniciador interrumpido"));
    await expect(
      provision(db.database, [consumerFinalInitializer({ policies }), failing]),
    ).rejects.toThrow("iniciador interrumpido");
    expect(await db.database.prisma.organization.count()).toBe(0);
    expect(await db.database.prisma.party.count()).toBe(0);
  });

  it("A. la base de datos rechaza confirmar una empresa sin consumidor final", async () => {
    const id = randomUUID();
    expect(
      await fails(
        db.database.prisma.organization.create({
          data: {
            id,
            name: "Sin consumidor",
            slug: `sin-${id.slice(0, 8)}`,
            createdAt: new Date(),
          },
        }),
      ),
    ).toMatch(/no tiene consumidor final/);
    expect(await db.database.prisma.organization.count()).toBe(0);
  });

  it("A. sin política aplicable el aprovisionamiento falla de forma explícita y no crea nada", async () => {
    const before = consumerFinalInitializer({
      policies: fiscalCatalogQueries(db.database.prisma),
      // 1 de julio de 2026: antes de la base del proyecto, no hay política aplicable.
      now: () => new Date("2026-07-01T17:00:00Z"),
    });
    await expect(provision(db.database, [before])).rejects.toThrow(
      "No hay una política de consumidor final aplicable el 2026-07-01",
    );
    expect(await db.database.prisma.organization.count()).toBe(0);
    expect(await db.database.prisma.user.count()).toBe(0);
    expect(await db.database.prisma.party.count()).toBe(0);
  });

  it("B. la reposición crea exactamente uno para una empresa que no lo tiene", async () => {
    await legacyCompany("heredada");
    expect(await reconcile()).toEqual({ created: 1 });
    expect(await expectInvariant()).toBe(1);
  });

  it("C. un segundo arranque no crea duplicados ni modifica el existente", async () => {
    await legacyCompany("heredada");
    await reconcile();
    const before = await db.database.prisma.party.findMany();
    expect(await reconcile()).toEqual({ created: 0 });
    expect(await db.database.prisma.party.findMany()).toEqual(before);
    expect(await expectInvariant()).toBe(1);
  });

  it("dos aprovisionamientos simultáneos dejan una empresa y un consumidor final", async () => {
    const second = createDatabase(db.url);
    extra.push(second);
    const results = await Promise.all([provision(db.database), provision(second)]);
    expect(results.sort()).toEqual(["already_provisioned", "provisioned"]);
    expect(await expectInvariant()).toBe(1);
  });

  it("dos reposiciones simultáneas dejan exactamente uno por empresa", async () => {
    await legacyCompany("primera");
    await legacyCompany("segunda");
    const second = createDatabase(db.url);
    extra.push(second);
    const [a, b] = await Promise.all([reconcile(db.database), reconcile(second)]);
    expect(a.created + b.created).toBeGreaterThanOrEqual(2);
    expect(await expectInvariant()).toBe(2);
  });

  it("ni un tercero normal con 07, ni corregir, desactivar o borrar el consumidor final rompen la invariante", async () => {
    await provision();
    const prisma = db.database.prisma;
    const company = (await prisma.organization.findFirstOrThrow()).id;
    const userId = (await insertMember(prisma, company, { name: "Ana", role: "ADMIN" })).userId;
    const consumer = await prisma.party.findFirstOrThrow({
      where: { systemRecord: "CONSUMER_FINAL" },
    });
    expect(
      await fails(
        prisma.party.create({
          data: {
            companyId: company,
            identificationType: "07",
            identification: "9999999999998",
            legalName: "Otro consumidor",
            searchName: "otro consumidor",
            searchIdentification: "9999999999998",
            createdBy: userId,
            updatedBy: userId,
          },
        }),
      ),
    ).toMatch(/party_system_record_check/);
    for (const data of [{ legalName: "OTRO NOMBRE" }, { status: "INACTIVE" }]) {
      expect(await fails(prisma.party.update({ where: { id: consumer.id }, data }))).toMatch(
        /registro del sistema/,
      );
    }
    expect(await fails(prisma.party.delete({ where: { id: consumer.id } }))).toMatch(
      /registro del sistema/,
    );
    expect(await prisma.party.findUniqueOrThrow({ where: { id: consumer.id } })).toEqual(consumer);
    expect(await expectInvariant()).toBe(1);
  });
});
