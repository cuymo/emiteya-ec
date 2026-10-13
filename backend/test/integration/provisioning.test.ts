// Aprovisionamiento al arrancar (design D7) y validación de la configuración inicial (tarea 4.4).
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  INITIAL_ADMIN_NAME,
  provisionInstallation,
} from "../../src/modules/identity/application/provisioning.ts";
import type { UnitOfWork } from "../../src/modules/identity/application/unit-of-work.ts";
import {
  createUnitOfWork,
  createAuth,
} from "../../src/modules/identity/infrastructure/better-auth/index.ts";
import { createCompanyReader } from "../../src/modules/identity/infrastructure/prisma-companies.ts";
import {
  fiscalCatalogQueries,
  loadInstalledFiscalCatalogs,
} from "../../src/modules/catalogs/infrastructure/index.ts";
import { consumerFinalInitializer } from "../../src/modules/parties/infrastructure/index.ts";
import { createDatabase, type Database } from "../../src/platform/db/database.ts";
import { BACKEND_DIR, createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertCompany } from "./fixtures.ts";
import { buildAuthApp, signIn, testAuthSettings } from "./auth-harness.ts";

const ADMIN = { email: "admin@instalacion.ec", password: "contrasena-inicial-1" };

describe("aprovisionamiento de la instalación", () => {
  let db: MigratedSchema;
  const extra: Database[] = [];

  beforeEach(async () => {
    db = await createMigratedSchema("provisioning");
    // El consumidor final de la empresa nueva sale de la política (add-parties-and-products, D5).
    await loadInstalledFiscalCatalogs(db.database.prisma);
  });

  afterEach(async () => {
    await Promise.all(extra.splice(0).map((d) => d.close()));
    await db.drop();
  });

  const unitOfWork = (database: Database = db.database) => {
    const settings = testAuthSettings();
    return createUnitOfWork(
      database.prisma,
      createAuth({ prisma: database.prisma, settings }),
      settings,
      [consumerFinalInitializer({ policies: fiscalCatalogQueries(database.prisma) })],
    );
  };

  function provisioner(database: Database = db.database, admin = ADMIN, uowOverride?: UnitOfWork) {
    return () =>
      provisionInstallation({
        uow: uowOverride ?? unitOfWork(database),
        companies: createCompanyReader(database.prisma),
        initialAdmin: () => admin,
        correlationId: `prueba-${randomUUID()}`,
      });
  }

  const counts = async () => {
    const prisma = db.database.prisma;
    return {
      companies: await prisma.organization.count(),
      users: await prisma.user.count(),
      members: await prisma.member.count(),
      events: await prisma.auditEvent.count(),
      consumerFinals: await prisma.party.count({ where: { systemRecord: "CONSUMER_FINAL" } }),
    };
  };

  it("el primer arranque crea una empresa, el administrador y su membresía activa, con evento del sistema", async () => {
    expect(await provisioner()()).toBe("provisioned");
    expect(await counts()).toEqual({
      companies: 1,
      users: 1,
      members: 1,
      events: 1,
      consumerFinals: 1,
    });

    const prisma = db.database.prisma;
    const user = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN.email } });
    expect(user.name).toBe(INITIAL_ADMIN_NAME);
    expect(user.role).not.toBe("admin");
    const member = await prisma.member.findFirstOrThrow({ where: { userId: user.id } });
    expect(member).toMatchObject({ role: "ADMIN", status: "ACTIVE" });
    const event = await prisma.auditEvent.findFirstOrThrow();
    expect(event).toMatchObject({
      companyId: member.organizationId,
      actorType: "SYSTEM",
      actorUserId: null,
      action: "company.provisioned",
      targetUserId: user.id,
    });
    expect(JSON.stringify(event)).not.toContain(ADMIN.password);

    const { app } = buildAuthApp(db);
    expect((await signIn(app, ADMIN.email, ADMIN.password)).status).toBe(200);
  });

  it("un arranque posterior con otra configuración no crea nada ni cambia la contraseña", async () => {
    await provisioner()();
    const changed = { email: "otro@instalacion.ec", password: "otra-contrasena-123" };
    expect(await provisioner(db.database, changed)()).toBe("already_provisioned");
    expect(await counts()).toEqual({
      companies: 1,
      users: 1,
      members: 1,
      events: 1,
      consumerFinals: 1,
    });

    const { app } = buildAuthApp(db);
    expect((await signIn(app, ADMIN.email, ADMIN.password)).status).toBe(200);
    expect((await signIn(app, changed.email, changed.password)).status).toBe(401);
  });

  it("con la empresa ya aprovisionada no valida ni usa la configuración inicial", async () => {
    await provisioner()();
    const result = await provisionInstallation({
      uow: unitOfWork(),
      companies: createCompanyReader(db.database.prisma),
      initialAdmin: () => {
        throw new Error("no debe invocarse");
      },
      correlationId: "posterior",
    });
    expect(result).toBe("already_provisioned");
  });

  it("dos arranques simultáneos dejan una empresa, un administrador y una membresía", async () => {
    const second = createDatabase(db.url);
    extra.push(second);
    const results = await Promise.all([provisioner(db.database)(), provisioner(second)()]);
    expect(results.sort()).toEqual(["already_provisioned", "provisioned"]);
    expect(await counts()).toEqual({
      companies: 1,
      users: 1,
      members: 1,
      events: 1,
      consumerFinals: 1,
    });
  });

  it("una interrupción a mitad del aprovisionamiento no deja nada, y el siguiente arranque termina sin duplicar", async () => {
    const real = unitOfWork();
    const interrupted: UnitOfWork = {
      run: (work) =>
        real.run((scope) =>
          work({
            ...scope,
            audit: {
              append: () => Promise.reject(new Error("proceso interrumpido")),
            },
          }),
        ),
    };
    await expect(provisioner(db.database, ADMIN, interrupted)()).rejects.toThrow(
      "proceso interrumpido",
    );
    expect(await counts()).toEqual({
      companies: 0,
      users: 0,
      members: 0,
      events: 0,
      consumerFinals: 0,
    });

    expect(await provisioner()()).toBe("provisioned");
    expect(await counts()).toEqual({
      companies: 1,
      users: 1,
      members: 1,
      events: 1,
      consumerFinals: 1,
    });
  });

  it("reanuda sobre una identidad que un arranque anterior dejó creada, sin duplicarla", async () => {
    const settings = testAuthSettings();
    const auth = createAuth({ prisma: db.database.prisma, settings });
    await createUnitOfWork(db.database.prisma, auth, settings).run(({ identity }) =>
      identity.createUser({ name: "Previo", ...ADMIN }),
    );
    expect(await provisioner()()).toBe("provisioned");
    expect(await counts()).toEqual({
      companies: 1,
      users: 1,
      members: 1,
      events: 1,
      consumerFinals: 1,
    });
  });

  it("con una empresa existente el aprovisionamiento no crea otra", async () => {
    await insertCompany(db.database.prisma, "Existente");
    expect(await provisioner()()).toBe("already_provisioned");
    expect(await counts()).toEqual({
      companies: 1,
      users: 0,
      members: 0,
      events: 0,
      consumerFinals: 1,
    });
  });

  it("la base acepta una segunda empresa insertada directamente: ninguna restricción impide multiempresa", async () => {
    await provisioner()();
    await insertCompany(db.database.prisma, "Segunda empresa");
    expect(await db.database.prisma.organization.count()).toBe(2);
  });

  describe("arranque con configuración inicial inválida", () => {
    function startup(env: Record<string, string>) {
      return spawnSync(process.execPath, ["--conditions=development", "src/main.ts"], {
        cwd: BACKEND_DIR,
        env: {
          PATH: process.env.PATH,
          NODE_ENV: "development",
          DATABASE_URL: db.url,
          BETTER_AUTH_SECRET: "secreto-de-pruebas-0123456789abcdef0123",
          BETTER_AUTH_URL: "http://localhost:3000",
          LOG_LEVEL: "silent",
          CERTIFICATE_CUSTODY: "disabled",
          ...env,
        },
        encoding: "utf8",
        timeout: 90_000,
      });
    }

    it("sin correo del administrador inicial el arranque falla, lo indica y no crea nada", async () => {
      const result = startup({ INITIAL_USER_PASSWORD: ADMIN.password });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("INITIAL_USER_EMAIL: es obligatoria");
      expect(result.stderr + result.stdout).not.toContain(ADMIN.password);
      expect(await counts()).toEqual({
        companies: 0,
        users: 0,
        members: 0,
        events: 0,
        consumerFinals: 0,
      });
    });

    it("con una contraseña inicial corta el arranque falla sin mostrarla y sin crear nada", async () => {
      const short = "corta-123";
      const result = startup({ INITIAL_USER_EMAIL: ADMIN.email, INITIAL_USER_PASSWORD: short });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        "INITIAL_USER_PASSWORD: debe tener entre 12 y 128 caracteres",
      );
      expect(result.stderr + result.stdout).not.toContain(short);
      expect(await counts()).toEqual({
        companies: 0,
        users: 0,
        members: 0,
        events: 0,
        consumerFinals: 0,
      });
    });
  });
});
