// Prueba end-to-end de add-signing-certificate (tarea 7.1) contra el backend real: arranca main.ts
// como proceso con la custodia habilitada sobre un esquema vacío y recorre por HTTP la carga, el
// reemplazo y la consulta con los PKCS#12 sintéticos (design D16).
import { createPrivateKey, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CompanyStatus, SigningCertificateResponse } from "@facturador/contracts";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import {
  FIXTURE_OTHER_RUC,
  FIXTURE_PASSWORD,
  FIXTURE_RUC,
  readFixture,
} from "../support/p12-fixtures.ts";
import { startE2eBackend, type E2eBackend } from "./e2e-backend.ts";

const ADMIN = { email: "admin@e2e-firma.ec", password: "contrasena-admin-e2e-1" };
const OPERATOR = { email: "operador@e2e-firma.ec", password: "contrasena-operador-e2e-1" };
const dir = inject("p12FixturesDir");

describe("flujo completo de la firma electrónica", () => {
  let backend: E2eBackend;

  beforeAll(async () => {
    backend = await startE2eBackend({
      label: "end_to_end_signing",
      admin: ADMIN,
      // Clave de un solo uso: la custodia habilitada como en producción.
      env: {
        CERTIFICATE_CUSTODY: "enabled",
        CERTIFICATE_MASTER_KEY: randomBytes(32).toString("base64"),
      },
    });
  }, 120_000);

  afterAll(async () => {
    await backend?.stop();
  });

  async function signIn(email: string, password: string) {
    const { status, cookie } = await backend.signIn(email, password);
    expect(status).toBe(200);
    return cookie;
  }

  async function api<T>(method: string, path: string, cookie: string, body?: unknown) {
    const res = await backend.fetchApi(method, path, cookie, body);
    const json = (await res.json()) as { data: T; error?: { code: string; message: string } };
    return { status: res.status, data: json.data, error: json.error };
  }

  const file = (name: string) => readFixture(dir, name).toString("base64");

  it("prepara la empresa, advierte el RUC distinto, rechaza sin RUC y custodia sin secretos", async () => {
    const admin = await signIn(ADMIN.email, ADMIN.password);
    expect(
      (
        await api("PUT", "/taxpayer", admin, {
          ruc: FIXTURE_RUC,
          legalName: "Comercial Andina S.A.",
          headOfficeAddress: "Av. Amazonas N24-03, Quito",
          accountingRequired: true,
          expectedVersion: null,
        })
      ).status,
    ).toBe(200);
    const establishment = await api<{ id: string }>("POST", "/establishments", admin, {
      code: "001",
      address: "Av. Amazonas N24-03, Quito",
    });
    expect(
      (
        await api("POST", `/establishments/${establishment.data.id}/emission-points`, admin, {
          code: "001",
        })
      ).status,
    ).toBe(201);
    const readiness = async () =>
      (await api<CompanyStatus>("GET", "/company/status", admin)).data.readiness;
    const current = async () =>
      (await api<SigningCertificateResponse>("GET", "/signing-certificate", admin)).data
        .certificate;

    // 1. La empresa configurada sin firma no está preparada: solo falta la firma.
    expect(await readiness()).toEqual({
      ready: false,
      checks: [
        { key: "TAXPAYER_DATA", status: "MET" },
        { key: "EMISSION_POINT", status: "MET" },
        { key: "SIGNING_CERTIFICATE", status: "PENDING" },
      ],
    });

    // 2. Una firma con RUC distinto deja la empresa preparada, con la advertencia.
    const loaded = await api<{ certificate: { id: string } }>(
      "PUT",
      "/signing-certificate",
      admin,
      {
        file: file("other-ruc.modern.p12"),
        password: FIXTURE_PASSWORD,
        expectedCurrentId: null,
      },
    );
    expect(loaded.status).toBe(200);
    expect((await readiness()).ready).toBe(true);
    expect(await current()).toMatchObject({
      id: loaded.data.certificate.id,
      detectedRuc: FIXTURE_OTHER_RUC,
      companyRuc: FIXTURE_RUC,
      rucMatch: "MISMATCH",
      state: "VALID",
      usable: true,
    });

    // 3. El reemplazo por una con el RUC de la empresa quita la advertencia.
    const replaced = await api<{ certificate: { id: string }; unchanged: boolean }>(
      "PUT",
      "/signing-certificate",
      admin,
      {
        file: file("sd-utf8.modern.p12"),
        password: FIXTURE_PASSWORD,
        expectedCurrentId: loaded.data.certificate.id,
      },
    );
    expect(replaced).toMatchObject({ status: 200, data: { unchanged: false } });
    expect(await current()).toMatchObject({
      id: replaced.data.certificate.id,
      detectedRuc: FIXTURE_RUC,
      rucMatch: "MATCH",
    });

    // 4. Una firma sin RUC se rechaza y la vigente no cambia.
    const rejected = await api("PUT", "/signing-certificate", admin, {
      file: file("noruc.modern.p12"),
      password: FIXTURE_PASSWORD,
      expectedCurrentId: replaced.data.certificate.id,
    });
    expect(rejected).toMatchObject({ status: 400, error: { code: "CERTIFICATE_RUC_NOT_FOUND" } });
    expect((await current())?.id).toBe(replaced.data.certificate.id);
    expect((await readiness()).ready).toBe(true);

    // 5. El operador ve solo la vigencia.
    expect(
      (
        await api("POST", "/users", admin, {
          name: "Olga Operadora",
          email: OPERATOR.email,
          password: OPERATOR.password,
          role: "OPERATOR",
        })
      ).status,
    ).toBe(201);
    const operator = await signIn(OPERATOR.email, OPERATOR.password);
    expect((await api("GET", "/signing-certificate", operator)).status).toBe(403);
    expect(
      (
        await api("PUT", "/signing-certificate", operator, {
          file: file("sd-utf8.modern.p12"),
          password: FIXTURE_PASSWORD,
          expectedCurrentId: null,
        })
      ).status,
    ).toBe(403);
    const validity = await api<Record<string, unknown>>(
      "GET",
      "/signing-certificate/validity",
      operator,
    );
    expect(validity.status).toBe(200);
    expect(Object.keys(validity.data).sort()).toEqual([
      "daysToExpiry",
      "notAfter",
      "state",
      "usable",
    ]);
    expect(validity.data).toMatchObject({ state: "VALID", usable: true });

    // 6. La auditoría tiene la carga y el reemplazo, sin secretos; el rechazo no se audita.
    const events = await backend.db.database.prisma.auditEvent.findMany({
      where: { action: { startsWith: "signing_certificate." } },
      orderBy: { occurredAt: "asc" },
    });
    expect(events.map((event) => event.action)).toEqual([
      "signing_certificate.loaded",
      "signing_certificate.replaced",
    ]);
    expect(events.every((event) => event.actorType === "USER")).toBe(true);

    // 7. Ninguna tabla contiene el P12, su contraseña ni la clave privada en claro. Se busca en
    //    el texto de cada fila (bytea aparece en hexadecimal) un tramo de cada valor.
    const secrets: Record<string, string[]> = { password: [FIXTURE_PASSWORD] };
    for (const name of ["other-ruc.modern.p12", "sd-utf8.modern.p12", "noruc.modern.p12"]) {
      const bytes = readFixture(dir, name);
      const middle = bytes.subarray(
        Math.floor(bytes.length / 2),
        Math.floor(bytes.length / 2) + 32,
      );
      secrets[name] = [middle.toString("hex"), bytes.toString("base64").slice(100, 164)];
    }
    for (const holder of ["other-ruc", "sd-utf8"]) {
      const der = createPrivateKey(readFileSync(join(dir, `${holder}.key`))).export({
        type: "pkcs8",
        format: "der",
      });
      const middle = der.subarray(Math.floor(der.length / 2), Math.floor(der.length / 2) + 32);
      secrets[`${holder}.key`] = [middle.toString("hex"), middle.toString("base64")];
    }
    const tables = await backend.db.database.prisma.$queryRawUnsafe<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = '${backend.db.name}' AND table_type = 'BASE TABLE'`,
    );
    expect(tables.map((t) => t.table_name)).toContain("signing_certificate_secret");
    for (const { table_name } of tables) {
      const rows = await backend.db.database.prisma.$queryRawUnsafe<{ row: string }[]>(
        `SELECT row_to_json(t)::text AS row FROM "${backend.db.name}"."${table_name}" t`,
      );
      const text = rows.map((r) => r.row).join("\n");
      for (const [label, needles] of Object.entries(secrets)) {
        for (const needle of needles) {
          expect(text.includes(needle), `${table_name} contiene ${label}`).toBe(false);
        }
      }
    }
    expect(backend.output()).not.toContain(FIXTURE_PASSWORD);

    // La firma reemplazada conserva sus metadatos, pero su secreto se destruyó.
    expect(await backend.db.database.prisma.signingCertificate.count()).toBe(2);
    expect(await backend.db.database.prisma.signingCertificateSecret.count()).toBe(1);
  });
});
