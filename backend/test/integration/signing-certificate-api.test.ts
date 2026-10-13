// API de la firma electrónica contra PostgreSQL y el pool criptográfico reales (add-signing-
// certificate, design D3 a D12): carga y reemplazo con destrucción del secreto, idempotencia y
// conflicto, rechazos con su mensaje, consultas, anticipación, permisos, aislamiento y preparación
// para emitir. Fixtures sintéticos, nunca certificados reales. Desde repair-signing-certificate-
// reseal-after-master-key-change, también la recuperación de la custodia con otra clave (design D9).
import { randomUUID } from "node:crypto";
import request from "../support/http-client.ts";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { CertificateCustodyConfig } from "../../src/config/env.ts";
import { PASSWORD_ENCODING_MESSAGE } from "../../src/modules/signing/application/errors.ts";
import { certificateTasksEntry } from "../../src/modules/signing/infrastructure/index.ts";
import { createCryptoWorkerPool } from "../../src/platform/workers/crypto-worker-pool.ts";
import {
  FIXTURE_NONASCII_PASSWORD,
  FIXTURE_OTHER_RUC,
  FIXTURE_PASSWORD,
  FIXTURE_RUC,
  readFixture,
} from "../support/p12-fixtures.ts";
import { createMember } from "./auth-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertCompany } from "./fixtures.ts";
import { buildTaxpayerApp, sessionCookie } from "./taxpayer-harness.ts";

type Body = {
  data: Record<string, unknown> & { certificate?: Record<string, unknown> | null };
  error: { code: string; message: string };
};
const bodyOf = (res: { body: unknown }) => res.body as Body;
const dir = inject("p12FixturesDir");
const custody = (fill: number): CertificateCustodyConfig => ({
  enabled: true,
  keyVersion: "1",
  key: Buffer.alloc(32, fill),
});
const file = (name: string) => readFixture(dir, name).toString("base64");

describe("API de la firma electrónica", () => {
  let db: MigratedSchema;
  const pool = createCryptoWorkerPool({
    entry: certificateTasksEntry(),
    size: 2,
    timeoutMs: 30_000,
  });
  let api: ReturnType<typeof buildTaxpayerApp>;
  let companyA: string;
  const cookies: Record<string, string> = {};
  const call = (who: string, method: "get" | "put", path: string, app = api.app) =>
    request(app)[method](`/api/v1${path}`).set("Cookie", cookies[who]!);
  const upload = (
    who: string,
    name: string,
    expectedCurrentId: string | null,
    password = FIXTURE_PASSWORD,
    app = api.app,
  ) =>
    call(who, "put", "/signing-certificate", app).send({
      file: file(name),
      password,
      expectedCurrentId,
    });
  const audits = (action: string) =>
    db.database.prisma.auditEvent.findMany({
      where: { companyId: companyA, action },
      orderBy: { occurredAt: "asc" },
    });
  const current = async () =>
    bodyOf(await call("adminA", "get", "/signing-certificate")).data.certificate ?? null;

  beforeAll(async () => {
    db = await createMigratedSchema("signing_api");
    api = buildTaxpayerApp(db, { signing: { pool, custody: custody(7) } });
    companyA = await insertCompany(db.database.prisma, "Empresa A");
    const companyB = await insertCompany(db.database.prisma, "Empresa B");
    for (const [name, companyId, email, role] of [
      ["adminA", companyA, "admin@a.ec", "ADMIN"],
      ["operatorA", companyA, "operador@a.ec", "OPERATOR"],
      ["adminB", companyB, "admin@b.ec", "ADMIN"],
    ] as const) {
      await createMember(api.uow, companyId, { name, email, role });
      cookies[name] = await sessionCookie(api.app, email);
    }
  });

  afterAll(async () => {
    await pool.close();
    await db.drop();
  });

  describe("carga y reemplazo (design D3 y D7)", () => {
    it("sin firma: la consulta lo indica, con la anticipación por defecto y el límite efectivo", async () => {
      expect(bodyOf(await call("adminA", "get", "/signing-certificate")).data).toEqual({
        certificate: null,
        expiryAlertDays: 30,
        maxBytes: 64 * 1024,
      });
      expect(bodyOf(await call("operatorA", "get", "/signing-certificate/validity")).data).toEqual({
        state: "NONE",
        usable: false,
        notAfter: null,
        daysToExpiry: null,
      });
    });

    it("primera carga: queda vigente con metadatos, secreto cifrado y evento", async () => {
      const res = await upload("adminA", "sd-utf8.modern.p12", null);
      expect(res.status).toBe(200);
      const { certificate, unchanged } = bodyOf(res).data as {
        certificate: Record<string, unknown>;
        unchanged: boolean;
      };
      expect(unchanged).toBe(false);
      expect(certificate).toMatchObject({
        detectedRuc: FIXTURE_RUC,
        companyRuc: null,
        rucMatch: "PENDING",
        state: "VALID",
        usable: true,
      });
      expect(String(certificate.subject)).toContain("TITULAR DE PRUEBA sd-utf8");
      const secret = await db.database.prisma.signingCertificateSecret.findUnique({
        where: { certificateId: String(certificate.id) },
      });
      expect(secret?.keyVersion).toBe("1");
      const [event] = await audits("signing_certificate.loaded");
      expect(event?.changes).toMatchObject({
        "certificate.detectedRuc": FIXTURE_RUC,
        "certificate.rucMatch": "PENDING",
      });
      expect(Object.keys(event?.changes ?? {}).some((key) => key.startsWith("previous."))).toBe(
        false,
      );
    });

    it("reemplazo: la nueva queda vigente, el secreto anterior se destruye y sus metadatos se conservan", async () => {
      const previous = (await current())!;
      const res = await upload("adminA", "other-ruc.modern.p12", String(previous.id));
      expect(res.status).toBe(200);
      const next = bodyOf(res).data.certificate!;
      expect(next.detectedRuc).toBe(FIXTURE_OTHER_RUC);
      const old = await db.database.prisma.signingCertificate.findUniqueOrThrow({
        where: { id: String(previous.id) },
        include: { secret: true },
      });
      expect(old).toMatchObject({
        status: "REPLACED",
        activeCompanyId: null,
        replacedById: next.id,
        secret: null,
      });
      const [event] = await audits("signing_certificate.replaced");
      expect(event?.changes).toMatchObject({
        "previous.fingerprint": previous.fingerprint,
        "certificate.fingerprint": next.fingerprint,
      });
    });

    it("cargar otra vez la firma vigente no cambia nada ni audita", async () => {
      const before = (await current())!;
      const events = (await audits("signing_certificate.replaced")).length;
      const res = await upload("adminA", "other-ruc.modern.p12", null);
      expect(res.status).toBe(200);
      expect(bodyOf(res).data).toMatchObject({ unchanged: true, certificate: { id: before.id } });
      expect(await audits("signing_certificate.replaced")).toHaveLength(events);
    });

    it("un valor esperado desactualizado es un conflicto y no cambia nada", async () => {
      const replaced = await db.database.prisma.signingCertificate.findFirstOrThrow({
        where: { companyId: companyA, status: "REPLACED" },
      });
      const res = await upload("adminA", "sd-utf8.legacy.p12", replaced.id);
      expect(res.status).toBe(409);
      expect(bodyOf(res).error.code).toBe("CERTIFICATE_CHANGED");
      expect((await current())!.detectedRuc).toBe(FIXTURE_OTHER_RUC);
    });

    it("dos reemplazos simultáneos de la misma firma vigente: uno se aplica y el otro es conflicto", async () => {
      const vigente = String((await current())!.id);
      const [a, b] = await Promise.all([
        upload("adminA", "sd-utf8.modern.p12", vigente),
        upload("adminA", "sd-printable.modern.p12", vigente),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      expect(
        await db.database.prisma.signingCertificate.count({
          where: { companyId: companyA, status: "ACTIVE" },
        }),
      ).toBe(1);
    });

    it("una carga rechazada no cambia la firma vigente ni su secreto", async () => {
      const before = (await current())!;
      const res = await upload(
        "adminA",
        "sd-utf8.modern.p12",
        String(before.id),
        "contraseña-incorrecta",
      );
      expect(res.status).toBe(400);
      expect(bodyOf(res).error.code).toBe("CERTIFICATE_PASSWORD_INVALID");
      const after = (await current())!;
      expect(after.id).toBe(before.id);
      expect(
        await db.database.prisma.signingCertificateSecret.count({
          where: { certificateId: String(before.id) },
        }),
      ).toBe(1);
    });
  });

  describe("rechazos con su mensaje (design D3, Q-17)", () => {
    const rejection = async (name: string, password = FIXTURE_PASSWORD) => {
      const res = await upload("adminA", name, String((await current())!.id), password);
      expect(res.status, name).toBe(400);
      expect(bodyOf(res).error.message).not.toContain(password);
      return bodyOf(res).error;
    };

    it("archivo ilegible, clave no compatible, vigencia y RUC no encontrado", async () => {
      expect((await rejection("corrupt-truncated.p12")).code).toBe("CERTIFICATE_UNREADABLE");
      expect((await rejection("rsa1024.modern.p12")).code).toBe("CERTIFICATE_KEY_UNSUPPORTED");
      expect((await rejection("mismatch.p12")).code).toBe("CERTIFICATE_KEY_UNSUPPORTED");
      const expired = await rejection("expired.modern.p12");
      expect(expired.code).toBe("CERTIFICATE_NOT_VALID_NOW");
      // 2023-01-01T00:00Z es el 31/12/2022 en Ecuador.
      expect(expired.message).toContain("31/12/2022 al 31/12/2023");
      const future = await rejection("future.modern.p12");
      expect(future.code).toBe("CERTIFICATE_NOT_VALID_NOW");
      const noRuc = await rejection("noruc.modern.p12");
      expect(noRuc.code).toBe("CERTIFICATE_RUC_NOT_FOUND");
      expect(noRuc.message).toContain("TITULAR DE PRUEBA noruc");
      expect(noRuc.message).toContain("AC Pruebas");
      expect(noRuc.message).toContain("El SRI rechaza las firmas cuyo certificado no contiene RUC");
    });

    it("incompatible: el mensaje exacto para PBES2 con contraseña no ASCII, y otro para la CA primero", async () => {
      const encoding = await rejection("sd-utf8.modern.nonascii.p12", FIXTURE_NONASCII_PASSWORD);
      expect(encoding).toMatchObject({
        code: "CERTIFICATE_INCOMPATIBLE",
        message: PASSWORD_ENCODING_MESSAGE,
      });
      const chain = await rejection("ca-first.p12");
      expect(chain.code).toBe("CERTIFICATE_INCOMPATIBLE");
      expect(chain.message).toContain("no es el primero");
      expect((await rejection("sd-utf8.iter150000.p12")).code).toBe("CERTIFICATE_INCOMPATIBLE");
    });

    it("un archivo vacío pide seleccionar el archivo", async () => {
      const res = await call("adminA", "put", "/signing-certificate").send({
        file: "",
        password: FIXTURE_PASSWORD,
        expectedCurrentId: null,
      });
      expect(res.status).toBe(400);
      expect(bodyOf(res).error).toMatchObject({
        code: "VALIDATION_ERROR",
        message: "Selecciona el archivo de la firma electrónica.",
      });
    });

    it("un archivo mayor que CERTIFICATE_MAX_BYTES se rechaza por sus bytes decodificados", async () => {
      const small = buildTaxpayerApp(db, {
        signing: { pool, custody: custody(7), maxBytes: 4 * 1024 },
      });
      cookies.smallAdmin = await sessionCookie(small.app, "admin@a.ec");
      const current = await call("smallAdmin", "get", "/signing-certificate", small.app);
      expect(bodyOf(current).data.maxBytes).toBe(4 * 1024);
      const res = await upload(
        "smallAdmin",
        "rsa4096.modern.p12",
        null,
        FIXTURE_PASSWORD,
        small.app,
      );
      expect(res.status).toBe(400);
      expect(bodyOf(res).error).toMatchObject({
        code: "CERTIFICATE_TOO_LARGE",
        message: "El archivo de la firma supera el tamaño admitido (4 KiB).",
      });
    });

    it("sin custodia configurada la carga es 409", async () => {
      const disabled = buildTaxpayerApp(db, { signing: { pool, custody: { enabled: false } } });
      cookies.disabledAdmin = await sessionCookie(disabled.app, "admin@a.ec");
      const res = await upload(
        "disabledAdmin",
        "sd-utf8.modern.p12",
        null,
        FIXTURE_PASSWORD,
        disabled.app,
      );
      expect(res.status).toBe(409);
      expect(bodyOf(res).error.code).toBe("CERTIFICATE_CUSTODY_DISABLED");
    });
  });

  describe("consultas, coincidencia del RUC y anticipación (design D4, D8 y D9)", () => {
    it("la coincidencia sigue al RUC vigente de la empresa", async () => {
      // Firma vigente con el RUC 1790012345001 y empresa que aún no registró sus datos.
      const vigente = String((await current())!.id);
      if ((await current())!.detectedRuc !== FIXTURE_RUC)
        await upload("adminA", "sd-utf8.modern.p12", vigente);
      expect((await current())!.rucMatch).toBe("PENDING");
      const registered = await call("adminA", "put", "/taxpayer").send({
        ruc: FIXTURE_OTHER_RUC,
        legalName: "Empresa A S.A.",
        headOfficeAddress: "Quito",
        accountingRequired: true,
        expectedVersion: null,
      });
      expect(registered.status).toBe(200);
      expect(await current()).toMatchObject({
        rucMatch: "MISMATCH",
        companyRuc: FIXTURE_OTHER_RUC,
        usable: true,
      });
      const corrected = await call("adminA", "put", "/taxpayer").send({
        ruc: FIXTURE_RUC,
        legalName: "Empresa A S.A.",
        headOfficeAddress: "Quito",
        accountingRequired: true,
        expectedVersion: 1,
      });
      expect(corrected.status).toBe(200);
      expect(await current()).toMatchObject({ rucMatch: "MATCH", companyRuc: FIXTURE_RUC });
    });

    it("por vencer, vencida y con clave no disponible", async () => {
      const vigente = (await current())!;
      const notAfter = new Date(String(vigente.notAfter));
      const later = buildTaxpayerApp(db, {
        signing: {
          pool,
          custody: custody(7),
          now: () => new Date(notAfter.getTime() - 5 * 86_400_000),
        },
      });
      cookies.laterAdmin = await sessionCookie(later.app, "admin@a.ec");
      expect(
        bodyOf(await call("laterAdmin", "get", "/signing-certificate", later.app)).data.certificate,
      ).toMatchObject({
        state: "EXPIRING",
        usable: true,
        daysToExpiry: 5,
      });
      const after = buildTaxpayerApp(db, {
        signing: { pool, custody: custody(7), now: () => new Date(notAfter.getTime() + 1000) },
      });
      cookies.afterAdmin = await sessionCookie(after.app, "admin@a.ec");
      expect(
        bodyOf(await call("afterAdmin", "get", "/signing-certificate", after.app)).data.certificate,
      ).toMatchObject({
        state: "EXPIRED",
        usable: false,
      });
      const otherKey = buildTaxpayerApp(db, { signing: { pool, custody: custody(8) } });
      cookies.otherKeyAdmin = await sessionCookie(otherKey.app, "admin@a.ec");
      expect(
        bodyOf(await call("otherKeyAdmin", "get", "/signing-certificate", otherKey.app)).data
          .certificate,
      ).toMatchObject({
        state: "KEY_UNAVAILABLE",
        usable: false,
      });
    });

    it("la anticipación es un estado deseado y se audita al cambiar", async () => {
      const same = await call("adminA", "put", "/signing-certificate/expiry-alert").send({
        days: 30,
      });
      expect(bodyOf(same).data).toEqual({ expiryAlertDays: 30 });
      expect(await audits("signing_certificate.expiry_alert_changed")).toHaveLength(0);
      const changed = await call("adminA", "put", "/signing-certificate/expiry-alert").send({
        days: 45,
      });
      expect(bodyOf(changed).data).toEqual({ expiryAlertDays: 45 });
      const [event] = await audits("signing_certificate.expiry_alert_changed");
      expect(event?.changes).toEqual({ "expiryAlertDays.from": 30, "expiryAlertDays.to": 45 });
      for (const days of [0, 91, 2.5]) {
        expect(
          (await call("adminA", "put", "/signing-certificate/expiry-alert").send({ days })).status,
        ).toBe(400);
      }
    });
  });

  describe("permisos y aislamiento (design D10)", () => {
    it("el operador no carga, no consulta metadatos ni cambia la anticipación, pero ve la vigencia", async () => {
      expect((await upload("operatorA", "sd-utf8.modern.p12", null)).status).toBe(403);
      expect((await call("operatorA", "get", "/signing-certificate")).status).toBe(403);
      expect(
        (await call("operatorA", "put", "/signing-certificate/expiry-alert").send({ days: 10 }))
          .status,
      ).toBe(403);
      const validity = await call("operatorA", "get", "/signing-certificate/validity");
      expect(validity.status).toBe(200);
      expect(Object.keys(bodyOf(validity).data).sort()).toEqual([
        "daysToExpiry",
        "notAfter",
        "state",
        "usable",
      ]);
    });

    it("la empresa B no ve ni cambia la firma de la empresa A", async () => {
      const fromA = (await current())!;
      expect(
        bodyOf(await call("adminB", "get", "/signing-certificate")).data.certificate,
      ).toBeNull();
      expect((await upload("adminB", "sd-ia5.modern.p12", null)).status).toBe(200);
      expect((await current())!.id).toBe(fromA.id);
    });

    it("rechaza companyId en el cuerpo", async () => {
      const res = await call("adminA", "put", "/signing-certificate").send({
        file: file("sd-utf8.modern.p12"),
        password: FIXTURE_PASSWORD,
        expectedCurrentId: null,
        companyId: "otra",
      });
      expect(res.status).toBe(400);
    });
  });

  describe("preparación para emitir (design D12)", () => {
    it("el requisito de firma sigue a la firma utilizable", async () => {
      const status = async (app = api.app, who = "adminA") =>
        (
          bodyOf(await call(who, "get", "/company/status", app)).data as {
            readiness: { checks: { key: string; status: string }[] };
          }
        ).readiness.checks.find((check) => check.key === "SIGNING_CERTIFICATE")?.status;
      expect(await status()).toBe("MET");
      expect(await status(api.app, "operatorA")).toBe("MET");
      const notAfter = new Date(String((await current())!.notAfter));
      const after = buildTaxpayerApp(db, {
        signing: { pool, custody: custody(7), now: () => new Date(notAfter.getTime() + 1000) },
      });
      cookies.statusAfter = await sessionCookie(after.app, "admin@a.ec");
      expect(await status(after.app, "statusAfter")).toBe("PENDING");
      const otherKey = buildTaxpayerApp(db, { signing: { pool, custody: custody(9) } });
      cookies.statusKey = await sessionCookie(otherKey.app, "admin@a.ec");
      expect(await status(otherKey.app, "statusKey")).toBe("PENDING");
    });
  });
});

describe("recuperación de la custodia (repair-signing-certificate-reseal-after-master-key-change, design D9)", () => {
  // Dos apps sobre el mismo esquema: la clave 1 y la clave 2, como un reinicio con otra clave.
  const keyOne: CertificateCustodyConfig = {
    enabled: true,
    keyVersion: "1",
    key: Buffer.alloc(32, 21),
  };
  const keyTwo: CertificateCustodyConfig = {
    enabled: true,
    keyVersion: "2",
    key: Buffer.alloc(32, 22),
  };
  const pool = createCryptoWorkerPool({
    entry: certificateTasksEntry(),
    size: 2,
    timeoutMs: 30_000,
  });
  let db: MigratedSchema;
  let one: ReturnType<typeof buildTaxpayerApp>;
  let two: ReturnType<typeof buildTaxpayerApp>;
  let companyA: string;
  let companyB: string;
  let adminA: string;
  let certificateId: string;
  const cookies: Record<string, string> = {};
  const as = (who: string, app: ReturnType<typeof buildTaxpayerApp>) => ({
    get: async () =>
      bodyOf(await request(app.app).get("/api/v1/signing-certificate").set("Cookie", cookies[who]!))
        .data.certificate ?? null,
    upload: (name: string, expectedCurrentId: string | null, password = FIXTURE_PASSWORD) =>
      request(app.app)
        .put("/api/v1/signing-certificate")
        .set("Cookie", cookies[who]!)
        .send({ file: file(name), password, expectedCurrentId }),
  });
  const secret = async () => {
    const row = await db.database.prisma.signingCertificateSecret.findUniqueOrThrow({
      where: { certificateId },
    });
    return { keyVersion: row.keyVersion, bytes: Buffer.from(row.wrappedKey).toString("hex") };
  };
  const events = (companyId: string, action: string) =>
    db.database.prisma.auditEvent.findMany({
      where: { companyId, action },
      orderBy: { occurredAt: "asc" },
    });
  // Nada de lo que viaja o se audita puede contener la contraseña, las claves ni el P12.
  const needles = () => [
    FIXTURE_PASSWORD,
    keyOne.key.toString("base64"),
    keyTwo.key.toString("base64"),
    file("sd-utf8.modern.p12").slice(100, 164),
  ];
  const expectNoSecrets = (value: unknown) => {
    const text = JSON.stringify(value);
    for (const needle of needles()) expect(text).not.toContain(needle);
  };

  beforeAll(async () => {
    db = await createMigratedSchema("signing_reseal");
    one = buildTaxpayerApp(db, { signing: { pool, custody: keyOne } });
    two = buildTaxpayerApp(db, { signing: { pool, custody: keyTwo } });
    companyA = await insertCompany(db.database.prisma, "Empresa A");
    companyB = await insertCompany(db.database.prisma, "Empresa B");
    adminA = await createMember(one.uow, companyA, {
      name: "adminA",
      email: "admin@a.ec",
      role: "ADMIN",
    });
    await createMember(one.uow, companyA, {
      name: "operatorA",
      email: "operador@a.ec",
      role: "OPERATOR",
    });
    await createMember(one.uow, companyB, { name: "adminB", email: "admin@b.ec", role: "ADMIN" });
    for (const [name, app] of [
      ["one", one],
      ["two", two],
    ] as const) {
      cookies[`adminA.${name}`] = await sessionCookie(app.app, "admin@a.ec");
      cookies[`operatorA.${name}`] = await sessionCookie(app.app, "operador@a.ec");
      cookies[`adminB.${name}`] = await sessionCookie(app.app, "admin@b.ec");
    }
  });

  afterAll(async () => {
    await pool.close();
    await db.drop();
  });

  it("con la custodia utilizable, la misma firma no cambia nada", async () => {
    const admin = as("adminA.one", one);
    const first = await admin.upload("sd-utf8.modern.p12", null);
    expect(first.status).toBe(200);
    certificateId = String(bodyOf(first).data.certificate!.id);
    const before = await secret();
    expect(before.keyVersion).toBe("1");

    const again = await admin.upload("sd-utf8.modern.p12", certificateId);
    expect(again.status).toBe(200);
    expect(bodyOf(again).data).toMatchObject({
      unchanged: true,
      certificate: { id: certificateId, state: "VALID" },
    });
    expect(await secret()).toEqual(before);
    expect(await events(companyA, "signing_certificate.custody_restored")).toHaveLength(0);
  });

  it("con otra clave la firma no está disponible, y la misma carga restablece su custodia", async () => {
    const admin = as("adminA.two", two);
    expect(await admin.get()).toMatchObject({
      id: certificateId,
      state: "KEY_UNAVAILABLE",
      usable: false,
    });
    const before = await secret();
    const row = await db.database.prisma.signingCertificate.findUniqueOrThrow({
      where: { id: certificateId },
    });

    const res = await admin.upload("sd-utf8.modern.p12", certificateId);
    expect(res.status).toBe(200);
    expect(bodyOf(res).data).toMatchObject({
      unchanged: false,
      certificate: { id: certificateId, state: "VALID", usable: true, detectedRuc: FIXTURE_RUC },
    });
    expectNoSecrets(res.body);
    const after = await secret();
    expect(after.keyVersion).toBe("2");
    expect(after.bytes).not.toBe(before.bytes);
    // La misma firma: sus metadatos, fecha y autor de la carga no cambian, y no hay otra.
    expect(
      await db.database.prisma.signingCertificate.findUniqueOrThrow({
        where: { id: certificateId },
      }),
    ).toEqual(row);
    expect(
      await db.database.prisma.signingCertificate.count({ where: { companyId: companyA } }),
    ).toBe(1);

    const [event, ...more] = await events(companyA, "signing_certificate.custody_restored");
    expect(more).toHaveLength(0);
    expect(event).toMatchObject({ actorType: "USER", actorUserId: adminA });
    expect(event?.changes).toMatchObject({
      "certificate.fingerprint": row.fingerprintSha256,
      "certificate.detectedRuc": FIXTURE_RUC,
      "custody.keyVersion.from": "1",
      "custody.keyVersion.to": "2",
    });
    expectNoSecrets(event);
    expect(await events(companyA, "signing_certificate.replaced")).toHaveLength(0);
    expect(await events(companyA, "signing_certificate.loaded")).toHaveLength(1);
  });

  it("después de recuperarla, la misma carga no cambia nada", async () => {
    const before = await secret();
    const res = await as("adminA.two", two).upload("sd-utf8.modern.p12", certificateId);
    expect(res.status).toBe(200);
    expect(bodyOf(res).data).toMatchObject({ unchanged: true, certificate: { id: certificateId } });
    expect(await secret()).toEqual(before);
    expect(await events(companyA, "signing_certificate.custody_restored")).toHaveLength(1);
  });

  it("volver solo a la clave anterior deja la firma no disponible", async () => {
    // Desde aquí, para la app con la clave 1, la firma vuelve a estar no disponible.
    expect(await as("adminA.one", one).get()).toMatchObject({
      id: certificateId,
      state: "KEY_UNAVAILABLE",
    });
  });

  it("una recuperación rechazada no toca el secreto", async () => {
    const admin = as("adminA.one", one);
    const before = await secret();
    const rejected = async (res: { status: number; body: unknown }, code: string) => {
      expect(res.status, code).toBe(400);
      expect(bodyOf(res).error.code).toBe(code);
      expectNoSecrets(res.body);
      expect(await secret()).toEqual(before);
    };
    await rejected(
      await admin.upload("sd-utf8.modern.p12", certificateId, "contraseña-incorrecta"),
      "CERTIFICATE_PASSWORD_INVALID",
    );
    // El mismo certificado con otra clave privada: la huella coincide, la carga no es válida.
    await rejected(
      await admin.upload("mismatch.p12", certificateId),
      "CERTIFICATE_KEY_UNSUPPORTED",
    );
    await rejected(
      await admin.upload("corrupt-truncated.p12", certificateId),
      "CERTIFICATE_UNREADABLE",
    );
    const row = await db.database.prisma.signingCertificate.findUniqueOrThrow({
      where: { id: certificateId },
    });
    const late = buildTaxpayerApp(db, {
      signing: { pool, custody: keyOne, now: () => new Date(row.notAfter.getTime() + 1000) },
    });
    cookies["adminA.late"] = await sessionCookie(late.app, "admin@a.ec");
    await rejected(
      await as("adminA.late", late).upload("sd-utf8.modern.p12", certificateId),
      "CERTIFICATE_NOT_VALID_NOW",
    );
    expect(await admin.get()).toMatchObject({ id: certificateId, state: "KEY_UNAVAILABLE" });
    expect(await events(companyA, "signing_certificate.custody_restored")).toHaveLength(1);
  });

  it("una recuperación con una vista desactualizada es un conflicto y no cambia nada", async () => {
    const before = await secret();
    for (const expected of [null, randomUUID()]) {
      const res = await as("adminA.one", one).upload("sd-utf8.modern.p12", expected);
      expect(res.status).toBe(409);
      expect(bodyOf(res).error.code).toBe("CERTIFICATE_CHANGED");
    }
    expect(await secret()).toEqual(before);
    expect(await events(companyA, "signing_certificate.custody_restored")).toHaveLength(1);
  });

  it("dos recuperaciones simultáneas restablecen la custodia una sola vez", async () => {
    const admin = as("adminA.one", one);
    const [a, b] = await Promise.all([
      admin.upload("sd-utf8.modern.p12", certificateId),
      admin.upload("sd-utf8.modern.p12", certificateId),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect([bodyOf(a).data.unchanged, bodyOf(b).data.unchanged].sort()).toEqual([false, true]);
    expect((await secret()).keyVersion).toBe("1");
    expect(await events(companyA, "signing_certificate.custody_restored")).toHaveLength(2);
    expect(await admin.get()).toMatchObject({ id: certificateId, state: "VALID" });
  });

  it("el operador no recupera y la empresa B no toca la firma de A", async () => {
    // Con la clave 2, la firma de A (sellada con la 1) vuelve a estar no disponible.
    const before = await secret();
    const operator = await as("operatorA.two", two).upload("sd-utf8.modern.p12", certificateId);
    expect(operator.status).toBe(403);

    const fromB = await as("adminB.two", two).upload("sd-utf8.modern.p12", null);
    expect(fromB.status).toBe(200);
    expect(bodyOf(fromB).data).toMatchObject({ unchanged: false });
    expect(bodyOf(fromB).data.certificate!.id).not.toBe(certificateId);
    expect(await events(companyB, "signing_certificate.loaded")).toHaveLength(1);
    expect(await events(companyB, "signing_certificate.custody_restored")).toHaveLength(0);

    expect(await secret()).toEqual(before);
    expect(await as("adminA.two", two).get()).toMatchObject({
      id: certificateId,
      state: "KEY_UNAVAILABLE",
    });
    expect(await events(companyA, "signing_certificate.custody_restored")).toHaveLength(2);
  });

  it("una firma distinta con la custodia no disponible es un reemplazo", async () => {
    const res = await as("adminA.two", two).upload("other-ruc.modern.p12", certificateId);
    expect(res.status).toBe(200);
    const next = bodyOf(res).data.certificate!;
    expect(next.id).not.toBe(certificateId);
    expect(next).toMatchObject({ detectedRuc: FIXTURE_OTHER_RUC, state: "VALID" });
    expect(
      await db.database.prisma.signingCertificate.findUniqueOrThrow({
        where: { id: certificateId },
        include: { secret: true },
      }),
    ).toMatchObject({ status: "REPLACED", replacedById: next.id, secret: null });
    expect(await events(companyA, "signing_certificate.replaced")).toHaveLength(1);
    expect(await events(companyA, "signing_certificate.custody_restored")).toHaveLength(2);
  });
});
