// Proxy de Next.js que escribe las cabeceras de seguridad de cada documento
// (enforce-frontend-security-headers-csp, design D1 y D8).
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { isValidNonce } from "@/lib/web-security-policy";
import { config, proxy } from "@/proxy";

function nonceOf(policy: string | null): string {
  const match = /'nonce-([^']+)'/.exec(policy ?? "");
  if (!match?.[1]) throw new Error("La política no lleva nonce.");
  return match[1];
}

describe("proxy de las cabeceras de seguridad", () => {
  it("da a cada documento un nonce nuevo y válido", () => {
    const first = proxy(new NextRequest("http://localhost:3000/facturas"));
    const second = proxy(new NextRequest("http://localhost:3000/facturas"));
    const a = nonceOf(first.headers.get("Content-Security-Policy"));
    const b = nonceOf(second.headers.get("Content-Security-Policy"));
    expect(isValidNonce(a)).toBe(true);
    expect(isValidNonce(b)).toBe(true);
    expect(a).not.toBe(b);
  });

  it("escribe la misma política, con el mismo nonce, en la petición y en la respuesta", () => {
    const response = proxy(new NextRequest("http://localhost:3000/iniciar-sesion"));
    const policy = response.headers.get("Content-Security-Policy");
    // Next.js transmite las cabeceras reemplazadas de la petición con el prefijo x-middleware-request-.
    expect(response.headers.get("x-middleware-request-content-security-policy")).toBe(policy);
    expect(response.headers.get("x-middleware-request-x-nonce")).toBe(nonceOf(policy));
  });

  it("ignora un nonce enviado por el cliente", () => {
    const request = new NextRequest("http://localhost:3000/facturas", {
      headers: { "x-nonce": "AAAAAAAAAAAAAAAAAAAAAA==" },
    });
    const response = proxy(request);
    const nonce = nonceOf(response.headers.get("Content-Security-Policy"));
    expect(nonce).not.toBe("AAAAAAAAAAAAAAAAAAAAAA==");
    expect(response.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
  });

  it("lleva las cabeceras del documento, sin Strict-Transport-Security", () => {
    const response = proxy(new NextRequest("http://localhost:3000/comprobantes"));
    expect(response.headers.get("Referrer-Policy")).toBe("same-origin");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(response.headers.get("Permissions-Policy")).toContain("camera=()");
    expect(response.headers.get("Strict-Transport-Security")).toBeNull();
    expect(response.headers.get("Content-Security-Policy-Report-Only")).toBeNull();
  });

  it("no cubre la API ni los recursos estáticos", () => {
    const [entry] = config.matcher;
    const pattern = new RegExp(`^${entry!.source}$`);
    for (const path of ["/", "/iniciar-sesion", "/facturas/abc", "/configuracion/firma"]) {
      expect(pattern.test(path)).toBe(true);
    }
    for (const path of [
      "/api/v1/me",
      "/api/auth/sign-in/email",
      "/_next/static/chunks/app.js",
      "/_next/image",
      "/favicon.ico",
    ]) {
      expect(pattern.test(path)).toBe(false);
    }
    expect(entry!.missing.map((header) => header.key)).toEqual(["next-router-prefetch", "purpose"]);
  });
});
