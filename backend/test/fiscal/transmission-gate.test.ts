// Interruptor de la transmisión al SRI y su readiness (design D5): deshabilitada y lista, o
// habilitada solo con sus precondiciones.
import { Registry } from "@prometheus-io/client";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createCertificationSession } from "../../src/modules/fiscal/infrastructure/certification-session.ts";
import {
  createTransmissionGate,
  type SizeGateState,
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
      sizePolicyAvailable: () => Promise.resolve(true),
      ...overrides,
    },
    {
      logger: { warn: (payload: unknown) => void warnings.push(payload), info: () => {} },
      registry,
    },
  );
  return { gate: created, warnings, registry };
}

/** Estado de tamaño sin la sesión de certificación, con o sin política oficial. */
const officialOnly = (official: boolean): SizeGateState => ({
  certificationSafetyCapEnabled: false,
  capBytes: 40_000,
  effectiveSizePolicySource: official ? "SRI_OFFICIAL_POLICY" : "MISSING",
  lastCertificationCheck: null,
});

const readinessOf = (created: ReturnType<typeof gate>["gate"]) => async () => {
  const state = await created.refresh();
  return {
    ready: state.ready,
    details: { sriTransmission: state.enabled ? "enabled" : "disabled" },
  };
};

describe("interruptor de la transmisión al SRI", () => {
  it("deshabilitada, la instalación está lista, lo deja ver y pausa los jobs `sri.*`", async () => {
    const { gate: disabled, registry } = gate({
      enabled: false,
      sizePolicyAvailable: () => Promise.resolve(false),
    });
    expect(await disabled.refresh()).toEqual({
      enabled: false,
      ready: true,
      missing: [],
      sizeGate: officialOnly(false),
    });
    expect(disabled.open()).toBe(false);
    expect(disabled.pausedPrefixes()).toEqual(["sri."]);
    expect(await registry.metrics()).toMatch(/^sri_transmission_enabled 0$/m);

    const { app } = buildTestApp({ readiness: readinessOf(disabled) });
    const res = await request(app).get("/health/ready");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ready", sriTransmission: "disabled" });
  });

  it("habilitada sin política de tamaño no está lista, lo registra una vez y sigue pausada", async () => {
    const {
      gate: enabled,
      warnings,
      registry,
    } = gate({ sizePolicyAvailable: () => Promise.resolve(false) });
    expect(await enabled.refresh()).toEqual({
      enabled: true,
      ready: false,
      missing: ["size-policy"],
      sizeGate: officialOnly(false),
    });
    await enabled.refresh();
    expect(warnings).toEqual([{ missing: ["size-policy"] }]);
    expect(enabled.pausedPrefixes()).toEqual(["sri."]);
    expect(await registry.metrics()).toMatch(/^sri_transmission_enabled 1$/m);

    const { app } = buildTestApp({ readiness: readinessOf(enabled) });
    const res = await request(app).get("/health/ready");
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: "unavailable", sriTransmission: "enabled" });
  });

  it("habilitada exige al menos un worker, endpoints válidos y la política; una lectura que falla no la abre", async () => {
    const { gate: noWorkers } = gate({ workers: 0, endpointsValid: () => false });
    expect((await noWorkers.refresh()).missing).toEqual(["workers", "endpoints"]);
    const { gate: failing } = gate({
      sizePolicyAvailable: () => Promise.reject(new Error("sin base")),
    });
    expect((await failing.refresh()).missing).toEqual(["size-policy"]);
    expect(failing.open()).toBe(false);
  });

  it("habilitada con sus precondiciones está lista y deja tomar los jobs `sri.*`", async () => {
    const { gate: enabled } = gate();
    expect(enabled.open()).toBe(false);
    expect(await enabled.refresh()).toEqual({
      enabled: true,
      ready: true,
      missing: [],
      sizeGate: officialOnly(true),
    });
    expect(enabled.open()).toBe(true);
    expect(enabled.pausedPrefixes()).toEqual([]);
  });
});

describe("sesión de certificación en la readiness (add-sri-certification-safety-cap)", () => {
  it("la fuente efectiva distingue la política oficial, el tope, los dos y ninguno", async () => {
    const cases = [
      [true, false, "SRI_OFFICIAL_POLICY", true],
      [false, true, "CERTIFICATION_CONSERVATIVE_CAP", true],
      [true, true, "SRI_OFFICIAL_AND_CERTIFICATION_CAP", true],
      [false, false, "MISSING", false],
    ] as const;
    for (const [official, cap, source, ready] of cases) {
      const { gate: created } = gate({
        sizePolicyAvailable: () => Promise.resolve(official),
        certificationSafetyCap: cap,
      });
      const state = await created.refresh();
      expect(state.sizeGate).toMatchObject({
        certificationSafetyCapEnabled: cap,
        capBytes: 40_000,
        effectiveSizePolicySource: source,
      });
      expect(state.ready).toBe(ready);
      expect(state.missing.includes("size-policy")).toBe(!ready);
    }
  });

  it("la sesión no habilita la transmisión: deshabilitada sigue pausada aunque la sesión esté activa", async () => {
    const { gate: disabled } = gate({ enabled: false, certificationSafetyCap: true });
    const state = await disabled.refresh();
    expect(state.enabled).toBe(false);
    expect(disabled.pausedPrefixes()).toEqual(["sri."]);
    expect(state.sizeGate.certificationSafetyCapEnabled).toBe(true);
  });

  it("el estado de salud publica la sesión y la última comprobación sin identificar el comprobante", async () => {
    const registry = new Registry();
    const session = createCertificationSession({ enabled: true, registry });
    session.observe({
      fiscalEnvironment: "TEST",
      allowed: true,
      reason: null,
      sizes: { signedXmlBytes: 7_000, base64PayloadBytes: 9_336, soapRequestBytes: 9_616 },
      capBytes: 40_000,
      effectiveSizePolicySource: "CERTIFICATION_CONSERVATIVE_CAP",
      at: new Date("2026-10-09T12:00:00.000Z"),
    });
    const { gate: created } = gate({
      sizePolicyAvailable: () => Promise.resolve(false),
      certificationSafetyCap: true,
      lastCertificationCheck: session.lastCheck,
    });
    const { app } = buildTestApp({
      readiness: async () => {
        const state = await created.refresh();
        return { ready: state.ready, details: { sriSizeGate: state.sizeGate } };
      },
    });
    const res = await request(app).get("/health/ready");
    expect(res.status).toBe(200);
    expect((res.body as { sriSizeGate: unknown }).sriSizeGate).toEqual({
      certificationSafetyCapEnabled: true,
      capBytes: 40_000,
      effectiveSizePolicySource: "CERTIFICATION_CONSERVATIVE_CAP",
      lastCertificationCheck: {
        fiscalEnvironment: "TEST",
        allowed: true,
        reason: null,
        sizes: { signedXmlBytes: 7_000, base64PayloadBytes: 9_336, soapRequestBytes: 9_616 },
        capBytes: 40_000,
        effectiveSizePolicySource: "CERTIFICATION_CONSERVATIVE_CAP",
        at: "2026-10-09T12:00:00.000Z",
      },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/accessKey|ruc|documentNumber|xml>|Envelope/i);
  });

  it("las métricas cuentan los bloqueos por motivo con una sola etiqueta de dos valores", async () => {
    const registry = new Registry();
    const session = createCertificationSession({ enabled: true, registry });
    const base = {
      fiscalEnvironment: "TEST" as const,
      sizes: null,
      capBytes: 40_000,
      effectiveSizePolicySource: null,
      at: new Date(0),
    };
    session.observe({ ...base, allowed: true, reason: null });
    session.observe({ ...base, allowed: false, reason: "CERTIFICATION_SIZE_CAP_EXCEEDED" });
    session.observe({
      ...base,
      fiscalEnvironment: "PRODUCTION",
      allowed: false,
      reason: "CERTIFICATION_ENVIRONMENT_NOT_TEST",
    });
    session.observe({ ...base, allowed: false, reason: "CERTIFICATION_SIZE_CAP_EXCEEDED" });
    const text = await registry.metrics();
    expect(text).toMatch(/^sri_certification_safety_cap_enabled 1$/m);
    expect(text).toMatch(/^sri_certification_gate_blocks_total\{reason="SIZE_CAP_EXCEEDED"\} 2$/m);
    expect(text).toMatch(
      /^sri_certification_gate_blocks_total\{reason="ENVIRONMENT_NOT_TEST"\} 1$/m,
    );
    expect(text.match(/^sri_certification_gate_blocks_total\{/gm)).toHaveLength(2);
    expect(session.lastCheck()?.reason).toBe("CERTIFICATION_SIZE_CAP_EXCEEDED");
  });

  it("sin la sesión, la métrica vale 0 y los contadores nacen en 0", async () => {
    const registry = new Registry();
    createCertificationSession({ enabled: false, registry });
    const text = await registry.metrics();
    expect(text).toMatch(/^sri_certification_safety_cap_enabled 0$/m);
    expect(text).toMatch(/^sri_certification_gate_blocks_total\{reason="SIZE_CAP_EXCEEDED"\} 0$/m);
  });
});
