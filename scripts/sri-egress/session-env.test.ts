// Comprobaciones del archivo de entorno de la sesión (docs/quality/sri-egress-allowlist.md).
import { describe, expect, it } from "vitest";
import { checkSessionEnv, parseEnvFile } from "./session-env.ts";

const CLOSED = "https://127.0.0.1:9/cerrado";
const valid = {
  DATABASE_URL: "postgresql://cert:clave@127.0.0.1:5432/facturador?schema=cert",
  SRI_TRANSMISSION_ENABLED: "0",
  SRI_ENDPOINT_PRODUCTION_RECEPTION: CLOSED,
  SRI_ENDPOINT_PRODUCTION_AUTHORIZATION: CLOSED,
  SRI_ENDPOINT_PRODUCTION_VALIDITY: CLOSED,
};
const failed = (env: Record<string, string>) =>
  checkSessionEnv(env, 5432)
    .filter((check) => !check.ok)
    .map((check) => check.name);

describe("entorno de la sesión de certificación", () => {
  it("un entorno correcto pasa todas las comprobaciones", () => {
    expect(failed(valid)).toEqual([]);
  });

  it("sin sobrescribir Producción la sesión no arranca: la aplicación usaría cel.sri.gob.ec", () => {
    const { SRI_ENDPOINT_PRODUCTION_RECEPTION: _omitted, ...rest } = valid;
    expect(failed(rest)).toEqual(["SRI_ENDPOINT_PRODUCTION_RECEPTION-overridden"]);
    const detail = checkSessionEnv(rest, 5432).find((check) => !check.ok)!.detail;
    expect(detail).toContain("PRODUCTION_ACCESS_BLOCKED");
  });

  it("ningún endpoint puede nombrar a Producción", () => {
    const env = {
      ...valid,
      SRI_ENDPOINT_PRODUCTION_RECEPTION:
        "https://cel.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline",
    };
    expect(failed(env)).toEqual([
      "no-production-endpoint",
      "SRI_ENDPOINT_PRODUCTION_RECEPTION-overridden",
    ]);
    expect(failed({ ...valid, SRI_ENDPOINT_TEST_RECEPTION: "https://cel.sri.gob.ec/x" })).toContain(
      "no-production-endpoint",
    );
  });

  it("un endpoint de Pruebas sobrescrito solo puede ser celcer", () => {
    expect(
      failed({
        ...valid,
        SRI_ENDPOINT_TEST_RECEPTION:
          "https://celcer.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline",
      }),
    ).toEqual([]);
    expect(failed({ ...valid, SRI_ENDPOINT_TEST_RECEPTION: "https://otro.example/x" })).toEqual([
      "SRI_ENDPOINT_TEST_RECEPTION-is-celcer",
    ]);
  });

  it("la base de datos va por el puente local y el archivo no fija el proxy", () => {
    expect(failed({ ...valid, DATABASE_URL: "postgresql://u:p@db.example:5432/x" })).toEqual([
      "database-through-local-bridge",
    ]);
    expect(failed({ ...valid, HTTPS_PROXY: "http://otro:3128" })).toEqual([
      "proxy-variables-managed-by-tool",
    ]);
    expect(failed({ ...valid, SRI_TRANSMISSION_ENABLED: "true" })).toEqual([
      "transmission-flag-defined",
    ]);
  });

  it("lee KEY=VALUE con comentarios, export y comillas", () => {
    expect(parseEnvFile("# comentario\nexport A='1'\nB=\"dos\"\nC=tres\n")).toEqual({
      A: "1",
      B: "dos",
      C: "tres",
    });
  });
});
