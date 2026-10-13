// Ensayo C1 de la sustitución de la clave maestra (repair-signing-certificate-reseal-after-master-
// key-change, design D8 y D9) contra el backend real: main.ts arranca con una clave sintética, se
// carga un P12 sintético, el proceso se reinicia con otra clave sobre el mismo esquema y el
// administrador restablece la custodia volviendo a cargar el mismo P12. Sin comprobantes, sin firmar
// comprobantes y con la transmisión al SRI apagada.
import { createPrivateKey, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SigningCertificateResponse } from "@facturador/contracts";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { FIXTURE_PASSWORD, FIXTURE_RUC, readFixture } from "../support/p12-fixtures.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { startE2eBackend, type E2eBackend } from "./e2e-backend.ts";

const ADMIN = { email: "admin@e2e-clave.ec", password: "contrasena-admin-e2e-1" };
const P12 = "sd-utf8.modern.p12";
const UNOPENABLE = "la firma vigente no se puede abrir con la clave de custodia configurada";
const dir = inject("p12FixturesDir");
// Claves de un solo uso: la antigua (versión 1) y la nueva (versión 2).
const OLD_KEY = randomBytes(32);
const NEW_KEY = randomBytes(32);

type Certificate = NonNullable<SigningCertificateResponse["certificate"]>;
type Upload = { certificate: Certificate; unchanged: boolean };

describe("ensayo C1: sustitución de la clave maestra con el backend real", () => {
  let db: MigratedSchema;
  let backend: E2eBackend | undefined;
  let cookie = "";
  const outputs: string[] = [];

  beforeAll(async () => {
    db = await createMigratedSchema("end_to_end_master_key");
  }, 120_000);

  afterAll(async () => {
    await backend?.stop();
    await db?.drop();
  });

  /** Detiene el proceso en marcha con SIGTERM y arranca otro con la clave indicada. */
  async function restart(key: Buffer, version: string) {
    if (backend) {
      await backend.stop();
      outputs.push(backend.output());
    }
    backend = await startE2eBackend({
      label: "end_to_end_master_key",
      admin: ADMIN,
      db,
      env: {
        CERTIFICATE_CUSTODY: "enabled",
        CERTIFICATE_MASTER_KEY: key.toString("base64"),
        CERTIFICATE_MASTER_KEY_VERSION: version,
        SRI_TRANSMISSION_ENABLED: "0",
      },
    });
    const signIn = await backend.signIn(ADMIN.email, ADMIN.password);
    expect(signIn.status).toBe(200);
    cookie = signIn.cookie;
  }

  async function api<T>(method: string, path: string, body?: unknown) {
    const res = await backend!.fetchApi(method, path, cookie, body);
    const json = (await res.json()) as { data: T; error?: { code: string } };
    return { status: res.status, data: json.data, error: json.error };
  }

  const current = async () =>
    (await api<SigningCertificateResponse>("GET", "/signing-certificate")).data.certificate;
  const upload = (expectedCurrentId: string | null) =>
    api<Upload>("PUT", "/signing-certificate", {
      file: readFixture(dir, P12).toString("base64"),
      password: FIXTURE_PASSWORD,
      expectedCurrentId,
    });
  const secretVersion = async (certificateId: string) =>
    (
      await db.database.prisma.signingCertificateSecret.findUniqueOrThrow({
        where: { certificateId },
      })
    ).keyVersion;
  /** El aviso del arranque se registra después de quedar listo: se espera hasta 10 s. */
  async function startupLog() {
    const deadline = Date.now() + 10_000;
    while (!backend!.output().includes(UNOPENABLE) && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 100));
    return backend!.output();
  }

  it("restablece la custodia con la clave nueva volviendo a cargar el mismo P12", async () => {
    // 1. Clave antigua: la carga deja la firma utilizable, custodiada con la versión 1.
    await restart(OLD_KEY, "1");
    const loaded = await upload(null);
    expect(loaded.status).toBe(200);
    expect(loaded.data).toMatchObject({
      unchanged: false,
      certificate: { state: "VALID", usable: true, detectedRuc: FIXTURE_RUC },
    });
    const id = loaded.data.certificate.id;
    expect(await secretVersion(id)).toBe("1");

    // 2. Reinicio con la clave nueva: la firma no está disponible, y el arranque lo registra.
    await restart(NEW_KEY, "2");
    expect(await current()).toMatchObject({ id, state: "KEY_UNAVAILABLE", usable: false });
    expect(await startupLog()).toContain(UNOPENABLE);

    // 3. El administrador vuelve a cargar el mismo P12: la misma firma, custodiada con la versión 2.
    const restored = await upload(id);
    expect(restored.status).toBe(200);
    expect(restored.data).toMatchObject({
      unchanged: false,
      certificate: { id, state: "VALID", usable: true },
    });
    expect(await current()).toMatchObject({ id, state: "VALID" });
    expect(await secretVersion(id)).toBe("2");
    const events = await db.database.prisma.auditEvent.findMany({
      where: { action: { startsWith: "signing_certificate." } },
      orderBy: { occurredAt: "asc" },
    });
    expect(events.map((event) => event.action)).toEqual([
      "signing_certificate.loaded",
      "signing_certificate.custody_restored",
    ]);
    expect(events[1]?.changes).toMatchObject({
      "custody.keyVersion.from": "1",
      "custody.keyVersion.to": "2",
    });

    // 4. Otra carga del mismo P12 ya no cambia nada.
    const again = await upload(id);
    expect(again.status).toBe(200);
    expect(again.data).toMatchObject({ unchanged: true, certificate: { id } });
    expect(await secretVersion(id)).toBe("2");

    // 5. Volver solo a la clave antigua no sirve de vuelta atrás: la firma vuelve a no estar
    //    disponible. La vuelta atrás es el respaldo previo junto con la clave antigua (design D8).
    await restart(OLD_KEY, "1");
    expect(await current()).toMatchObject({ id, state: "KEY_UNAVAILABLE" });

    // 6. Con la clave nueva, la custodia restablecida sigue utilizable tras otro reinicio.
    await restart(NEW_KEY, "2");
    expect(await current()).toMatchObject({ id, state: "VALID", usable: true });
    expect(await db.database.prisma.signingCertificate.count()).toBe(1);

    // 7. Nada fiscal: ningún comprobante ni intento de envío al SRI.
    expect(await db.database.prisma.electronicDocument.count()).toBe(0);
    expect(await db.database.prisma.sriAttempt.count()).toBe(0);

    // 8. Sin secretos: ni la salida de los procesos ni las tablas contienen la contraseña, las
    //    claves maestras, el P12 ni la clave privada. bytea aparece en hexadecimal.
    await backend!.stop();
    outputs.push(backend!.output());
    backend = undefined;
    const p12 = readFixture(dir, P12);
    const middle = (bytes: Buffer) =>
      bytes.subarray(Math.floor(bytes.length / 2), Math.floor(bytes.length / 2) + 32);
    const privateKey = createPrivateKey(readFileSync(join(dir, "sd-utf8.key"))).export({
      type: "pkcs8",
      format: "der",
    });
    const needles: Record<string, string[]> = {
      password: [FIXTURE_PASSWORD],
      oldKey: [OLD_KEY.toString("base64"), OLD_KEY.toString("hex")],
      newKey: [NEW_KEY.toString("base64"), NEW_KEY.toString("hex")],
      p12: [middle(p12).toString("hex"), p12.toString("base64").slice(100, 164)],
      privateKey: [middle(privateKey).toString("hex"), middle(privateKey).toString("base64")],
    };
    const output = outputs.join("\n");
    for (const [label, values] of Object.entries(needles))
      for (const value of values) expect(output.includes(value), `salida con ${label}`).toBe(false);
    const tables = await db.database.prisma.$queryRawUnsafe<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = '${db.name}' AND table_type = 'BASE TABLE'`,
    );
    expect(tables.map((table) => table.table_name)).toContain("signing_certificate_secret");
    for (const { table_name } of tables) {
      const rows = await db.database.prisma.$queryRawUnsafe<{ row: string }[]>(
        `SELECT row_to_json(t)::text AS row FROM "${db.name}"."${table_name}" t`,
      );
      const text = rows.map((row) => row.row).join("\n");
      for (const [label, values] of Object.entries(needles))
        for (const value of values)
          expect(text.includes(value), `${table_name} contiene ${label}`).toBe(false);
    }
  }, 300_000);
});
