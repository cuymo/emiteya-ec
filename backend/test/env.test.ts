import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EnvError, loadEnv } from "../src/config/env.ts";

const backendRoot = fileURLToPath(new URL("..", import.meta.url));
const SECRET = "valor-secreto-que-no-debe-aparecer";
const valid = { DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/db" };

function startupWith(env: Record<string, string>) {
  return spawnSync(process.execPath, ["--conditions=development", "src/main.ts"], {
    cwd: backendRoot,
    env: { PATH: process.env.PATH, ...env },
    encoding: "utf8",
    timeout: 20_000,
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

  it("exige DATABASE_URL", () => {
    expect(() => loadEnv({})).toThrow(EnvError);
    expect(() => loadEnv({})).toThrow(/DATABASE_URL: es obligatoria/);
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
