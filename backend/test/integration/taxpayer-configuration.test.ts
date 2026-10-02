// Casos de uso de la configuración tributaria contra PostgreSQL (design D1, D2, D4, D6 y D11):
// versiones, estado deseado, concurrencia, atomicidad con la auditoría, RUC bloqueado y ambiente.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuditLog } from "../../src/modules/audit/infrastructure/prisma-audit-log.ts";
import { createAuthorizer } from "../../src/modules/identity/application/authorization.ts";
import type { RequestContext } from "../../src/modules/identity/application/request-context.ts";
import type { SecurityEvent } from "../../src/modules/identity/application/security-events.ts";
import type { Role } from "../../src/modules/identity/domain/roles.ts";
import { createMembershipReader } from "../../src/modules/identity/infrastructure/prisma-memberships.ts";
import type { TaxpayerUnitOfWork } from "../../src/modules/taxpayer/application/ports.ts";
import { createTaxIdentityLock } from "../../src/modules/taxpayer/application/tax-identity-lock.ts";
import { createTaxpayerConfiguration } from "../../src/modules/taxpayer/application/taxpayer-configuration.ts";
import { createCompanyConfigRepository } from "../../src/modules/taxpayer/infrastructure/prisma-company-config.ts";
import { createTaxpayerUnitOfWork } from "../../src/modules/taxpayer/infrastructure/unit-of-work.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertCompany, insertMember } from "./fixtures.ts";

const PROFILE = {
  ruc: "1790012345001",
  legalName: "Comercial Andina S.A.",
  headOfficeAddress: "Av. Amazonas N24-03, Quito",
  accountingRequired: true,
};

describe("configuración tributaria", () => {
  let db: MigratedSchema;
  let companyA: string;
  let companyB: string;
  let companyC: string;
  const users: Record<string, string> = {};
  const events: SecurityEvent[] = [];

  const ctx = (user: string, companyId: string, role: Role = "ADMIN"): RequestContext => ({
    userId: users[user]!,
    companyId,
    role,
    requestId: randomUUID(),
  });

  const build = (wrap?: (uow: TaxpayerUnitOfWork) => TaxpayerUnitOfWork) => {
    const prisma = db.database.prisma;
    const uow = createTaxpayerUnitOfWork(prisma);
    return createTaxpayerConfiguration({
      uow: wrap ? wrap(uow) : uow,
      configs: createCompanyConfigRepository(prisma),
      authorizer: createAuthorizer({
        memberships: createMembershipReader(prisma),
        securityEvents: { emit: (event) => void events.push(event) },
      }),
    });
  };

  const versions = (companyId: string) =>
    db.database.prisma.companyConfigVersion.findMany({
      where: { companyId },
      orderBy: { version: "asc" },
    });
  const auditOf = (companyId: string) =>
    createAuditLog(db.database.prisma).listForCompany(companyId);

  beforeAll(async () => {
    db = await createMigratedSchema("taxpayer_config");
    const prisma = db.database.prisma;
    companyA = await insertCompany(prisma, "Empresa A");
    companyB = await insertCompany(prisma, "Empresa B");
    companyC = await insertCompany(prisma, "Empresa C");
    users.adminA = (await insertMember(prisma, companyA, { name: "Ana", role: "ADMIN" })).userId;
    users.adminA2 = (await insertMember(prisma, companyA, { name: "Abel", role: "ADMIN" })).userId;
    users.operatorA = (await insertMember(prisma, companyA, { name: "Óscar" })).userId;
    users.adminB = (await insertMember(prisma, companyB, { name: "Beto", role: "ADMIN" })).userId;
    users.adminC = (await insertMember(prisma, companyC, { name: "Cata", role: "ADMIN" })).userId;
  });

  afterAll(async () => {
    await db.drop();
  });

  describe("registro y corrección (design D2)", () => {
    it("el primer registro crea la versión 1 con su evento sin valores anteriores", async () => {
      const stored = await build().updateProfile(ctx("adminA", companyA), {
        ...PROFILE,
        expectedVersion: null,
      });
      expect(stored.version).toBe(1);
      expect(stored.config.environment).toBe("TEST");
      expect(stored.taxIdentityLocked).toBe(false);
      const [event] = await auditOf(companyA);
      expect(event).toMatchObject({
        action: "taxpayer.configured",
        actor: { type: "USER", userId: users.adminA },
        changes: { configVersion: 1, "ruc.to": PROFILE.ruc, "accountingRequired.to": true },
      });
      expect(Object.keys(event!.changes ?? {}).some((key) => key.endsWith(".from"))).toBe(false);
    });

    it("una corrección crea la versión siguiente y deja intacta la anterior", async () => {
      const stored = await build().updateProfile(ctx("adminA", companyA), {
        ...PROFILE,
        headOfficeAddress: "Calle 2, Quito",
        expectedVersion: 1,
      });
      expect(stored.version).toBe(2);
      const [v1, v2] = await versions(companyA);
      expect(v1!.headOfficeAddress).toBe(PROFILE.headOfficeAddress);
      expect(v2!.headOfficeAddress).toBe("Calle 2, Quito");
      const [event] = await auditOf(companyA);
      expect(event!.changes).toEqual({
        configVersion: 2,
        "headOfficeAddress.from": PROFILE.headOfficeAddress,
        "headOfficeAddress.to": "Calle 2, Quito",
      });
    });

    it("guardar los mismos valores no crea versión ni evento", async () => {
      const before = (await auditOf(companyA)).length;
      const stored = await build().updateProfile(ctx("adminA", companyA), {
        ...PROFILE,
        headOfficeAddress: "  Calle 2, Quito ",
        expectedVersion: 2,
      });
      expect(stored.version).toBe(2);
      expect(await versions(companyA)).toHaveLength(2);
      expect(await auditOf(companyA)).toHaveLength(before);
    });

    it("rechaza una versión esperada desactualizada sin sobrescribir", async () => {
      await expect(
        build().updateProfile(ctx("adminA", companyA), {
          ...PROFILE,
          legalName: "Otra S.A.",
          expectedVersion: 1,
        }),
      ).rejects.toMatchObject({ code: "CONFIG_VERSION_CONFLICT", status: 409 });
      expect(await versions(companyA)).toHaveLength(2);
    });

    it("el envío repetido del mismo cambio crea una sola versión", async () => {
      const body = { ...PROFILE, headOfficeAddress: "Calle 3, Quito", expectedVersion: 2 };
      const first = await build().updateProfile(ctx("adminA", companyA), body);
      const second = await build().updateProfile(ctx("adminA", companyA), body);
      expect(first.version).toBe(3);
      expect(second.version).toBe(3);
      expect(await versions(companyA)).toHaveLength(3);
    });

    it("de dos correcciones distintas simultáneas solo una gana", async () => {
      const results = await Promise.allSettled([
        build().updateProfile(ctx("adminA", companyA), {
          ...PROFILE,
          headOfficeAddress: "Calle 3, Quito",
          tradeName: "Andina",
          expectedVersion: 3,
        }),
        build().updateProfile(ctx("adminA2", companyA), {
          ...PROFILE,
          headOfficeAddress: "Calle 3, Quito",
          tradeName: "Andes",
          expectedVersion: 3,
        }),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find((result) => result.status === "rejected");
      expect((rejected as PromiseRejectedResult).reason).toMatchObject({
        code: "CONFIG_VERSION_CONFLICT",
      });
      expect(await versions(companyA)).toHaveLength(4);
    });

    it("dos primeros registros simultáneos dejan una sola versión 1", async () => {
      const results = await Promise.allSettled(
        ["Uno S.A.", "Dos S.A."].map((legalName) =>
          build().updateProfile(ctx("adminC", companyC), {
            ...PROFILE,
            legalName,
            expectedVersion: null,
          }),
        ),
      );
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(await versions(companyC)).toHaveLength(1);
    });

    it("un fallo al auditar revierte la versión", async () => {
      const failing = build((uow) => ({
        run: (work) =>
          uow.run((scope) =>
            work({
              ...scope,
              audit: { append: () => Promise.reject(new Error("fallo inyectado")) },
            }),
          ),
      }));
      await expect(
        failing.updateProfile(ctx("adminA", companyA), {
          ...PROFILE,
          headOfficeAddress: "Calle 9, Quito",
          tradeName: "Andina",
          expectedVersion: 4,
        }),
      ).rejects.toThrow("fallo inyectado");
      expect(await versions(companyA)).toHaveLength(4);
    });

    it("la configuración de una empresa nunca alcanza a la otra", async () => {
      await build().updateProfile(ctx("adminB", companyB), {
        ...PROFILE,
        ruc: "0990012345001",
        legalName: "Costa S.A.",
        expectedVersion: null,
      });
      const reader = createCompanyConfigRepository(db.database.prisma);
      expect((await reader.findCurrent(companyA))?.config.profile.legalName).toBe(
        PROFILE.legalName,
      );
      expect((await reader.findCurrent(companyB))?.config.profile.legalName).toBe("Costa S.A.");
      expect((await auditOf(companyB)).every((event) => event.companyId === companyB)).toBe(true);
      expect(await versions(companyB)).toHaveLength(1);
    });
  });

  describe("identidad tributaria (design D4)", () => {
    it("sin bloqueo el RUC se corrige y la versión anterior conserva el anterior", async () => {
      const stored = await build().updateProfile(ctx("adminB", companyB), {
        ...PROFILE,
        ruc: "0990099999001",
        legalName: "Costa S.A.",
        expectedVersion: 1,
      });
      expect(stored.config.profile.ruc).toBe("0990099999001");
      const [v1] = await versions(companyB);
      expect(v1!.ruc).toBe("0990012345001");
    });

    it("bloquear es idempotente y exige datos registrados", async () => {
      const lock = createTaxIdentityLock(createTaxpayerUnitOfWork(db.database.prisma));
      expect(await lock.lock(companyB)).toBe(true);
      expect(await lock.lock(companyB)).toBe(false);
      const empty = await insertCompany(db.database.prisma, "Empresa vacía");
      await expect(lock.lock(empty)).rejects.toMatchObject({ code: "TAXPAYER_NOT_CONFIGURED" });
    });

    it("con la identidad bloqueada rechaza cambiar el RUC sin versión ni evento", async () => {
      const before = (await auditOf(companyB)).length;
      await expect(
        build().updateProfile(ctx("adminB", companyB), {
          ...PROFILE,
          ruc: "0990012345001",
          legalName: "Costa S.A.",
          expectedVersion: 2,
        }),
      ).rejects.toMatchObject({ code: "TAX_IDENTITY_LOCKED", status: 409 });
      expect(await versions(companyB)).toHaveLength(2);
      expect(await auditOf(companyB)).toHaveLength(before);
    });

    it("con la identidad bloqueada los demás datos siguen siendo corregibles", async () => {
      const stored = await build().updateProfile(ctx("adminB", companyB), {
        ...PROFILE,
        ruc: "0990099999001",
        legalName: "Costa S.A.",
        headOfficeAddress: "Malecón 100, Guayaquil",
        expectedVersion: 2,
      });
      expect(stored).toMatchObject({ version: 3, taxIdentityLocked: true });
      expect(stored.config.profile.ruc).toBe("0990099999001");
    });
  });

  describe("ambiente (design D6)", () => {
    it("una empresa sin datos no puede cambiar de ambiente", async () => {
      const empty = await insertCompany(db.database.prisma, "Sin datos");
      users.adminEmpty = (
        await insertMember(db.database.prisma, empty, { name: "Eva", role: "ADMIN" })
      ).userId;
      expect(await build().getTaxpayer(ctx("adminEmpty", empty))).toBeNull();
      await expect(
        build().changeEnvironment(ctx("adminEmpty", empty), {
          environment: "PRODUCTION",
          expectedVersion: 1,
        }),
      ).rejects.toMatchObject({ code: "TAXPAYER_NOT_CONFIGURED" });
    });

    it("pasar a Producción crea una versión con los mismos datos y su evento", async () => {
      const before = await build().getTaxpayer(ctx("adminA", companyA));
      const stored = await build().changeEnvironment(ctx("adminA", companyA), {
        environment: "PRODUCTION",
        expectedVersion: before!.version,
      });
      expect(stored.version).toBe(before!.version + 1);
      expect(stored.config.environment).toBe("PRODUCTION");
      expect(stored.config.profile).toEqual(before!.config.profile);
      const [event] = await auditOf(companyA);
      expect(event).toMatchObject({
        action: "taxpayer.environment_changed",
        changes: {
          configVersion: stored.version,
          "environment.from": "TEST",
          "environment.to": "PRODUCTION",
        },
      });
    });

    it("pedir el ambiente vigente no crea versión", async () => {
      const before = await build().getTaxpayer(ctx("adminA", companyA));
      const stored = await build().changeEnvironment(ctx("adminA", companyA), {
        environment: "PRODUCTION",
        expectedVersion: before!.version,
      });
      expect(stored.version).toBe(before!.version);
    });

    it("guardar el perfil conserva el ambiente", async () => {
      const before = await build().getTaxpayer(ctx("adminA", companyA));
      const stored = await build().updateProfile(ctx("adminA", companyA), {
        ...PROFILE,
        legalName: "Comercial Andina Cía. Ltda.",
        expectedVersion: before!.version,
      });
      expect(stored.config.environment).toBe("PRODUCTION");
    });
  });

  describe("permisos", () => {
    it("el operador no consulta ni cambia la configuración y cada intento es un evento", async () => {
      const operator = ctx("operatorA", companyA, "OPERATOR");
      const count = events.length;
      await expect(build().getTaxpayer(operator)).rejects.toMatchObject({ status: 403 });
      await expect(
        build().updateProfile(operator, { ...PROFILE, expectedVersion: 1 }),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        build().changeEnvironment(operator, { environment: "TEST", expectedVersion: 1 }),
      ).rejects.toMatchObject({ status: 403 });
      expect(events.slice(count).map((event) => event.type)).toEqual([
        "authorization_denied",
        "authorization_denied",
        "authorization_denied",
      ]);
    });
  });
});
