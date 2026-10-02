import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EXAMPLE_AUTH_SECRET, EnvError, loadEnv, loadInitialAdmin } from "../src/config/env.ts";

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
