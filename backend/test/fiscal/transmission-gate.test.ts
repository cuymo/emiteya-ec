// Interruptor de la transmisión al SRI y su readiness (design D5): deshabilitada y lista, o
// habilitada solo con sus precondiciones.
import { Registry } from "@prometheus-io/client";
import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  createTransmissionGate,
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
    expect(await disabled.refresh()).toEqual({ enabled: false, ready: true, missing: [] });
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
    expect(await enabled.refresh()).toEqual({ enabled: true, ready: true, missing: [] });
    expect(enabled.open()).toBe(true);
    expect(enabled.pausedPrefixes()).toEqual([]);
  });
});
