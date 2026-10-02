// Casos de uso del logo contra PostgreSQL (ADR 0017, design D5 y D11): versiones nuevas que
// referencian assets inmutables, historial intacto, auditoría sin contenido y validación por contenido.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuditLog } from "../../src/modules/audit/infrastructure/prisma-audit-log.ts";
import { createAuthorizer } from "../../src/modules/identity/application/authorization.ts";
import type { RequestContext } from "../../src/modules/identity/application/request-context.ts";
import { createMembershipReader } from "../../src/modules/identity/infrastructure/prisma-memberships.ts";
import { createTaxpayerConfiguration } from "../../src/modules/taxpayer/application/taxpayer-configuration.ts";
import { createTaxpayerLogo } from "../../src/modules/taxpayer/application/taxpayer-logo.ts";
import { createCompanyConfigRepository } from "../../src/modules/taxpayer/infrastructure/prisma-company-config.ts";
import { createConfigurationAssetStore } from "../../src/modules/taxpayer/infrastructure/prisma-configuration-assets.ts";
import { createTaxpayerUnitOfWork } from "../../src/modules/taxpayer/infrastructure/unit-of-work.ts";
import { SVG_BYTES, pngBytes } from "../fixtures/images.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertCompany, insertMember } from "./fixtures.ts";

const LIMIT = 32 * 1024;

describe("logo de la empresa", () => {
  let db: MigratedSchema;
  let companyId: string;
  let adminId: string;
  const first = pngBytes(64, 32, 1);
  const second = pngBytes(64, 32, 2);

  const ctx = (): RequestContext => ({
    userId: adminId,
    companyId,
    role: "ADMIN",
    requestId: randomUUID(),
  });

  const services = () => {
    const prisma = db.database.prisma;
    const uow = createTaxpayerUnitOfWork(prisma);
    const configs = createCompanyConfigRepository(prisma);
    const authorizer = createAuthorizer({
      memberships: createMembershipReader(prisma),
      securityEvents: { emit: () => undefined },
    });
    return {
      configuration: createTaxpayerConfiguration({ uow, configs, authorizer }),
      logo: createTaxpayerLogo({
        uow,
        configs,
        assets: createConfigurationAssetStore(prisma),
        authorizer,
        logoMaxBytes: LIMIT,
      }),
    };
  };

  const versions = () =>
    db.database.prisma.companyConfigVersion.findMany({
      where: { companyId },
      orderBy: { version: "asc" },
      include: { logoAsset: true },
    });

  beforeAll(async () => {
    db = await createMigratedSchema("taxpayer_logo");
    companyId = await insertCompany(db.database.prisma, "Empresa A");
    adminId = (await insertMember(db.database.prisma, companyId, { name: "Ana", role: "ADMIN" }))
      .userId;
  });

  afterAll(async () => {
    await db.drop();
  });

  it("sin datos registrados rechaza el logo", async () => {
    await expect(
      services().logo.replaceLogo(ctx(), { expectedVersion: "1" }, first),
    ).rejects.toMatchObject({ code: "TAXPAYER_NOT_CONFIGURED", status: 409 });
  });

  it("cargar un logo crea una versión que lo referencia, con su evento sin contenido", async () => {
    await services().configuration.updateProfile(ctx(), {
      ruc: "1790012345001",
      legalName: "Comercial Andina S.A.",
      headOfficeAddress: "Quito",
      accountingRequired: true,
      expectedVersion: null,
    });
    const stored = await services().logo.replaceLogo(ctx(), { expectedVersion: "1" }, first);
    expect(stored.version).toBe(2);
    expect(stored.config.logo).toMatchObject({ mimeType: "image/png", sizeBytes: first.length });
    const [event] = await createAuditLog(db.database.prisma).listForCompany(companyId);
    expect(event).toMatchObject({
      action: "taxpayer.logo_replaced",
      changes: {
        configVersion: 2,
        "logoSha256.from": null,
        "logoSha256.to": stored.config.logo!.sha256,
        "logoMimeType.to": "image/png",
        "logoSizeBytes.to": first.length,
      },
    });
    expect(JSON.stringify(event!.changes)).not.toContain(first.toString("base64").slice(0, 16));
    const read = await services().logo.readLogo(ctx());
    expect(Buffer.from(read.content).equals(first)).toBe(true);
  });

  it("reemplazar crea otra versión y la anterior conserva su logo intacto", async () => {
    const stored = await services().logo.replaceLogo(ctx(), { expectedVersion: "2" }, second);
    expect(stored.version).toBe(3);
    const [, v2, v3] = await versions();
    expect(Buffer.from(v2!.logoAsset!.content).equals(first)).toBe(true);
    expect(Buffer.from(v3!.logoAsset!.content).equals(second)).toBe(true);
  });

  it("cargar la misma imagen que la vigente no crea versión", async () => {
    const stored = await services().logo.replaceLogo(ctx(), { expectedVersion: "3" }, second);
    expect(stored.version).toBe(3);
    expect(await versions()).toHaveLength(3);
  });

  it("rechaza una versión esperada desactualizada", async () => {
    await expect(
      services().logo.replaceLogo(ctx(), { expectedVersion: "2" }, pngBytes(8, 8, 3)),
    ).rejects.toMatchObject({ code: "CONFIG_VERSION_CONFLICT" });
    expect(await versions()).toHaveLength(3);
  });

  it("eliminar crea una versión sin logo y la anterior conserva el suyo", async () => {
    const stored = await services().logo.removeLogo(ctx(), { expectedVersion: "3" });
    expect(stored).toMatchObject({ version: 4, config: { logo: null } });
    const [, , v3, v4] = await versions();
    expect(v4!.logoAssetId).toBeNull();
    expect(Buffer.from(v3!.logoAsset!.content).equals(second)).toBe(true);
    const [event] = await createAuditLog(db.database.prisma).listForCompany(companyId);
    expect(event).toMatchObject({
      action: "taxpayer.logo_removed",
      changes: { "logoSha256.from": v3!.logoAsset!.sha256, "logoSha256.to": null },
    });
    await expect(services().logo.readLogo(ctx())).rejects.toMatchObject({ status: 404 });
  });

  it("eliminar sin logo vigente no crea versión", async () => {
    const stored = await services().logo.removeLogo(ctx(), { expectedVersion: "4" });
    expect(stored.version).toBe(4);
  });

  it("volver a cargar una imagen anterior reutiliza su asset", async () => {
    const stored = await services().logo.replaceLogo(ctx(), { expectedVersion: "4" }, first);
    const [, v2] = await versions();
    expect(stored.config.logo!.assetId).toBe(v2!.logoAssetId);
  });

  it("rechaza contenido que no es PNG ni JPEG y una imagen sobre el límite", async () => {
    await expect(
      services().logo.replaceLogo(ctx(), { expectedVersion: "5" }, SVG_BYTES),
    ).rejects.toMatchObject({ code: "INVALID_LOGO", status: 400 });
    const big = Buffer.concat([pngBytes(8, 8), Buffer.alloc(LIMIT)]);
    await expect(
      services().logo.replaceLogo(ctx(), { expectedVersion: "5" }, big),
    ).rejects.toMatchObject({ code: "LOGO_TOO_LARGE", status: 413, message: /32 KB/ });
    expect(await versions()).toHaveLength(5);
  });
});
