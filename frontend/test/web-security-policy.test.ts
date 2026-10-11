// Política de seguridad del navegador (enforce-frontend-security-headers-csp, design D1, D3, D4, D6
// y D10): estructura del nonce, directivas de producción y de desarrollo, y cabeceras del documento.
import { describe, expect, it } from "vitest";
import {
  contentSecurityPolicy,
  createNonce,
  documentSecurityHeaders,
  isValidNonce,
} from "@/lib/web-security-policy";

/** Directivas de una política: nombre → fuentes. */
function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy.split(";").map((part) => {
      const [name = "", ...sources] = part.trim().split(/\s+/);
      return [name, sources] as const;
    }),
  );
}

const SCRIPT_DIRECTIVES = ["script-src", "script-src-elem", "script-src-attr"];

describe("nonce de la política", () => {
  it("decodifica a 16 bytes en base64 estándar, y dos llamadas no lo repiten", () => {
    const first = createNonce();
    const second = createNonce();
    expect(first).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(atob(first)).toHaveLength(16);
    expect(isValidNonce(first)).toBe(true);
    expect(second).not.toBe(first);
  });

  it.each([
    "",
    "abc",
    "AAAAAAAAAAAAAAAAAAAA",
    "AAAAAAAAAAAAAAAAAAAAAA==".replace("A", "-"),
    "nonce con espacios==",
  ])("rechaza un nonce vacío, corto o fuera de base64: %j", (nonce) => {
    expect(isValidNonce(nonce)).toBe(false);
    expect(() => contentSecurityPolicy(nonce, "production")).toThrow();
  });
});

describe("política de producción", () => {
  const nonce = createNonce();
  const policy = directives(contentSecurityPolicy(nonce, "production"));

  it("endurece objetos, base, formularios, enmarcado, manejadores en atributos y marcos", () => {
    expect(policy.get("default-src")).toEqual(["'self'"]);
    expect(policy.get("object-src")).toEqual(["'none'"]);
    expect(policy.get("base-uri")).toEqual(["'self'"]);
    expect(policy.get("form-action")).toEqual(["'none'"]);
    expect(policy.get("frame-ancestors")).toEqual(["'none'"]);
    expect(policy.get("script-src-attr")).toEqual(["'none'"]);
    expect(policy.get("frame-src")).toEqual(["blob:"]);
    expect(policy.get("connect-src")).toEqual(["'self'"]);
    expect(policy.get("img-src")).toEqual(["'self'"]);
    expect(policy.get("font-src")).toEqual(["'self'"]);
  });

  it("autoriza los scripts solo con el nonce y strict-dynamic, sin unsafe-inline ni unsafe-eval", () => {
    expect(policy.get("script-src")).toEqual(["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"]);
    for (const name of SCRIPT_DIRECTIVES) {
      expect(policy.get(name) ?? []).not.toContain("'unsafe-inline'");
      expect(policy.get(name) ?? []).not.toContain("'unsafe-eval'");
    }
  });

  it("limita unsafe-inline a los elementos <style>, con los atributos style bloqueados", () => {
    for (const [name, sources] of policy) {
      if (sources.includes("'unsafe-inline'")) expect(name).toBe("style-src-elem");
    }
    expect(policy.get("style-src")).toEqual(["'self'"]);
    expect(policy.get("style-src-elem")).toEqual(["'self'", "'unsafe-inline'"]);
    expect(policy.get("style-src-attr")).toEqual(["'none'"]);
  });

  it("no tiene comodines ni esquemas completos, y blob: solo va en frame-src", () => {
    for (const [name, sources] of policy) {
      expect(sources).not.toContain("*");
      expect(sources).not.toContain("https:");
      expect(sources).not.toContain("http:");
      if (name !== "frame-src") expect(sources).not.toContain("blob:");
      expect(sources).not.toContain("data:");
    }
  });
});

describe("política de desarrollo", () => {
  it("añade solo unsafe-eval a script-src y conserva el endurecimiento", () => {
    const nonce = createNonce();
    const production = directives(contentSecurityPolicy(nonce, "production"));
    const development = directives(contentSecurityPolicy(nonce, "development"));
    expect(development.get("script-src")).toEqual([
      ...(production.get("script-src") ?? []),
      "'unsafe-eval'",
    ]);
    for (const name of ["object-src", "base-uri", "script-src-attr", "frame-ancestors"]) {
      expect(development.get(name)).toEqual(production.get(name));
    }
    const others = [...development.keys()].filter((name) => name !== "script-src");
    for (const name of others) expect(development.get(name)).toEqual(production.get(name));
  });
});

describe("cabeceras del documento", () => {
  it("lleva la política y las cuatro cabeceras, sin Strict-Transport-Security", () => {
    const nonce = createNonce();
    const headers = documentSecurityHeaders(nonce, "production");
    expect(headers["Content-Security-Policy"]).toBe(contentSecurityPolicy(nonce, "production"));
    expect(headers["Referrer-Policy"]).toBe("same-origin");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Cross-Origin-Opener-Policy"]).toBe("same-origin");
    const permissions = headers["Permissions-Policy"]?.split(", ") ?? [];
    for (const feature of ["camera", "microphone", "geolocation", "payment"]) {
      expect(permissions).toContain(`${feature}=()`);
    }
    expect(Object.keys(headers).map((name) => name.toLowerCase())).not.toContain(
      "strict-transport-security",
    );
    expect(Object.keys(headers)).not.toContain("Content-Security-Policy-Report-Only");
  });
});
