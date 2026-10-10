// Interruptor de la transmisión al SRI y su readiness (design D5): deshabilitada y lista, o
// habilitada solo con sus precondiciones. La política conservadora de tamaño siempre existe y no es
// una precondición (adopt-conservative-sri-transmission-size-policy-v1, design D4).
import { Registry } from "@prometheus-io/client";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createTransmissionSizeDiagnostics } from "../../src/modules/fiscal/infrastructure/transmission-size-diagnostics.ts";
import {
  createTransmissionGate,
  type SizePolicyState,
  type TransmissionPreconditions,
} from "../../src/modules/fiscal/infrastructure/transmission-gate.ts";
import { buildTestApp } from "../helpers.ts";

function gate(overrides: Partial<TransmissionPreconditions> = {}) {
  const warnings: unknown[] = [];
  const registry = new Registry();
  const created = createTransmissionGate(
    {
      enabled: true,
      workers: 2,
      endpointsValid: () => true,
      ...overrides,
    },
    {
      logger: { warn: (payload: unknown) => void warnings.push(payload), info: () => {} },
      registry,
    },
  );
  return { gate: created, warnings, registry };
}

/** La política del producto sin ninguna comprobación todavía. */
const POLICY_WITHOUT_CHECKS: SizePolicyState = {
  source: "PRODUCT_CONSERVATIVE_POLICY_V1",
  limitBytes: 40_000,
  lastCheck: null,
};

const readinessOf = (created: ReturnType<typeof gate>["gate"]) => async () => {
  const state = await created.refresh();
  return {
    ready: state.ready,
    details: { sriTransmission: state.enabled ? "enabled" : "disabled" },
  };
};

describe("interruptor de la transmisión al SRI", () => {
  it("deshabilitada, la instalación está lista, lo deja ver y pausa los jobs `sri.*`", async () => {
    const { gate: disabled, registry } = gate({ enabled: false });
    expect(await disabled.refresh()).toEqual({
      enabled: false,
      ready: true,
      missing: [],
      sizePolicy: POLICY_WITHOUT_CHECKS,
    });
    expect(disabled.open()).toBe(false);
    expect(disabled.pausedPrefixes()).toEqual(["sri."]);
    expect(await registry.metrics()).toMatch(/^sri_transmission_enabled 0$/m);

    const { app } = buildTestApp({ readiness: readinessOf(disabled) });
    const res = await request(app).get("/health/ready");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ready", sriTransmission: "disabled" });
  });

  it("deshabilitada sigue pausada aunque los comprobantes cumplan la política de tamaño", async () => {
    const diagnostics = createTransmissionSizeDiagnostics({ registry: new Registry() });
    diagnostics.observe({
      signedXmlBytes: 7_000,
      base64PayloadBytes: 9_336,
      soapRequestBytes: 9_616,
      allowed: true,
      blockReason: null,
    });
    const { gate: disabled } = gate({ enabled: false, lastSizeCheck: diagnostics.lastCheck });
    const state = await disabled.refresh();
    expect(state.enabled).toBe(false);
    expect(disabled.open()).toBe(false);
    expect(disabled.pausedPrefixes()).toEqual(["sri."]);
  });

  it("habilitada exige al menos un worker y endpoints válidos; si falta uno no está lista y lo registra una vez", async () => {
    const { gate: missing, warnings, registry } = gate({ workers: 0, endpointsValid: () => false });
    expect(await missing.refresh()).toEqual({
      enabled: true,
      ready: false,
      missing: ["workers", "endpoints"],
      sizePolicy: POLICY_WITHOUT_CHECKS,
    });
    await missing.refresh();
    expect(warnings).toEqual([{ missing: ["workers", "endpoints"] }]);
    expect(missing.pausedPrefixes()).toEqual(["sri."]);
    expect(await registry.metrics()).toMatch(/^sri_transmission_enabled 1$/m);

    const { app } = buildTestApp({ readiness: readinessOf(missing) });
    const res = await request(app).get("/health/ready");
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: "unavailable", sriTransmission: "enabled" });
  });

  it("habilitada con sus precondiciones está lista sin cargar ninguna política de tamaño", async () => {
    const { gate: enabled } = gate();
    expect(enabled.open()).toBe(false);
    expect(await enabled.refresh()).toEqual({
      enabled: true,
      ready: true,
      missing: [],
      sizePolicy: POLICY_WITHOUT_CHECKS,
    });
    expect(enabled.open()).toBe(true);
    expect(enabled.pausedPrefixes()).toEqual([]);
  });
});

describe("política de tamaño en la readiness (adopt-conservative-sri-transmission-size-policy-v1)", () => {
  it("la fuente es siempre PRODUCT_CONSERVATIVE_POLICY_V1, nunca una política oficial del SRI", async () => {
    for (const enabled of [true, false]) {
      const state = await gate({ enabled }).gate.refresh();
      expect(state.sizePolicy.source).toBe("PRODUCT_CONSERVATIVE_POLICY_V1");
      expect(state.sizePolicy.limitBytes).toBe(40_000);
      expect(JSON.stringify(state)).not.toContain("SRI_OFFICIAL_POLICY");
    }
  });

  it("el estado de salud publica solo el límite, las tres medidas, si se permitió y el motivo", async () => {
    const diagnostics = createTransmissionSizeDiagnostics({ registry: new Registry() });
    diagnostics.observe({
      signedXmlBytes: 30_000,
      base64PayloadBytes: 40_000,
      soapRequestBytes: 40_280,
      allowed: false,
      blockReason: "TRANSMISSION_SIZE_POLICY_EXCEEDED",
    });
    const { gate: created } = gate({ lastSizeCheck: diagnostics.lastCheck });
    const { app } = buildTestApp({
      readiness: async () => {
        const state = await created.refresh();
        return { ready: state.ready, details: { sriSizePolicy: state.sizePolicy } };
      },
    });
    const res = await request(app).get("/health/ready");
    expect(res.status).toBe(200);
    expect((res.body as { sriSizePolicy: unknown }).sriSizePolicy).toEqual({
      source: "PRODUCT_CONSERVATIVE_POLICY_V1",
      limitBytes: 40_000,
      lastCheck: {
        signedXmlBytes: 30_000,
        base64PayloadBytes: 40_000,
        soapRequestBytes: 40_280,
        allowed: false,
        blockReason: "TRANSMISSION_SIZE_POLICY_EXCEEDED",
      },
    });
    expect(JSON.stringify(res.body)).not.toMatch(
      /accessKey|ruc|documentNumber|fiscalEnvironment|xml>|Envelope/i,
    );
  });

  it("la métrica cuenta los bloqueos sin etiquetas y nace en 0", async () => {
    const registry = new Registry();
    const diagnostics = createTransmissionSizeDiagnostics({ registry });
    expect(await registry.metrics()).toMatch(/^sri_transmission_size_policy_blocks_total 0$/m);
    const sizes = { signedXmlBytes: 1, base64PayloadBytes: 1, soapRequestBytes: 40_000 };
    diagnostics.observe({ ...sizes, soapRequestBytes: 1, allowed: true, blockReason: null });
    diagnostics.observe({
      ...sizes,
      allowed: false,
      blockReason: "TRANSMISSION_SIZE_POLICY_EXCEEDED",
    });
    diagnostics.observe({
      ...sizes,
      allowed: false,
      blockReason: "TRANSMISSION_SIZE_POLICY_EXCEEDED",
    });
    const text = await registry.metrics();
    expect(text).toMatch(/^sri_transmission_size_policy_blocks_total 2$/m);
    expect(text).not.toMatch(/sri_transmission_size_policy_blocks_total\{/);
    expect(text).not.toContain("sri_certification");
    expect(diagnostics.lastCheck()?.allowed).toBe(false);
  });
});
