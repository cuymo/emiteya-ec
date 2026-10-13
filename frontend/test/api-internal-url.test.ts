// Destino interno de la API en producción, al construir y al ejecutar
// (harden-production-configuration-and-clock-ownership, design D5).
import {
  PHASE_DEVELOPMENT_SERVER,
  PHASE_PRODUCTION_BUILD,
  PHASE_PRODUCTION_SERVER,
} from "next/constants";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiInternalUrlError,
  DEVELOPMENT_API_INTERNAL_URL,
  resolveApiInternalUrl,
} from "@/lib/api-internal-url";
import nextConfig from "../next.config";

const SECRET = "clave-sintetica-que-no-debe-aparecer";

describe("resolución de API_INTERNAL_URL", () => {
  it("acepta un origen http o https y devuelve su forma normalizada", () => {
    for (const [value, origin] of [
      ["http://127.0.0.1:4100", "http://127.0.0.1:4100"],
      ["http://api.interno:4000/", "http://api.interno:4000"],
      ["https://api.interno", "https://api.interno"],
      ["HTTP://[::1]:4000", "http://[::1]:4000"],
    ]) {
      expect(resolveApiInternalUrl(value, { required: true })).toBe(origin);
    }
  });

  it("ausente: obligatoria si se exige, bucle local de desarrollo si no", () => {
    for (const value of [undefined, ""]) {
      expect(() => resolveApiInternalUrl(value, { required: true })).toThrow(
        "API_INTERNAL_URL: es obligatoria en producción",
      );
      expect(resolveApiInternalUrl(value, { required: false })).toBe(DEVELOPMENT_API_INTERNAL_URL);
    }
  });

  it("rechaza lo que no es un origen http o https, sin mostrar el valor, en cualquier caso", () => {
    const cases: [string, string][] = [
      [SECRET, "no es una URL absoluta válida"],
      [`/${SECRET}`, "no es una URL absoluta válida"],
      [`ftp://${SECRET}.interno`, "debe usar http o https"],
      [`file:///${SECRET}`, "debe usar http o https"],
      [`http://usuario:${SECRET}@api.interno`, "no admite credenciales"],
      [`http://${SECRET}@api.interno`, "no admite credenciales"],
      [`http://api.interno/${SECRET}`, "debe ser solo un origen"],
      [`http://api.interno/?${SECRET}`, "debe ser solo un origen"],
      [`http://api.interno/#${SECRET}`, "debe ser solo un origen"],
    ];
    for (const required of [true, false]) {
      for (const [value, rule] of cases) {
        let error: unknown;
        try {
          resolveApiInternalUrl(value, { required });
        } catch (caught) {
          error = caught;
        }
        expect(error, value).toBeInstanceOf(ApiInternalUrlError);
        expect((error as Error).message).toContain(`API_INTERNAL_URL: ${rule}`);
        expect((error as Error).message).not.toContain(SECRET);
      }
    }
  });
});

describe("configuración de Next.js", () => {
  afterEach(() => vi.unstubAllEnvs());

  const fallback = async (phase: string) => {
    const rewrites = await nextConfig(phase).rewrites?.();
    return rewrites && !Array.isArray(rewrites) ? rewrites.fallback : undefined;
  };

  it("el build de producción y next start exigen el destino, sin bucle local por defecto", () => {
    vi.stubEnv("API_INTERNAL_URL", undefined);
    for (const phase of [PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER]) {
      expect(() => nextConfig(phase)).toThrow("API_INTERNAL_URL: es obligatoria en producción");
    }
    vi.stubEnv("API_INTERNAL_URL", `http://api.interno/${SECRET}`);
    expect(() => nextConfig(PHASE_PRODUCTION_BUILD)).toThrow(/^API_INTERNAL_URL: /);
    expect(() => nextConfig(PHASE_PRODUCTION_BUILD)).not.toThrow(SECRET);
  });

  it("con el destino declarado, el build reenvía /api a ese origen", async () => {
    vi.stubEnv("API_INTERNAL_URL", "http://127.0.0.1:4100");
    expect(await fallback(PHASE_PRODUCTION_BUILD)).toEqual([
      { source: "/api/:path*", destination: "http://127.0.0.1:4100/api/:path*" },
    ]);
  });

  it("next dev, sin la variable, conserva el bucle local", async () => {
    vi.stubEnv("API_INTERNAL_URL", undefined);
    expect(await fallback(PHASE_DEVELOPMENT_SERVER)).toEqual([
      { source: "/api/:path*", destination: "http://127.0.0.1:4000/api/:path*" },
    ]);
  });
});
