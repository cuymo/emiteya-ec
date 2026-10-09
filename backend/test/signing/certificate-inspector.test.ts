// Inspección y firma de prueba en el pool criptográfico real (design D3 y D18).
import { afterAll, describe, expect, inject, it } from "vitest";
import {
  certificateTasksEntry,
  createCertificateInspector,
} from "../../src/modules/signing/infrastructure/certificate-inspector.ts";
import { MAX_PKCS12_ITERATIONS } from "../../src/modules/signing/infrastructure/pkcs12/pkcs12-reader.ts";
import {
  CryptoTimeoutError,
  createCryptoWorkerPool,
} from "../../src/platform/workers/crypto-worker-pool.ts";
import {
  FIXTURE_NONASCII_PASSWORD,
  FIXTURE_PASSWORD,
  FIXTURE_RUC,
  iterationCountsOf,
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
      reason: "PASSWORD_ENCODING",
    });
    expect(await inspect("ca-first.p12")).toEqual({
      ok: false,
      code: "CERTIFICATE_INCOMPATIBLE",
      reason: "CHAIN_ORDER",
    });
    expect(await inspect("sd-utf8.iter150000.p12")).toEqual({
      ok: false,
      code: "CERTIFICATE_INCOMPATIBLE",
      reason: "ITERATIONS",
    });
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

describe("techo de iteraciones en el pool (support-security-data-pkcs12-iteration-profile)", () => {
  it("la forma de Security Data y un contador igual al techo pasan la inspección y la firma de prueba", async () => {
    for (const file of ["sd-profile.p12", "iter-limit.p12"]) {
      const outcome = await inspect(file);
      expect(outcome.ok, file).toBe(true);
      expect(outcome.ok && outcome.certificate.detectedRuc).toBe(FIXTURE_RUC);
    }
  });

  it("por encima del techo o con un contador absurdo es ITERATIONS; con la contraseña incorrecta, su código", async () => {
    for (const file of ["iter-over-mac.p12", "iter-over-container.p12", "iter-absurd.p12"]) {
      expect(await inspect(file), file).toEqual({
        ok: false,
        code: "CERTIFICATE_INCOMPATIBLE",
        reason: "ITERATIONS",
      });
    }
    expect(await inspect("sd-profile.p12", "incorrecta")).toEqual({
      ok: false,
      code: "CERTIFICATE_PASSWORD_INVALID",
    });
  });

  it("el timeout del pool corta una importación demasiado larga sin bloquear el event loop", async () => {
    // Contadores dentro del techo, pero con los contenidos cifrados repetidos hasta el tamaño
    // máximo de subida: el techo no lo detiene, el timeout sí.
    const bytes = readFixture(dir, "many-containers.p12");
    const counts = iterationCountsOf(bytes);
    expect(Math.max(...counts)).toBeLessThanOrEqual(MAX_PKCS12_ITERATIONS);
    expect(counts.length).toBeGreaterThan(20);
    const slowPool = createCryptoWorkerPool({
      entry: certificateTasksEntry(),
      size: 1,
      timeoutMs: 300,
    });
    let ticks = 0;
    const ticker = setInterval(() => ticks++, 10);
    try {
      await expect(
        createCertificateInspector(slowPool).inspect(bytes, FIXTURE_PASSWORD),
      ).rejects.toBeInstanceOf(CryptoTimeoutError);
      expect(ticks).toBeGreaterThanOrEqual(5);
    } finally {
      clearInterval(ticker);
      await slowPool.close();
    }
  });
});
