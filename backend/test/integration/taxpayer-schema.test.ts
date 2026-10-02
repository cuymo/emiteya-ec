// Invariantes de la migración add_taxpayer_setup en PostgreSQL con dos empresas (design D2, D4,
// D5, D7, D8 y D13): solo agregado, RUC bloqueado, códigos inmutables y claves compuestas por
// empresa. Escribe directamente en las tablas para probar la defensa de la base de datos, no la
// de la aplicación.
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/platform/db/database.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertCompany, insertMember } from "./fixtures.ts";

const RUC = "1790012345001";
const OTHER_RUC = "0990012345001";

function versionData(companyId: string, createdById: string, version: number, ruc = RUC) {
  return {
    companyId,
    version,
    ruc,
    legalName: "Comercial Andina S.A.",
    headOfficeAddress: "Av. Amazonas N24-03, Quito",
    accountingRequired: true,
    largeTaxpayer: false,
    environment: "TEST",
    createdById,
  };
}

async function insertAsset(db: DbClient, companyId: string, createdById: string, seed: string) {
  const content = Buffer.from(`\x89PNG\r\n\x1a\n${seed}`, "binary");
  return db.configurationAsset.create({
    data: {
      companyId,
      kind: "LOGO",
      mimeType: "image/png",
      sizeBytes: content.length,
      sha256: createHash("sha256").update(content).digest("hex"),
      content,
      createdById,
    },
  });
}

describe("invariantes de la configuración tributaria en la base de datos", () => {
  let db: MigratedSchema;
  let prisma: DbClient;
  let companyA: string;
  let companyB: string;
  let userA: string;
  let userB: string;
  const table = (name: string) => `"${db.name}"."${name}"`;

  beforeAll(async () => {
    db = await createMigratedSchema("taxpayer_schema");
    prisma = db.database.prisma;
    companyA = await insertCompany(prisma, "Empresa A");
    companyB = await insertCompany(prisma, "Empresa B");
    userA = (await insertMember(prisma, companyA, { name: "Ana", role: "ADMIN" })).userId;
    userB = (await insertMember(prisma, companyB, { name: "Beto", role: "ADMIN" })).userId;
  });

  afterAll(async () => {
    await db.drop();
  });

  it("acepta una segunda empresa con su propia configuración", async () => {
    const versionB = await prisma.companyConfigVersion.create({
      data: versionData(companyB, userB, 1, OTHER_RUC),
    });
    await prisma.companyConfig.create({
      data: {
        companyId: companyB,
        currentVersionId: versionB.id,
        currentVersion: 1,
        updatedAt: new Date(),
      },
    });
    expect(await prisma.organization.count()).toBe(2);
  });

  describe("solo agregado", () => {
    it("rechaza UPDATE, DELETE y TRUNCATE sobre versiones y assets", async () => {
      const version = await prisma.companyConfigVersion.create({
        data: versionData(companyA, userA, 1),
      });
      const asset = await insertAsset(prisma, companyA, userA, "append-only");
      for (const statement of [
        `UPDATE ${table("company_config_version")} SET "legal_name" = 'Otra' WHERE "id" = '${version.id}'`,
        `DELETE FROM ${table("company_config_version")} WHERE "id" = '${version.id}'`,
        `TRUNCATE ${table("company_config_version")} CASCADE`,
        `UPDATE ${table("configuration_asset")} SET "kind" = 'LOGO' WHERE "id" = '${asset.id}'`,
        `DELETE FROM ${table("configuration_asset")} WHERE "id" = '${asset.id}'`,
        `TRUNCATE ${table("configuration_asset")} CASCADE`,
      ]) {
        await expect(prisma.$executeRawUnsafe(statement), statement).rejects.toThrow(
          /solo agregado/,
        );
      }
      await prisma.companyConfig.create({
        data: {
          companyId: companyA,
          currentVersionId: version.id,
          currentVersion: 1,
          updatedAt: new Date(),
        },
      });
      await expect(
        prisma.$executeRawUnsafe(
          `DELETE FROM ${table("company_config")} WHERE "company_id" = '${companyA}'`,
        ),
      ).rejects.toThrow(/solo agregado/);
    });
  });

  describe("identidad tributaria bloqueada", () => {
    it("bloquear exige el RUC de la versión vigente", async () => {
      await expect(
        prisma.companyConfig.update({
          where: { companyId: companyA },
          data: { taxIdentityLockedAt: new Date(), lockedRuc: OTHER_RUC },
        }),
      ).rejects.toThrow(/TAX_IDENTITY_LOCKED/);
      await expect(
        prisma.companyConfig.update({
          where: { companyId: companyA },
          data: { taxIdentityLockedAt: new Date() },
        }),
      ).rejects.toThrow(/company_config_tax_identity_lock_check/);
      await prisma.companyConfig.update({
        where: { companyId: companyA },
        data: { taxIdentityLockedAt: new Date(), lockedRuc: RUC },
      });
    });

    it("rechaza una versión con otro RUC y acepta otra con el mismo", async () => {
      await expect(
        prisma.companyConfigVersion.create({ data: versionData(companyA, userA, 2, OTHER_RUC) }),
      ).rejects.toThrow(/TAX_IDENTITY_LOCKED/);
      const same = await prisma.companyConfigVersion.create({
        data: { ...versionData(companyA, userA, 2), headOfficeAddress: "Calle 2, Quito" },
      });
      await prisma.companyConfig.update({
        where: { companyId: companyA },
        data: { currentVersionId: same.id, currentVersion: 2 },
      });
    });

    it("no permite desbloquear ni cambiar el RUC bloqueado", async () => {
      await expect(
        prisma.companyConfig.update({
          where: { companyId: companyA },
          data: { taxIdentityLockedAt: null, lockedRuc: null },
        }),
      ).rejects.toThrow(/TAX_IDENTITY_LOCKED/);
      await expect(
        prisma.companyConfig.update({
          where: { companyId: companyA },
          data: { lockedRuc: OTHER_RUC },
        }),
      ).rejects.toThrow(/TAX_IDENTITY_LOCKED/);
      const config = await prisma.companyConfig.findUniqueOrThrow({
        where: { companyId: companyA },
      });
      expect(config.lockedRuc).toBe(RUC);
    });

    it("el bloqueo de una empresa no afecta a la otra", async () => {
      const versionB = await prisma.companyConfigVersion.create({
        data: versionData(companyB, userB, 2, RUC),
      });
      expect(versionB.ruc).toBe(RUC);
    });
  });

  describe("formatos", () => {
    it("rechaza un RUC, un ambiente o una categoría RIMPE inválidos y un salto de línea", async () => {
      for (const [overrides, constraint] of [
        [{ ruc: "1790012345002" }, "company_config_version_ruc_check"],
        [{ environment: "STAGING" }, "company_config_version_environment_check"],
        [{ rimpeCategory: "GENERAL" }, "company_config_version_rimpe_check"],
        [{ legalName: "Línea 1\nLínea 2" }, "company_config_version_texts_check"],
        [{ withholdingAgentResolution: "123456789" }, "company_config_version_withholding_check"],
      ] as const) {
        await expect(
          prisma.companyConfigVersion.create({
            data: { ...versionData(companyB, userB, 90), ...overrides },
          }),
          constraint,
        ).rejects.toThrow(new RegExp(constraint));
      }
    });

    it("rechaza un asset cuyo tamaño no coincide con su contenido", async () => {
      const content = Buffer.from("contenido");
      await expect(
        prisma.configurationAsset.create({
          data: {
            companyId: companyA,
            kind: "LOGO",
            mimeType: "image/png",
            sizeBytes: content.length + 1,
            sha256: "a".repeat(64),
            content,
            createdById: userA,
          },
        }),
      ).rejects.toThrow(/configuration_asset_size_check/);
    });

    it("rechaza códigos que no tienen tres dígitos", async () => {
      await expect(
        prisma.establishment.create({
          data: { companyId: companyA, code: "01", address: "Quito" },
        }),
      ).rejects.toThrow(/establishment_code_check/);
    });
  });

  describe("establecimientos y puntos", () => {
    it("no permite cambiar el código de un establecimiento, pero sí su dirección", async () => {
      const establishment = await prisma.establishment.create({
        data: { companyId: companyA, code: "001", address: "Quito" },
      });
      await expect(
        prisma.establishment.update({ where: { id: establishment.id }, data: { code: "002" } }),
      ).rejects.toThrow(/el código y la empresa no cambian/);
      const updated = await prisma.establishment.update({
        where: { id: establishment.id },
        data: { address: "Guayaquil" },
      });
      expect(updated.code).toBe("001");
    });

    it("no permite cambiar el código ni el establecimiento de un punto", async () => {
      const [first, second] = await Promise.all(
        ["010", "011"].map((code) =>
          prisma.establishment.create({ data: { companyId: companyA, code, address: "Quito" } }),
        ),
      );
      const point = await prisma.emissionPoint.create({
        data: { companyId: companyA, establishmentId: first!.id, code: "001" },
      });
      await expect(
        prisma.emissionPoint.update({ where: { id: point.id }, data: { code: "002" } }),
      ).rejects.toThrow(/no cambian/);
      await expect(
        prisma.emissionPoint.update({
          where: { id: point.id },
          data: { establishmentId: second!.id },
        }),
      ).rejects.toThrow(/no cambian/);
      const deactivated = await prisma.emissionPoint.update({
        where: { id: point.id },
        data: { active: false },
      });
      expect(deactivated.active).toBe(false);
    });
  });

  describe("claves compuestas por empresa", () => {
    it("rechazan un punto bajo un establecimiento de otra empresa", async () => {
      const establishmentB = await prisma.establishment.create({
        data: { companyId: companyB, code: "001", address: "Cuenca" },
      });
      await expect(
        prisma.emissionPoint.create({
          data: { companyId: companyA, establishmentId: establishmentB.id, code: "001" },
        }),
      ).rejects.toThrow(/emission_point_company_id_establishment_id_fkey/);
    });

    it("rechazan un predeterminado con un punto de otra empresa", async () => {
      const establishmentB = await prisma.establishment.findFirstOrThrow({
        where: { companyId: companyB },
      });
      const pointB = await prisma.emissionPoint.create({
        data: { companyId: companyB, establishmentId: establishmentB.id, code: "002" },
      });
      await expect(
        prisma.memberDefaultEmissionPoint.create({
          data: { companyId: companyA, userId: userA, emissionPointId: pointB.id },
        }),
      ).rejects.toThrow(/member_default_emission_point_company_id_emission_point_id_fkey/);
      await expect(
        prisma.memberDefaultEmissionPoint.create({
          data: { companyId: companyB, userId: userA, emissionPointId: pointB.id },
        }),
      ).rejects.toThrow(/member_default_emission_point_company_id_user_id_fkey/);
    });

    it("rechazan una versión vigente o un logo de otra empresa", async () => {
      // Con el mismo RUC que el bloqueado en A, para que solo la clave compuesta pueda rechazarla.
      const versionB = await prisma.companyConfigVersion.findFirstOrThrow({
        where: { companyId: companyB, ruc: RUC },
      });
      await expect(
        prisma.companyConfig.update({
          where: { companyId: companyA },
          data: { currentVersionId: versionB.id },
        }),
      ).rejects.toThrow(/company_config_company_id_current_version_id_fkey/);
      const assetB = await insertAsset(prisma, companyB, userB, "otra-empresa");
      await expect(
        prisma.companyConfigVersion.create({
          data: { ...versionData(companyA, userA, 3), logoAssetId: assetB.id },
        }),
      ).rejects.toThrow(/company_config_version_company_id_logo_asset_id_fkey/);
    });

    it("deduplican el mismo contenido por empresa, no entre empresas", async () => {
      await insertAsset(prisma, companyA, userA, "compartido");
      await expect(insertAsset(prisma, companyA, userA, "compartido")).rejects.toThrow(
        /Unique constraint|configuration_asset_company_id_sha256_key/,
      );
      await expect(insertAsset(prisma, companyB, userB, "compartido")).resolves.toBeDefined();
    });
  });

  it("identificadores aleatorios de otra empresa no resuelven nada", async () => {
    expect(
      await prisma.establishment.findFirst({ where: { companyId: companyB, id: randomUUID() } }),
    ).toBeNull();
  });
});
