// Almacén de assets de configuración en PostgreSQL (ADR 0017, design D5).
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createConfigurationAssetStore } from "../../src/modules/taxpayer/infrastructure/prisma-configuration-assets.ts";
import { pngBytes } from "../fixtures/images.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertCompany, insertMember } from "./fixtures.ts";

describe("almacén de assets de configuración", () => {
  let db: MigratedSchema;
  let companyA: string;
  let companyB: string;
  let userA: string;
  let userB: string;

  beforeAll(async () => {
    db = await createMigratedSchema("configuration_assets");
    companyA = await insertCompany(db.database.prisma, "Empresa A");
    companyB = await insertCompany(db.database.prisma, "Empresa B");
    userA = (await insertMember(db.database.prisma, companyA, { name: "Ana" })).userId;
    userB = (await insertMember(db.database.prisma, companyB, { name: "Beto" })).userId;
  });

  afterAll(async () => {
    await db.drop();
  });

  it("guarda el contenido con su SHA-256 y tamaño, y lo lee por empresa", async () => {
    const store = createConfigurationAssetStore(db.database.prisma);
    const content = pngBytes(32, 32, 1);
    const saved = await store.save(companyA, {
      kind: "LOGO",
      mimeType: "image/png",
      content,
      createdBy: userA,
    });
    expect(saved).toMatchObject({
      mimeType: "image/png",
      sizeBytes: content.length,
      sha256: createHash("sha256").update(content).digest("hex"),
    });
    const read = await store.read(companyA, saved.assetId);
    expect(Buffer.from(read!.content).equals(content)).toBe(true);
    expect(await store.read(companyB, saved.assetId)).toBeNull();
  });

  it("el mismo contenido se guarda una vez por empresa y dos veces para dos empresas", async () => {
    const store = createConfigurationAssetStore(db.database.prisma);
    const content = pngBytes(16, 16, 2);
    const input = { kind: "LOGO" as const, mimeType: "image/png" as const, content };
    const first = await store.save(companyA, { ...input, createdBy: userA });
    const again = await store.save(companyA, { ...input, createdBy: userA });
    const other = await store.save(companyB, { ...input, createdBy: userB });
    expect(again.assetId).toBe(first.assetId);
    expect(other.assetId).not.toBe(first.assetId);
    expect(
      await db.database.prisma.configurationAsset.count({ where: { sha256: first.sha256 } }),
    ).toBe(2);
  });
});
