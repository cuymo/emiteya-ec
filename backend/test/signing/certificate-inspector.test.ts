// Inspección y firma de prueba en el pool criptográfico real (design D3 y D18).
import { afterAll, describe, expect, inject, it } from "vitest";
import {
  certificateTasksEntry,
  createCertificateInspector,
} from "../../src/modules/signing/infrastructure/certificate-inspector.ts";
import { createCryptoWorkerPool } from "../../src/platform/workers/crypto-worker-pool.ts";
import {
  FIXTURE_NONASCII_PASSWORD,
  FIXTURE_PASSWORD,
  FIXTURE_RUC,
  readFixture,
} from "../support/p12-fixtures.ts";

const dir = inject("p12FixturesDir");
const pool = createCryptoWorkerPool({ entry: certificateTasksEntry(), size: 2, timeoutMs: 30_000 });
const inspector = createCertificateInspector(pool);
const inspect = (file: string, password = FIXTURE_PASSWORD) =>
  inspector.inspect(readFixture(dir, file), password);

afterAll(async () => {
  await pool.close();
});

describe("inspect-and-test-sign en el pool", () => {
  it("un P12 compatible pasa la inspección y la firma de prueba", async () => {
    for (const [file, password] of [
      ["sd-utf8.modern.p12", FIXTURE_PASSWORD],
      ["sd-utf8.legacy.p12", FIXTURE_PASSWORD],
      ["sd-utf8.legacy.nonascii.p12", FIXTURE_NONASCII_PASSWORD],
    ] as const) {
      const outcome = await inspect(file, password);
      expect(outcome.ok, file).toBe(true);
      expect(outcome.ok && outcome.certificate.detectedRuc).toBe(FIXTURE_RUC);
    }
  });

  it("devuelve el código de cada rechazo, nunca un mensaje", async () => {
    expect(await inspect("sd-utf8.modern.p12", "incorrecta")).toEqual({
      ok: false,
      code: "CERTIFICATE_PASSWORD_INVALID",
    });
    expect(await inspect("sd-utf8.modern.nonascii.p12", FIXTURE_NONASCII_PASSWORD)).toEqual({
      ok: false,
      code: "CERTIFICATE_INCOMPATIBLE",
    });
    expect(await inspect("ca-first.p12")).toEqual({ ok: false, code: "CERTIFICATE_INCOMPATIBLE" });
    expect(await inspect("mismatch.p12")).toEqual({
      ok: false,
      code: "CERTIFICATE_KEY_UNSUPPORTED",
    });
    expect(await inspect("corrupt-truncated.p12")).toEqual({
      ok: false,
      code: "CERTIFICATE_UNREADABLE",
    });
  });

  it("el original sigue intacto en el hilo principal: se transfiere una copia", async () => {
    const bytes = readFixture(dir, "sd-utf8.modern.p12");
    const before = Buffer.from(bytes);
    await inspector.inspect(bytes, FIXTURE_PASSWORD);
    expect(bytes.equals(before)).toBe(true);
  });
});
