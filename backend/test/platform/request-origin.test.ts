// Decisión de origen y Fetch Metadata de /api/v1 (enforce-api-origin-and-body-limits, design D2 a D4
// y D8), sin servidor.
import type { IncomingHttpHeaders } from "node:http";
import { describe, expect, it } from "vitest";
import {
  canonicalOrigin,
  evaluateRequestOrigin,
  routeCategory,
} from "../../src/platform/http/request-origin.ts";

const CANONICAL = "https://facturas.ejemplo.test";

const evaluate = (method: string, headers: IncomingHttpHeaders) =>
  evaluateRequestOrigin(method, headers, CANONICAL);

describe("origen de las mutaciones", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE"])("%s con el origen canónico sigue", (method) => {
    expect(evaluate(method, { origin: CANONICAL })).toBeNull();
  });

  it.each([
    ["otro sitio", "https://atacante.ejemplo"],
    ["un subdominio hermano", "https://otro.facturas.ejemplo.test"],
    ["otro esquema", "http://facturas.ejemplo.test"],
    ["otro puerto", "https://facturas.ejemplo.test:8443"],
  ])("rechaza %s", (_case, origin) => {
    expect(evaluate("POST", { origin })).toBe("origin_mismatch");
  });

  it("rechaza el origen ausente y el nulo", () => {
    expect(evaluate("POST", {})).toBe("missing_origin");
    expect(evaluate("DELETE", { origin: "null" })).toBe("null_origin");
  });

  it.each([
    ["con ruta", `${CANONICAL}/app`],
    ["con barra final", `${CANONICAL}/`],
    ["con usuario", "https://usuario@facturas.ejemplo.test"],
    ["con espacios", "https://facturas.ejemplo.test /"],
    ["en mayúsculas", "HTTPS://FACTURAS.EJEMPLO.TEST"],
    ["con el puerto por defecto", "https://facturas.ejemplo.test:443"],
    ["sin esquema", "facturas.ejemplo.test"],
    ["vacío", ""],
    ["de esquema opaco", "app://facturas.ejemplo.test"],
  ])("rechaza un origen malformado %s", (_case, origin) => {
    expect(evaluate("PUT", { origin })).toBe("malformed_origin");
  });

  it("no exige origen en GET, HEAD ni OPTIONS", () => {
    expect(evaluate("GET", {})).toBeNull();
    expect(evaluate("HEAD", { origin: "https://atacante.ejemplo" })).toBeNull();
    expect(evaluate("OPTIONS", {})).toBeNull();
  });
});

describe("Fetch Metadata", () => {
  it.each(["same-origin", "none", "desconocido", undefined])(
    "%s no rechaza por sí solo",
    (site) => {
      const headers = site === undefined ? {} : { "sec-fetch-site": site };
      expect(evaluate("GET", headers)).toBeNull();
      expect(evaluate("POST", { ...headers, origin: CANONICAL })).toBeNull();
    },
  );

  it.each(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"])(
    "%s same-site y cross-site se rechazan",
    (method) => {
      expect(evaluate(method, { "sec-fetch-site": "same-site", origin: CANONICAL })).toBe(
        "fetch_site_same_site",
      );
      expect(evaluate(method, { "sec-fetch-site": "cross-site", origin: CANONICAL })).toBe(
        "fetch_site_cross_site",
      );
    },
  );

  it("se evalúa antes que el origen", () => {
    expect(evaluate("POST", { "sec-fetch-site": "cross-site" })).toBe("fetch_site_cross_site");
  });

  it("OPTIONS sigue siempre", () => {
    expect(
      evaluate("OPTIONS", { "sec-fetch-site": "cross-site", origin: "https://atacante.ejemplo" }),
    ).toBeNull();
  });
});

describe("cabeceras reenviadas", () => {
  it("Host, X-Forwarded-*, y Forwarded no cambian el resultado", () => {
    const forged = {
      host: "atacante.ejemplo",
      "x-forwarded-host": "atacante.ejemplo",
      "x-forwarded-proto": "https",
      forwarded: "host=atacante.ejemplo;proto=https",
    };
    expect(evaluate("POST", { ...forged, origin: "https://atacante.ejemplo" })).toBe(
      "origin_mismatch",
    );
    expect(evaluate("POST", { ...forged, origin: CANONICAL })).toBeNull();
  });
});

describe("canonicalOrigin", () => {
  it("descarta la ruta, la consulta y el puerto por defecto", () => {
    expect(canonicalOrigin("https://facturas.ejemplo.test:443/app?x=1")).toBe(CANONICAL);
    expect(canonicalOrigin("http://localhost:3000/")).toBe("http://localhost:3000");
  });

  it.each(["file:///etc/hosts", "ftp://facturas.ejemplo.test", "no es una url", ""])(
    "rechaza %j",
    (url) => {
      expect(() => canonicalOrigin(url)).toThrow();
    },
  );
});

describe("categoría de la ruta", () => {
  it("es el primer segmento cuando es un nombre de recurso", () => {
    expect(routeCategory("/documents/0b7c2a4e-5d1f-4a7e-9c2b-1f3e5d7a9b0c/print-requests")).toBe(
      "documents",
    );
    expect(routeCategory("/shipping-guides")).toBe("shipping-guides");
  });

  it.each([
    "/",
    "",
    "/0b7c2a4e-5d1f-4a7e-9c2b-1f3e5d7a9b0c",
    "/0999999999001",
    "/Documents",
    "/documents%2F1",
    `/${"a".repeat(41)}`,
  ])("no contiene identificadores: %j", (path) => {
    expect(routeCategory(path)).toBe("unknown");
  });
});
