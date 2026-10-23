import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { afterAll, describe, expect, it } from "vitest";
import { TRANSMISSION_SIZE_POLICY } from "../src/modules/fiscal/domain/transmission-size-policy.ts";
import {
  EXAMPLE_AUTH_SECRET,
  EXAMPLE_CERTIFICATE_MASTER_KEY,
  EnvError,
  loadCanonicalOrigin,
  loadCertificateCustody,
  loadDataExportDirectory,
  loadEnv,
  loadInitialAdmin,
  parseTrustProxy,
  SRI_ENDPOINT_VARIABLES,
  sriTransportBudgetMs,
} from "../src/config/env.ts";

const backendRoot = fileURLToPath(new URL("..", import.meta.url));
const SECRET = "valor-secreto-que-no-debe-aparecer";
const valid = {
  NODE_ENV: "development",
  DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/db",
  BETTER_AUTH_SECRET: "secreto-de-pruebas-0123456789abcdef0123",
  BETTER_AUTH_URL: "http://localhost:3000",
};
// Lo mínimo que producción exige además (harden-production-configuration-and-clock-ownership).
const production = {
  ...valid,
  NODE_ENV: "production",
  TRUST_PROXY: "loopback",
  DATA_EXPORT_DIRECTORY: "/srv/facturador/exports",
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

  it("exige NODE_ENV, DATABASE_URL, BETTER_AUTH_SECRET y BETTER_AUTH_URL", () => {
    expect(() => loadEnv({})).toThrow(EnvError);
    expect(envError({})?.variables).toEqual([
      "NODE_ENV",
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
    const error = envError({ ...production, BETTER_AUTH_SECRET: EXAMPLE_AUTH_SECRET });
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

  it("el origen canónico sale de BETTER_AUTH_URL, y sin uno utilizable no hay arranque ni valor en el mensaje", () => {
    expect(
      loadCanonicalOrigin(
        loadEnv({ ...valid, BETTER_AUTH_URL: "https://facturas.ejemplo.test:443/app/?x=1" }),
      ),
    ).toBe("https://facturas.ejemplo.test");
    for (const unusable of [`file:///${SECRET}`, SECRET]) {
      const error = (() => {
        try {
          loadCanonicalOrigin({ BETTER_AUTH_URL: unusable });
        } catch (e) {
          return e as EnvError;
        }
      })();
      expect(error).toBeInstanceOf(EnvError);
      expect(error?.variables).toEqual(["BETTER_AUTH_URL"]);
      expect(error?.message).not.toContain(SECRET);
    }

    const startup = startupWith({ ...valid, BETTER_AUTH_URL: `ftp://${SECRET}` });
    expect(startup.status).toBe(1);
    expect(startup.stderr).toContain("BETTER_AUTH_URL: valor inválido");
    expect(startup.stderr).not.toContain(SECRET);
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
    const error = envError({ ...production, CERTIFICATE_CUSTODY: "disabled" });
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
      ...production,
      CERTIFICATE_MASTER_KEY: EXAMPLE_CERTIFICATE_MASTER_KEY,
    });
    expect(error?.message).toContain("CERTIFICATE_MASTER_KEY: es la de ejemplo");
    expect(error?.message).not.toContain(EXAMPLE_CERTIFICATE_MASTER_KEY);
  });

  it("la API no arranca en producción sin clave de custodia", () => {
    const result = startupWith(production);
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
        PURCHASE_SETTLEMENT_MAX_LINES: "500",
        PURCHASE_SETTLEMENT_MAX_PAYMENTS: "20",
      }),
    ).toMatchObject({ PURCHASE_SETTLEMENT_MAX_LINES: 500, PURCHASE_SETTLEMENT_MAX_PAYMENTS: 20 });
    const error = envError({
      ...valid,
      PURCHASE_SETTLEMENT_MAX_LINES: "501",
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

  it("ninguna variable cambia la política de tamaño y la sesión de certificación ya no existe (adopt-conservative-sri-transmission-size-policy-v1)", () => {
    const tampered = loadEnv({
      ...valid,
      SRI_CERTIFICATION_SAFETY_CAP_ENABLED: "1",
      SRI_CERTIFICATION_SAFETY_CAP_BYTES: "999999",
      SRI_TRANSMISSION_SIZE_LIMIT_BYTES: "999999",
      SRI_SIZE_POLICY: "SRI_OFFICIAL_POLICY",
    });
    expect(
      Object.keys(tampered).filter((name) =>
        /^SRI_(CERTIFICATION|TRANSMISSION_SIZE|SIZE_POLICY)/.test(name),
      ),
    ).toEqual([]);
    expect(tampered.SRI_TRANSMISSION_ENABLED).toBe(false);
    expect(TRANSMISSION_SIZE_POLICY.limitBytes).toBe(40_000);
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

describe("entrega por correo (add-email-delivery, design D5 a D7)", () => {
  const EMAIL = {
    EMAIL_SMTP_CONNECTION_TIMEOUT_MS: [1_000, 120_000, 10_000],
    EMAIL_SMTP_SOCKET_TIMEOUT_MS: [5_000, 300_000, 60_000],
    EMAIL_JOB_WORKERS: [0, 4, 2],
    EMAIL_JOB_POLL_INTERVAL_MS: [100, 60_000, 2_000],
    EMAIL_JOB_MAX_ATTEMPTS: [1, 50, 12],
    EMAIL_RETRY_BASE_SECONDS: [1, 3_600, 60],
    EMAIL_DELIVERY_DEADLINE_HOURS: [24, 168, 26],
  } as const;

  it("nace apagada, sin conexión sin cifrado, y aplica los valores por defecto", () => {
    expect(loadEnv(valid)).toMatchObject({
      EMAIL_DELIVERY_ENABLED: false,
      EMAIL_ALLOW_PLAINTEXT_SMTP: false,
      EMAIL_JOB_LEASE_SECONDS: 300,
      EMAIL_RETRY_CAP_SECONDS: 7_200,
      ...Object.fromEntries(
        Object.entries(EMAIL).map(([name, [, , fallback]]) => [name, fallback]),
      ),
    });
  });

  it("solo se encienden con 1", () => {
    const on = loadEnv({ ...valid, EMAIL_DELIVERY_ENABLED: "1", EMAIL_ALLOW_PLAINTEXT_SMTP: "1" });
    expect(on.EMAIL_DELIVERY_ENABLED).toBe(true);
    expect(on.EMAIL_ALLOW_PLAINTEXT_SMTP).toBe(true);
    expect(
      envError({ ...valid, EMAIL_DELIVERY_ENABLED: "true", EMAIL_ALLOW_PLAINTEXT_SMTP: "si" })
        ?.variables,
    ).toEqual(["EMAIL_DELIVERY_ENABLED", "EMAIL_ALLOW_PLAINTEXT_SMTP"]);
  });

  it("acepta los bordes de cada rango", () => {
    // Con el arriendo máximo, para que los plazos más largos del servidor quepan en él.
    const roomy = { ...valid, EMAIL_JOB_LEASE_SECONDS: "3600" };
    for (const [name, [min, max]] of Object.entries(EMAIL)) {
      expect(loadEnv({ ...roomy, [name]: String(min) })).toMatchObject({ [name]: min });
      expect(loadEnv({ ...roomy, [name]: String(max) })).toMatchObject({ [name]: max });
    }
  });

  it("rechaza valores fuera de rango sin mostrarlos", () => {
    const below = Object.fromEntries(
      Object.entries(EMAIL).map(([name, [min]]) => [name, String(min - 1)]),
    );
    const error = envError({ ...valid, ...below });
    expect(error?.variables).toEqual(Object.keys(EMAIL));
    expect(error?.message).not.toContain("119999");
    // Los reintentos cubren al menos 24 h.
    expect(envError({ ...valid, EMAIL_DELIVERY_DEADLINE_HOURS: "23" })?.variables).toEqual([
      "EMAIL_DELIVERY_DEADLINE_HOURS",
    ]);
  });

  it("el arriendo cubre los plazos del servidor de correo y el techo no baja de la base", () => {
    expect(
      envError({ ...valid, EMAIL_JOB_LEASE_SECONDS: "60", EMAIL_SMTP_SOCKET_TIMEOUT_MS: "60000" })
        ?.variables,
    ).toEqual(["EMAIL_JOB_LEASE_SECONDS"]);
    expect(
      envError({ ...valid, EMAIL_RETRY_BASE_SECONDS: "600", EMAIL_RETRY_CAP_SECONDS: "300" })
        ?.variables,
    ).toEqual(["EMAIL_RETRY_CAP_SECONDS"]);
  });
});

describe("exportación de los reportes (add-reports-export, design D11)", () => {
  const REPORTS = {
    REPORT_EXPORT_MAX_ROWS: [1, 250_000, 100_000],
    REPORT_EXPORT_MAX_CONCURRENT: [1, 4, 2],
  } as const;

  it("aplica los valores por defecto que fijó el benchmark", () => {
    expect(loadEnv(valid)).toMatchObject({
      REPORT_EXPORT_MAX_ROWS: 100_000,
      REPORT_EXPORT_MAX_CONCURRENT: 2,
    });
  });

  it("acepta los bordes de cada rango", () => {
    for (const [name, [min, max]] of Object.entries(REPORTS)) {
      expect(loadEnv({ ...valid, [name]: String(min) })).toMatchObject({ [name]: min });
      expect(loadEnv({ ...valid, [name]: String(max) })).toMatchObject({ [name]: max });
    }
  });

  it("rechaza más filas que el máximo, cero y valores que no son enteros", () => {
    for (const value of ["0", "250001", "1048576", "2.5", "muchas"]) {
      expect(envError({ ...valid, REPORT_EXPORT_MAX_ROWS: value })?.variables).toEqual([
        "REPORT_EXPORT_MAX_ROWS",
      ]);
    }
    for (const value of ["0", "5"]) {
      expect(envError({ ...valid, REPORT_EXPORT_MAX_CONCURRENT: value })?.variables).toEqual([
        "REPORT_EXPORT_MAX_CONCURRENT",
      ]);
    }
  });
});

describe("portabilidad de datos (add-data-portability, design D14 y D20)", () => {
  const PORTABILITY = {
    DATA_EXPORT_MAX_CONCURRENT: [1, 2, 1],
    DATA_EXPORT_TTL_HOURS: [1, 168, 24],
    DATA_EXPORT_DISK_HEADROOM_PERCENT: [0, 100, 10],
    DATA_EXPORT_DISK_RESERVE_MIB: [64, 65_536, 512],
    DATA_EXPORT_SWEEP_INTERVAL_SECONDS: [10, 86_400, 300],
  } as const;

  it("aplica las hipótesis iniciales y deja el directorio sin valor por defecto", () => {
    const env = loadEnv(valid);
    for (const [name, [, , value]] of Object.entries(PORTABILITY))
      expect([name, env[name as keyof typeof env]]).toEqual([name, value]);
    expect(env.DATA_EXPORT_DIRECTORY).toBeUndefined();
  });

  it("acepta los bordes y rechaza lo que sale de cada rango", () => {
    for (const [name, [min, max]] of Object.entries(PORTABILITY)) {
      expect(loadEnv({ ...valid, [name]: String(min) })).toMatchObject({ [name]: min });
      expect(loadEnv({ ...valid, [name]: String(max) })).toMatchObject({ [name]: max });
      for (const value of [String(min - 1), String(max + 1), "2.5", "nada"])
        expect([name, value, envError({ ...valid, [name]: value })?.variables]).toEqual([
          name,
          value,
          [name],
        ]);
    }
  });

  it("exige un directorio absoluto para el paquete", () => {
    expect(loadEnv({ ...valid, DATA_EXPORT_DIRECTORY: "/srv/facturador/exports" })).toMatchObject({
      DATA_EXPORT_DIRECTORY: "/srv/facturador/exports",
    });
    expect(envError({ ...valid, DATA_EXPORT_DIRECTORY: "exports" })?.variables).toEqual([
      "DATA_EXPORT_DIRECTORY",
    ]);
  });
});

describe("configuración de producción (harden-production-configuration-and-clock-ownership)", () => {
  const root = mkdtempSync(join(tmpdir(), "facturador-env-"));
  afterAll(() => {
    if (existsSync(join(root, "sin-escritura"))) chmodSync(join(root, "sin-escritura"), 0o700);
    rmSync(root, { recursive: true, force: true });
  });
  const directory = (name: string) => {
    const path = join(root, name);
    mkdirSync(path, { mode: 0o700 });
    return path;
  };
  const directoryError = (
    path: string | undefined,
    probe?: Parameters<typeof loadDataExportDirectory>[1],
  ) => {
    try {
      loadDataExportDirectory({ NODE_ENV: "production", DATA_EXPORT_DIRECTORY: path }, probe);
    } catch (error) {
      return error as EnvError;
    }
    return undefined;
  };
  const { DATA_EXPORT_DIRECTORY: _directory, ...withoutDirectory } = production;
  const { TRUST_PROXY: _trustProxy, ...withoutTrustProxy } = production;

  describe("directorio de exportación (design D2)", () => {
    it("en producción usa un directorio absoluto, existente, propio y utilizable", () => {
      const path = directory("valido");
      expect(loadDataExportDirectory(loadEnv({ ...production, DATA_EXPORT_DIRECTORY: path }))).toBe(
        path,
      );
    });

    it("en producción exige la variable y una ruta absoluta", () => {
      const missing = envError(withoutDirectory);
      expect(missing?.variables).toEqual(["DATA_EXPORT_DIRECTORY"]);
      expect(missing?.message).toContain("DATA_EXPORT_DIRECTORY: es obligatoria en producción");
      expect(directoryError(undefined)?.message).toContain("es obligatoria en producción");
      expect(envError({ ...production, DATA_EXPORT_DIRECTORY: "exports" })?.variables).toEqual([
        "DATA_EXPORT_DIRECTORY",
      ]);
    });

    it("en producción rechaza, sin crear nada ni mostrar la ruta, lo que no es un directorio propio y utilizable", () => {
      const absent = join(root, "inexistente");
      const target = directory("destino");
      const link = join(root, "enlace");
      symlinkSync(target, link);
      const file = join(root, "archivo");
      writeFileSync(file, "");
      const cases: [string, EnvError | undefined, string][] = [
        [absent, directoryError(absent), "no existe (producción no lo crea)"],
        [link, directoryError(link), "es un enlace simbólico"],
        [file, directoryError(file), "no es un directorio"],
      ];
      for (const [path, error, rule] of cases) {
        expect(error).toBeInstanceOf(EnvError);
        expect(error?.variables).toEqual(["DATA_EXPORT_DIRECTORY"]);
        expect(error?.message).toContain(`DATA_EXPORT_DIRECTORY: ${rule}`);
        expect(error?.message).not.toContain(path);
      }
      expect(existsSync(absent)).toBe(false);
    });

    it("en producción rechaza un directorio de otro usuario", () => {
      const path = directory("ajeno");
      const realUid = process.getuid?.() ?? 0;
      const error = directoryError(path, {
        lstat: (target) => Object.assign(lstatSync(target), { uid: realUid + 1 }),
        access: () => undefined,
        uid: realUid,
      });
      expect(error?.message).toContain(
        "DATA_EXPORT_DIRECTORY: no pertenece al usuario del proceso",
      );
      expect(error?.message).not.toContain(path);
    });

    it.skipIf(process.getuid?.() === 0)(
      "en producción rechaza un directorio sin permiso de escritura",
      () => {
        const path = directory("sin-escritura");
        chmodSync(path, 0o500);
        const error = directoryError(path);
        expect(error?.message).toContain(
          "DATA_EXPORT_DIRECTORY: el proceso no puede leerlo, escribir en él o recorrerlo",
        );
        expect(error?.message).not.toContain(path);
      },
    );

    it("en desarrollo y en pruebas sigue siendo opcional", () => {
      expect(loadDataExportDirectory(loadEnv(valid))).toBeUndefined();
      expect(loadDataExportDirectory(loadEnv({ ...valid, NODE_ENV: "test" }))).toBeUndefined();
      const absent = join(root, "desarrollo-inexistente");
      expect(loadDataExportDirectory(loadEnv({ ...valid, DATA_EXPORT_DIRECTORY: absent }))).toBe(
        absent,
      );
      expect(existsSync(absent)).toBe(false);
    });

    it("la API no arranca en producción con un directorio inexistente, antes de escuchar y sin pila", () => {
      const key = randomBytes(32).toString("base64");
      const absent = join(root, "arranque-inexistente");
      const result = startupWith({
        ...production,
        CERTIFICATE_MASTER_KEY: key,
        DATA_EXPORT_DIRECTORY: absent,
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("DATA_EXPORT_DIRECTORY: no existe (producción no lo crea)");
      expect(result.stderr).not.toContain(absent);
      expect(result.stderr).not.toContain(key);
      expect(result.stderr).not.toMatch(/^\s+at /m);
      expect(result.stdout).not.toContain("backend escuchando");
      expect(existsSync(absent)).toBe(false);
    });
  });

  describe("límite de confianza del proxy (design D3)", () => {
    const accepted: [string, false | number | string][] = [
      ["1", 1],
      ["2", 2],
      ["10.0.0.1", "10.0.0.1"],
      ["2001:db8::1", "2001:db8::1"],
      ["10.0.0.0/8", "10.0.0.0/8"],
      ["2001:db8::/32", "2001:db8::/32"],
      ["10.0.0.1, 10.0.0.2/32 ,2001:db8::1", "10.0.0.1,10.0.0.2/32,2001:db8::1"],
      ["loopback", "loopback"],
    ];
    const rejected = [
      "0",
      "-1",
      "01",
      "1.5",
      "1e3",
      "linklocal",
      "uniquelocal",
      "loopback,10.0.0.1",
      SECRET,
      "",
      "10.0.0.256",
      "10.0.0.0/33",
      "2001:db8::/129",
      "0.0.0.0/0",
      "::/0",
      "10.0.0.0/08",
      "10.0.0.0/255.0.0.0",
      "10.0.0.1,",
      "[::1]",
      "fe80::1%eth0",
      "10.0.0.1/8/8",
    ];

    it("en producción admite saltos, direcciones, bloques, listas y loopback, y Express los compila", () => {
      for (const [value, expected] of accepted) {
        const parsed = loadEnv({ ...production, TRUST_PROXY: value }).TRUST_PROXY;
        expect([value, parsed]).toEqual([value, expected]);
        expect(() => express().set("trust proxy", parsed)).not.toThrow();
      }
    });

    it("en producción exige el límite: ausente, false y true no arrancan", () => {
      for (const source of [withoutTrustProxy, { ...production, TRUST_PROXY: "false" }]) {
        const error = envError(source);
        expect(error?.variables).toEqual(["TRUST_PROXY"]);
        expect(error?.message).toContain("TRUST_PROXY: es obligatoria en producción");
      }
      expect(envError({ ...production, TRUST_PROXY: "true" })?.variables).toEqual(["TRUST_PROXY"]);
    });

    it("en cualquier ambiente rechaza una sintaxis no admitida, sin mostrarla y sin llegar a Express", () => {
      for (const NODE_ENV of ["development", "test", "production"]) {
        for (const value of [...rejected, "true"]) {
          expect(parseTrustProxy(value)).toBeNull();
          const error = envError({ ...production, NODE_ENV, TRUST_PROXY: value });
          expect([NODE_ENV, value, error?.variables]).toEqual([NODE_ENV, value, ["TRUST_PROXY"]]);
        }
        expect(envError({ ...production, NODE_ENV, TRUST_PROXY: SECRET })?.message).not.toContain(
          SECRET,
        );
      }
    });

    it("en desarrollo y en pruebas sigue sin confiar en ningún proxy por defecto", () => {
      expect(loadEnv(valid).TRUST_PROXY).toBe(false);
      expect(loadEnv({ ...valid, NODE_ENV: "test" }).TRUST_PROXY).toBe(false);
      expect(loadEnv({ ...valid, TRUST_PROXY: "false" }).TRUST_PROXY).toBe(false);
      expect(loadEnv({ ...valid, TRUST_PROXY: "1" }).TRUST_PROXY).toBe(1);
    });
  });

  describe("origen de la autenticación (design D4)", () => {
    it("en producción admite https y el http del bucle local exacto", () => {
      for (const url of [
        "https://facturas.ejemplo.test",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://[::1]:3000",
      ]) {
        expect([url, envError({ ...production, BETTER_AUTH_URL: url })]).toEqual([url, undefined]);
      }
    });

    it("en producción rechaza http con otro host, incluidos los que se parecen al bucle local", () => {
      for (const url of [
        "http://facturas.ejemplo.test",
        "http://localhost.example.com:3000",
        "http://127.0.0.1.example.com:3000",
        "http://10.0.0.5:3000",
      ]) {
        const error = envError({ ...production, BETTER_AUTH_URL: url });
        expect([url, error?.variables]).toEqual([url, ["BETTER_AUTH_URL"]]);
        expect(error?.message).toContain(
          "BETTER_AUTH_URL: usa http fuera del bucle local en producción",
        );
        expect(error?.message).not.toContain(new URL(url).hostname);
      }
      expect(loadEnv({ ...valid, BETTER_AUTH_URL: "http://facturas.ejemplo.test" })).toMatchObject({
        BETTER_AUTH_URL: "http://facturas.ejemplo.test",
      });
    });

    it("el origen canónico sigue siendo el de BETTER_AUTH_URL en https", () => {
      expect(
        loadCanonicalOrigin(
          loadEnv({ ...production, BETTER_AUTH_URL: "https://facturas.ejemplo.test" }),
        ),
      ).toBe("https://facturas.ejemplo.test");
    });
  });
});

describe("ambiente declarado (harden-production-configuration-and-clock-ownership, design D1)", () => {
  const { NODE_ENV: _nodeEnv, ...withoutNodeEnv } = valid;

  it("exige NODE_ENV sin valor por defecto ni otros valores del entorno en el mensaje", () => {
    const error = envError(withoutNodeEnv);
    expect(error?.variables).toEqual(["NODE_ENV"]);
    expect(error?.message).toContain("NODE_ENV: es obligatoria");
    expect(error?.message).not.toContain(valid.BETTER_AUTH_SECRET);
    expect(error?.message).not.toContain("u:p@");
  });

  it("admite development, test y production explícitos, y rechaza otro valor sin repetirlo", () => {
    expect(loadEnv({ ...valid, NODE_ENV: "development" }).NODE_ENV).toBe("development");
    expect(loadEnv({ ...valid, NODE_ENV: "test" }).NODE_ENV).toBe("test");
    expect(loadEnv(production).NODE_ENV).toBe("production");
    for (const value of ["produccion", "Production", "prod", ""]) {
      const error = envError({ ...valid, NODE_ENV: value });
      expect([value, error?.variables]).toEqual([value, ["NODE_ENV"]]);
      if (value) expect(error?.message).not.toContain(value);
    }
  });

  it("la API no arranca sin NODE_ENV, antes de escuchar", () => {
    const result = startupWith(withoutNodeEnv);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("NODE_ENV: es obligatoria");
    expect(result.stderr).not.toContain(valid.BETTER_AUTH_SECRET);
    expect(result.stdout).not.toContain("backend escuchando");
  });
});

describe("los rechazos de configuración no revelan secretos (harden-production-configuration-and-clock-ownership, design D6)", () => {
  it("un arranque de producción rechazado nombra las variables sin credenciales, secretos ni el entorno", () => {
    // La URL se arma en tiempo de ejecución: ninguna credencial, ni sintética, queda escrita.
    const database = new URL("postgresql://127.0.0.1:5432/db");
    database.username = "usuario-sintetico";
    database.password = `clave-${randomBytes(8).toString("hex")}`;
    const secrets = {
      DATABASE_URL: database.toString(),
      BETTER_AUTH_SECRET: `secreto-sintetico-${randomBytes(16).toString("hex")}`,
      CERTIFICATE_MASTER_KEY: randomBytes(32).toString("base64"),
      CERTIFICATE_PASSWORD: `clave-de-certificado-${randomBytes(8).toString("hex")}`,
      VARIABLE_AJENA: `centinela-del-entorno-${randomBytes(8).toString("hex")}`,
    };
    const result = startupWith({
      ...production,
      ...secrets,
      TRUST_PROXY: "false",
      DATA_EXPORT_DIRECTORY: "relativo",
      BETTER_AUTH_URL: "http://facturas.ejemplo.test",
    });
    expect(result.status).toBe(1);
    for (const name of ["TRUST_PROXY", "DATA_EXPORT_DIRECTORY", "BETTER_AUTH_URL"]) {
      expect(result.stderr).toContain(`${name}: `);
    }
    for (const value of [
      database.username,
      database.password,
      secrets.BETTER_AUTH_SECRET,
      secrets.CERTIFICATE_MASTER_KEY,
      secrets.CERTIFICATE_PASSWORD,
      secrets.VARIABLE_AJENA,
      "facturas.ejemplo.test",
      "relativo",
    ]) {
      expect(result.stderr).not.toContain(value);
      expect(result.stdout).not.toContain(value);
    }
  });
});
