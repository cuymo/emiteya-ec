import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  EXAMPLE_AUTH_SECRET,
  EXAMPLE_CERTIFICATE_MASTER_KEY,
  EnvError,
  loadCertificateCustody,
  loadEnv,
  loadInitialAdmin,
  SRI_ENDPOINT_VARIABLES,
  sriTransportBudgetMs,
} from "../src/config/env.ts";

const backendRoot = fileURLToPath(new URL("..", import.meta.url));
const SECRET = "valor-secreto-que-no-debe-aparecer";
const valid = {
  DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/db",
  BETTER_AUTH_SECRET: "secreto-de-pruebas-0123456789abcdef0123",
  BETTER_AUTH_URL: "http://localhost:3000",
};

function envError(source: Record<string, string>): EnvError | undefined {
  try {
    loadEnv(source);
  } catch (error) {
    return error as EnvError;
  }
  return undefined;
}

function startupWith(env: Record<string, string>) {
  return spawnSync(process.execPath, ["--conditions=development", "src/main.ts"], {
    cwd: backendRoot,
    env: { PATH: process.env.PATH, ...env },
    encoding: "utf8",
    timeout: 90_000,
  });
}

describe("configuración por entorno", () => {
  it("aplica los valores por defecto", () => {
    expect(loadEnv(valid)).toMatchObject({
      NODE_ENV: "development",
      PORT: 4000,
      LOG_LEVEL: "info",
      TRUST_PROXY: false,
    });
  });

  it("exige DATABASE_URL, BETTER_AUTH_SECRET y BETTER_AUTH_URL", () => {
    expect(() => loadEnv({})).toThrow(EnvError);
    expect(envError({})?.variables).toEqual([
      "DATABASE_URL",
      "BETTER_AUTH_SECRET",
      "BETTER_AUTH_URL",
    ]);
    expect(() => loadEnv({})).toThrow(/BETTER_AUTH_SECRET: es obligatoria/);
  });

  it("aplica los defaults de contraseñas y límites de docs/security/hardening.md", () => {
    expect(loadEnv(valid)).toMatchObject({
      PASSWORD_MIN_LENGTH: 12,
      PASSWORD_MAX_LENGTH: 128,
      LOGIN_MAX_FAILURES: 5,
      LOGIN_FAILURE_WINDOW_MINUTES: 15,
      LOGIN_IP_MAX_REQUESTS: 30,
      LOGIN_IP_WINDOW_SECONDS: 60,
    });
  });

  it("rechaza un secreto corto, una URL inválida y un máximo de contraseña menor que el mínimo", () => {
    const error = envError({
      ...valid,
      BETTER_AUTH_SECRET: "corto",
      BETTER_AUTH_URL: "ftp://x",
      PASSWORD_MIN_LENGTH: "20",
      PASSWORD_MAX_LENGTH: "16",
    });
    expect(error?.variables).toEqual([
      "BETTER_AUTH_SECRET",
      "BETTER_AUTH_URL",
      "PASSWORD_MAX_LENGTH",
    ]);
    expect(error?.message).not.toContain("corto");
  });

  it("aplica el tamaño máximo del logo por defecto y rechaza uno fuera de rango sin mostrarlo", () => {
    expect(loadEnv(valid).LOGO_MAX_BYTES).toBe(512 * 1024);
    expect(loadEnv({ ...valid, LOGO_MAX_BYTES: "16384" }).LOGO_MAX_BYTES).toBe(16384);
    for (const value of ["16383", "2097153", "mucho"]) {
      const error = envError({ ...valid, LOGO_MAX_BYTES: value });
      expect(error?.variables, value).toEqual(["LOGO_MAX_BYTES"]);
      expect(error?.message).toContain("LOGO_MAX_BYTES: valor inválido");
      expect(error?.message).not.toContain(value);
    }
  });

  it("rechaza el secreto de ejemplo en producción, sin mostrarlo", () => {
    expect(loadEnv({ ...valid, BETTER_AUTH_SECRET: EXAMPLE_AUTH_SECRET }).NODE_ENV).toBe(
      "development",
    );
    const error = envError({
      ...valid,
      NODE_ENV: "production",
      BETTER_AUTH_SECRET: EXAMPLE_AUTH_SECRET,
    });
    expect(error?.variables).toEqual(["BETTER_AUTH_SECRET"]);
    expect(error?.message).not.toContain(EXAMPLE_AUTH_SECRET);
  });

  it("rechaza un PORT inválido y TRUST_PROXY=true sin mostrar los valores", () => {
    const error = (() => {
      try {
        loadEnv({ ...valid, PORT: SECRET, TRUST_PROXY: "true" });
      } catch (e) {
        return e as EnvError;
      }
    })();
    expect(error?.variables).toEqual(["PORT", "TRUST_PROXY"]);
    expect(error?.message).not.toContain(SECRET);
  });

  it("el administrador inicial se valida con la política configurada, sin mostrar valores", () => {
    const env = loadEnv({ ...valid, PASSWORD_MIN_LENGTH: "16" });
    expect(() => loadInitialAdmin(env)).toThrow(
      /INITIAL_USER_EMAIL: es obligatoria mientras la instalación no tiene empresa/,
    );
    const short = "a".repeat(15);
    const error = (() => {
      try {
        loadInitialAdmin({
          ...env,
          INITIAL_USER_EMAIL: "admin@example.com",
          INITIAL_USER_PASSWORD: short,
        });
      } catch (e) {
        return e as EnvError;
      }
    })();
    expect(error?.variables).toEqual(["INITIAL_USER_PASSWORD"]);
    expect(error?.message).toContain("entre 16 y 128 caracteres");
    expect(error?.message).not.toContain(short);
    expect(
      loadInitialAdmin({
        ...env,
        INITIAL_USER_EMAIL: "admin@example.com",
        INITIAL_USER_PASSWORD: "a".repeat(16),
      }),
    ).toEqual({ email: "admin@example.com", password: "a".repeat(16) });
  });

  it("el arranque termina con el nombre de la variable y sin su valor", () => {
    const missing = startupWith({});
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("DATABASE_URL: es obligatoria");

    const invalidPort = startupWith({ ...valid, PORT: SECRET });
    expect(invalidPort.status).toBe(1);
    expect(invalidPort.stderr).toContain("PORT: valor inválido");
    expect(invalidPort.stderr).not.toContain(SECRET);
  });
});

describe("custodia de la firma electrónica (design D6)", () => {
  const KEY = Buffer.alloc(32, 9).toString("base64");
  const custody = (extra: Record<string, string>, readFile?: (path: string) => string) =>
    loadCertificateCustody(loadEnv({ ...valid, ...extra }), readFile);
  const custodyError = (extra: Record<string, string>, readFile?: (path: string) => string) => {
    try {
      custody(extra, readFile);
    } catch (error) {
      return error as EnvError;
    }
    return undefined;
  };

  it("aplica los valores por defecto del límite del P12 y del pool criptográfico", () => {
    expect(loadEnv(valid)).toMatchObject({
      CERTIFICATE_CUSTODY: "enabled",
      CERTIFICATE_MASTER_KEY_VERSION: "1",
      CERTIFICATE_MAX_BYTES: 65536,
      CRYPTO_WORKERS: 2,
      CRYPTO_TASK_TIMEOUT_MS: 30000,
    });
    expect(envError({ ...valid, CERTIFICATE_MAX_BYTES: "1048577" })?.variables).toEqual([
      "CERTIFICATE_MAX_BYTES",
    ]);
  });

  it("lee la clave en línea o desde un archivo, con su versión", () => {
    const inline = custody({
      CERTIFICATE_MASTER_KEY: KEY,
      CERTIFICATE_MASTER_KEY_VERSION: "2026-10",
    });
    expect(inline).toMatchObject({ enabled: true, keyVersion: "2026-10" });
    expect(inline.enabled && inline.key.length).toBe(32);
    const fromFile = custody(
      { CERTIFICATE_MASTER_KEY_FILE: "/run/secrets/clave" },
      () => `${KEY}\n`,
    );
    expect(fromFile.enabled && fromFile.key.equals(Buffer.alloc(32, 9))).toBe(true);
  });

  it("deshabilitada solo de forma expresa y nunca en producción", () => {
    expect(custody({ CERTIFICATE_CUSTODY: "disabled" })).toEqual({ enabled: false });
    const error = envError({ ...valid, NODE_ENV: "production", CERTIFICATE_CUSTODY: "disabled" });
    expect(error?.variables).toEqual(["CERTIFICATE_CUSTODY"]);
  });

  it("rechaza la ausencia de clave, las dos variantes, una clave inválida y un archivo ilegible, sin valores", () => {
    expect(custodyError({})?.message).toContain("CERTIFICATE_MASTER_KEY: es obligatoria");
    expect(
      custodyError({ CERTIFICATE_MASTER_KEY: KEY, CERTIFICATE_MASTER_KEY_FILE: "/ruta/secreta" })
        ?.message,
    ).toContain("usa solo una");
    for (const invalid of [SECRET, Buffer.alloc(16).toString("base64"), `${KEY}x`]) {
      const error = custodyError({ CERTIFICATE_MASTER_KEY: invalid });
      expect(error?.message).toContain("CERTIFICATE_MASTER_KEY: debe contener 32 bytes en base64");
      expect(error?.message).not.toContain(invalid);
    }
    const unreadable = custodyError(
      { CERTIFICATE_MASTER_KEY_FILE: "/ruta/secreta-que-no-existe" },
      () => {
        throw new Error("ENOENT /ruta/secreta-que-no-existe");
      },
    );
    expect(unreadable?.message).toContain(
      "CERTIFICATE_MASTER_KEY_FILE: no se puede leer el archivo",
    );
    expect(unreadable?.message).not.toContain("/ruta/secreta");
  });

  it("rechaza la clave de ejemplo en producción y la admite en desarrollo", () => {
    expect(custody({ CERTIFICATE_MASTER_KEY: EXAMPLE_CERTIFICATE_MASTER_KEY }).enabled).toBe(true);
    const error = custodyError({
      NODE_ENV: "production",
      CERTIFICATE_MASTER_KEY: EXAMPLE_CERTIFICATE_MASTER_KEY,
    });
    expect(error?.message).toContain("CERTIFICATE_MASTER_KEY: es la de ejemplo");
    expect(error?.message).not.toContain(EXAMPLE_CERTIFICATE_MASTER_KEY);
  });

  it("la API no arranca en producción sin clave de custodia", () => {
    const result = startupWith({ ...valid, NODE_ENV: "production" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("CERTIFICATE_MASTER_KEY: es obligatoria");
  });
});

describe("emisión de facturas (add-invoice-emission, design D2 y D11)", () => {
  it("aplica los valores por defecto de la validación XSD y del límite de líneas", () => {
    const env = loadEnv(valid);
    expect(env).toMatchObject({
      XSD_VALIDATION_CONCURRENCY: 2,
      XSD_VALIDATION_QUEUE: 16,
      XSD_VALIDATION_TIMEOUT_MS: 10000,
      INVOICE_MAX_LINES: 100,
    });
    expect(env.XSD_DIRECTORY).toBeUndefined();
  });

  it("rechaza valores fuera de rango sin mostrarlos", () => {
    const error = envError({
      ...valid,
      XSD_VALIDATION_CONCURRENCY: "9",
      XSD_VALIDATION_QUEUE: "257",
      XSD_VALIDATION_TIMEOUT_MS: "999",
      INVOICE_MAX_LINES: "1001",
      XSD_DIRECTORY: "",
    });
    expect(error?.variables).toEqual([
      "XSD_DIRECTORY",
      "XSD_VALIDATION_CONCURRENCY",
      "XSD_VALIDATION_QUEUE",
      "XSD_VALIDATION_TIMEOUT_MS",
      "INVOICE_MAX_LINES",
    ]);
    expect(error?.message).not.toContain("1001");
    expect(loadEnv({ ...valid, INVOICE_MAX_LINES: "1", XSD_VALIDATION_QUEUE: "0" })).toMatchObject({
      INVOICE_MAX_LINES: 1,
      XSD_VALIDATION_QUEUE: 0,
    });
  });

  it("los límites de la guía tienen sus valores por defecto, se configuran y se acotan (add-shipping-guides, D23)", () => {
    expect(loadEnv(valid)).toMatchObject({
      SHIPPING_GUIDE_MAX_RECIPIENTS: 10,
      SHIPPING_GUIDE_MAX_DETAILS_PER_RECIPIENT: 50,
      SHIPPING_GUIDE_MAX_DETAILS: 100,
    });
    expect(
      loadEnv({
        ...valid,
        SHIPPING_GUIDE_MAX_RECIPIENTS: "50",
        SHIPPING_GUIDE_MAX_DETAILS_PER_RECIPIENT: "100",
        SHIPPING_GUIDE_MAX_DETAILS: "300",
      }),
    ).toMatchObject({
      SHIPPING_GUIDE_MAX_RECIPIENTS: 50,
      SHIPPING_GUIDE_MAX_DETAILS_PER_RECIPIENT: 100,
      SHIPPING_GUIDE_MAX_DETAILS: 300,
    });
    const error = envError({
      ...valid,
      SHIPPING_GUIDE_MAX_RECIPIENTS: "51",
      SHIPPING_GUIDE_MAX_DETAILS_PER_RECIPIENT: "0",
      SHIPPING_GUIDE_MAX_DETAILS: "301",
    });
    expect(error?.variables).toEqual([
      "SHIPPING_GUIDE_MAX_RECIPIENTS",
      "SHIPPING_GUIDE_MAX_DETAILS_PER_RECIPIENT",
      "SHIPPING_GUIDE_MAX_DETAILS",
    ]);
    expect(error?.message).not.toContain("301");
  });

  it("los límites de la liquidación tienen sus valores por defecto, se configuran y se acotan (add-purchase-settlements, D22)", () => {
    expect(loadEnv(valid)).toMatchObject({
      PURCHASE_SETTLEMENT_MAX_LINES: 100,
      PURCHASE_SETTLEMENT_MAX_PAYMENTS: 10,
    });
    expect(
      loadEnv({
        ...valid,
        PURCHASE_SETTLEMENT_MAX_LINES: "1000",
        PURCHASE_SETTLEMENT_MAX_PAYMENTS: "20",
      }),
    ).toMatchObject({ PURCHASE_SETTLEMENT_MAX_LINES: 1000, PURCHASE_SETTLEMENT_MAX_PAYMENTS: 20 });
    const error = envError({
      ...valid,
      PURCHASE_SETTLEMENT_MAX_LINES: "1001",
      PURCHASE_SETTLEMENT_MAX_PAYMENTS: "0",
    });
    expect(error?.variables).toEqual([
      "PURCHASE_SETTLEMENT_MAX_LINES",
      "PURCHASE_SETTLEMENT_MAX_PAYMENTS",
    ]);
    expect(error?.message).not.toContain("1001");
  });

  it("los límites de la retención tienen sus valores por defecto, se configuran y se acotan (add-withholding-receipts, D25)", () => {
    expect(loadEnv(valid)).toMatchObject({
      WITHHOLDING_MAX_SUPPORTS: 10,
      WITHHOLDING_MAX_ITEMS_PER_SUPPORT: 5,
      WITHHOLDING_MAX_TAXES_PER_SUPPORT: 5,
      WITHHOLDING_MAX_PAYMENTS_PER_SUPPORT: 5,
    });
    expect(
      loadEnv({
        ...valid,
        WITHHOLDING_MAX_SUPPORTS: "30",
        WITHHOLDING_MAX_ITEMS_PER_SUPPORT: "1",
        WITHHOLDING_MAX_TAXES_PER_SUPPORT: "10",
        WITHHOLDING_MAX_PAYMENTS_PER_SUPPORT: "2",
      }),
    ).toMatchObject({
      WITHHOLDING_MAX_SUPPORTS: 30,
      WITHHOLDING_MAX_ITEMS_PER_SUPPORT: 1,
      WITHHOLDING_MAX_TAXES_PER_SUPPORT: 10,
      WITHHOLDING_MAX_PAYMENTS_PER_SUPPORT: 2,
    });
    const error = envError({
      ...valid,
      WITHHOLDING_MAX_SUPPORTS: "31",
      WITHHOLDING_MAX_ITEMS_PER_SUPPORT: "0",
      WITHHOLDING_MAX_TAXES_PER_SUPPORT: "11",
      WITHHOLDING_MAX_PAYMENTS_PER_SUPPORT: "cinco",
    });
    expect(error?.variables).toEqual([
      "WITHHOLDING_MAX_SUPPORTS",
      "WITHHOLDING_MAX_ITEMS_PER_SUPPORT",
      "WITHHOLDING_MAX_TAXES_PER_SUPPORT",
      "WITHHOLDING_MAX_PAYMENTS_PER_SUPPORT",
    ]);
    expect(error?.message).not.toContain("31");
  });

  it("solo activa los tiempos por etapa de la emisión con EMISSION_STAGE_TIMINGS=1 (design D16)", () => {
    expect(loadEnv(valid).EMISSION_STAGE_TIMINGS).toBe(false);
    expect(loadEnv({ ...valid, EMISSION_STAGE_TIMINGS: "0" }).EMISSION_STAGE_TIMINGS).toBe(false);
    expect(loadEnv({ ...valid, EMISSION_STAGE_TIMINGS: "1" }).EMISSION_STAGE_TIMINGS).toBe(true);
    expect(envError({ ...valid, EMISSION_STAGE_TIMINGS: "true" })?.variables).toEqual([
      "EMISSION_STAGE_TIMINGS",
    ]);
  });

  it("rechaza EMISSION_STAGE_TIMINGS=1 en producción", () => {
    const production = { ...valid, NODE_ENV: "production" };
    expect(envError({ ...production, EMISSION_STAGE_TIMINGS: "1" })?.variables).toEqual([
      "EMISSION_STAGE_TIMINGS",
    ]);
    expect(envError({ ...production, EMISSION_STAGE_TIMINGS: "0" })).toBeUndefined();
  });
});

describe("transmisión al SRI (add-sri-transmission, design D5 y D22)", () => {
  it("nace deshabilitada y aplica los valores por defecto", () => {
    expect(loadEnv(valid)).toMatchObject({
      SRI_TRANSMISSION_ENABLED: false,
      SRI_JOB_WORKERS: 2,
      SRI_JOB_LEASE_SECONDS: 120,
      SRI_JOB_POLL_INTERVAL_MS: 2_000,
      SRI_REQUEST_TIMEOUT_MS: 30_000,
      SRI_BODY_TIMEOUT_MS: 30_000,
      SRI_RESPONSE_MAX_BYTES: 5 * 1024 * 1024,
      SRI_AUTHORIZATION_FIRST_DELAY_SECONDS: 5,
      SRI_POLL_BACKOFF_BASE_SECONDS: 10,
      SRI_POLL_BACKOFF_CAP_SECONDS: 1_800,
      SRI_CONCLUSION_WINDOW_HOURS: 24,
      SRI_ERROR70_DELAY_SECONDS: 120,
      SRI_TRANSMIT_MAX_ATTEMPTS: 10,
      SRI_TRANSMIT_DEADLINE_HOURS: 24,
      SRI_SWEEP_INTERVAL_SECONDS: 300,
      SRI_BREAKER_FAILURES: 5,
      SRI_BREAKER_COOLDOWN_SECONDS: 60,
    });
    for (const name of SRI_ENDPOINT_VARIABLES) expect(loadEnv(valid)[name]).toBeUndefined();
  });

  it("solo se habilita con SRI_TRANSMISSION_ENABLED=1", () => {
    expect(loadEnv({ ...valid, SRI_TRANSMISSION_ENABLED: "1" }).SRI_TRANSMISSION_ENABLED).toBe(
      true,
    );
    expect(envError({ ...valid, SRI_TRANSMISSION_ENABLED: "true" })?.variables).toEqual([
      "SRI_TRANSMISSION_ENABLED",
    ]);
  });

  it("rechaza valores fuera de rango sin mostrarlos", () => {
    const error = envError({
      ...valid,
      SRI_JOB_WORKERS: "9",
      SRI_JOB_POLL_INTERVAL_MS: "99",
      SRI_RESPONSE_MAX_BYTES: "999999999",
      SRI_CONCLUSION_WINDOW_HOURS: "0",
      SRI_ENDPOINT_TEST_RECEPTION: "ftp://sri.example/recepcion",
    });
    expect(error?.variables).toEqual([
      "SRI_JOB_WORKERS",
      "SRI_JOB_POLL_INTERVAL_MS",
      "SRI_RESPONSE_MAX_BYTES",
      "SRI_CONCLUSION_WINDOW_HOURS",
      "SRI_ENDPOINT_TEST_RECEPTION",
    ]);
    expect(error?.message).not.toContain("999999999");
    expect(error?.message).not.toContain("sri.example");
    expect(loadEnv({ ...valid, SRI_JOB_WORKERS: "0" }).SRI_JOB_WORKERS).toBe(0);
  });

  it("rechaza un arriendo que no cubre los plazos del transporte", () => {
    expect(sriTransportBudgetMs(loadEnv(valid))).toBe(70_000);
    expect(
      envError({ ...valid, SRI_JOB_LEASE_SECONDS: "60", SRI_REQUEST_TIMEOUT_MS: "30000" })
        ?.variables,
    ).toEqual(["SRI_JOB_LEASE_SECONDS"]);
    expect(envError({ ...valid, SRI_BODY_TIMEOUT_MS: "90000" })?.variables).toEqual([
      "SRI_JOB_LEASE_SECONDS",
    ]);
    expect(
      loadEnv({ ...valid, SRI_JOB_LEASE_SECONDS: "80", SRI_BODY_TIMEOUT_MS: "30000" })
        .SRI_JOB_LEASE_SECONDS,
    ).toBe(80);
  });

  it("rechaza un tope del backoff menor que la base", () => {
    expect(
      envError({
        ...valid,
        SRI_POLL_BACKOFF_BASE_SECONDS: "60",
        SRI_POLL_BACKOFF_CAP_SECONDS: "30",
      })?.variables,
    ).toEqual(["SRI_POLL_BACKOFF_CAP_SECONDS"]);
  });

  it("los endpoints sobrescritos exigen https en producción", () => {
    const production = { ...valid, NODE_ENV: "production" };
    expect(
      envError({ ...production, SRI_ENDPOINT_PRODUCTION_RECEPTION: "http://127.0.0.1:9/r" })
        ?.variables,
    ).toEqual(["SRI_ENDPOINT_PRODUCTION_RECEPTION"]);
    expect(
      envError({ ...production, SRI_ENDPOINT_PRODUCTION_RECEPTION: "https://sri.example/r" }),
    ).toBeUndefined();
    expect(
      loadEnv({ ...valid, SRI_ENDPOINT_TEST_RECEPTION: "http://127.0.0.1:9/r" })
        .SRI_ENDPOINT_TEST_RECEPTION,
    ).toBe("http://127.0.0.1:9/r");
  });
});

describe("RIDE (add-document-archive, design D6)", () => {
  const RIDE = {
    RIDE_WORKERS: [1, 8, 2],
    RIDE_QUEUE: [1, 64, 4],
    RIDE_TASK_TIMEOUT_MS: [5_000, 120_000, 30_000],
    RIDE_JOB_MAX_ATTEMPTS: [1, 50, 5],
    RIDE_SWEEP_INTERVAL_SECONDS: [10, 86_400, 300],
  } as const;

  it("aplica los valores por defecto", () => {
    expect(loadEnv(valid)).toMatchObject(
      Object.fromEntries(Object.entries(RIDE).map(([name, [, , fallback]]) => [name, fallback])),
    );
  });

  it("acepta los bordes de cada rango", () => {
    for (const [name, [min, max]] of Object.entries(RIDE)) {
      expect(loadEnv({ ...valid, [name]: String(min) })).toMatchObject({ [name]: min });
      expect(loadEnv({ ...valid, [name]: String(max) })).toMatchObject({ [name]: max });
    }
  });

  it("rechaza valores fuera de rango sin mostrarlos", () => {
    const below = Object.fromEntries(
      Object.entries(RIDE).map(([name, [min]]) => [name, String(min - 1)]),
    );
    const above = Object.fromEntries(
      Object.entries(RIDE).map(([name, [, max]]) => [name, String(max + 1)]),
    );
    for (const outOfRange of [below, above]) {
      const error = envError({ ...valid, ...outOfRange });
      expect(error?.variables).toEqual(Object.keys(RIDE));
      expect(error?.message).not.toContain("86401");
    }
    expect(envError({ ...valid, RIDE_QUEUE: "0" })?.variables).toEqual(["RIDE_QUEUE"]);
  });
});
