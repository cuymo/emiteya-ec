// Política de salida de la sesión de certificación (docs/quality/sri-egress-allowlist.md), sin red.
import { describe, expect, it } from "vitest";
import { decideEgress, isProductionHost } from "./policy.ts";
import { POLICY_MATRIX } from "./session.ts";

describe("política de salida de la certificación en Pruebas", () => {
  it.each(POLICY_MATRIX)("%s %s → %s", (method, target, expected) => {
    const result = decideEgress(method, target);
    expect(result.reason).toBe(expected);
    expect(result.allowed).toBe(expected === "ALLOWED_SRI_TEST");
  });

  it("solo admite exactamente CONNECT celcer.sri.gob.ec:443", () => {
    expect(decideEgress("CONNECT", "celcer.sri.gob.ec:443")).toEqual({
      allowed: true,
      reason: "ALLOWED_SRI_TEST",
      host: "celcer.sri.gob.ec",
      port: 443,
    });
    for (const target of [
      "celcer.sri.gob.ec:8443",
      "xcelcer.sri.gob.ec:443",
      "celcer.sri.gob.ec.attacker.test:443",
      "localhost:443",
      "127.0.0.1:5432",
    ]) {
      expect(decideEgress("CONNECT", target).allowed, target).toBe(false);
    }
  });

  it("reconoce Producción en cualquier forma, antes que el método", () => {
    for (const host of ["cel.sri.gob.ec", "CEL.SRI.GOB.EC", "cel.sri.gob.ec."]) {
      expect(isProductionHost(host), host).toBe(true);
      expect(decideEgress("CONNECT", `${host}:443`).reason).toBe("PRODUCTION_ACCESS_BLOCKED");
    }
    expect(decideEgress("POST", "https://cel.sri.gob.ec/").reason).toBe(
      "PRODUCTION_ACCESS_BLOCKED",
    );
    expect(isProductionHost("celcer.sri.gob.ec")).toBe(false);
  });

  it("un destino malformado se rechaza", () => {
    for (const target of [
      "",
      "celcer.sri.gob.ec",
      "celcer.sri.gob.ec:0",
      "celcer.sri.gob.ec:99999",
      "a b:443",
    ]) {
      expect(decideEgress("CONNECT", target).reason, target).toBe("MALFORMED_TARGET");
    }
  });
});
