import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXPIRY_ALERT_DAYS,
  daysToExpiry,
  deriveValidity,
  rucMatch,
} from "../../src/modules/signing/domain/certificate.ts";

const DAY = 86_400_000;
const notAfter = new Date("2027-01-31T00:00:00.000Z");
const at = (offsetMs: number) => new Date(notAfter.getTime() + offsetMs);
const validity = (
  now: Date,
  overrides: { expiryAlertDays?: number; keyAvailable?: boolean } = {},
) => deriveValidity({ notAfter, now, expiryAlertDays: 30, keyAvailable: true, ...overrides });

describe("vigencia derivada (design D8)", () => {
  it("la anticipación por defecto es de 30 días", () => {
    expect(DEFAULT_EXPIRY_ALERT_DAYS).toBe(30);
  });

  it("lejos del vencimiento es VALID y utilizable", () => {
    expect(validity(at(-31 * DAY))).toEqual({ state: "VALID", daysToExpiry: 31, usable: true });
  });

  it("el día de la anticipación: exactamente 30 días es VALID y un instante después, EXPIRING", () => {
    expect(validity(at(-30 * DAY)).state).toBe("VALID");
    expect(validity(at(-30 * DAY + 1))).toEqual({
      state: "EXPIRING",
      daysToExpiry: 30,
      usable: true,
    });
  });

  it("justo al vencer sigue utilizable y un milisegundo después está EXPIRED", () => {
    expect(validity(at(0))).toEqual({ state: "EXPIRING", daysToExpiry: 0, usable: true });
    expect(validity(at(1))).toEqual({ state: "EXPIRED", daysToExpiry: 0, usable: false });
    expect(validity(at(2 * DAY)).daysToExpiry).toBe(-2);
  });

  it("sin clave de custodia o con la custodia deshabilitada es KEY_UNAVAILABLE y no utilizable", () => {
    expect(validity(at(-200 * DAY), { keyAvailable: false })).toEqual({
      state: "KEY_UNAVAILABLE",
      daysToExpiry: 200,
      usable: false,
    });
  });

  it("vencida prevalece sobre la clave no disponible", () => {
    expect(validity(at(DAY), { keyAvailable: false }).state).toBe("EXPIRED");
  });

  it("la anticipación configurada desplaza el aviso", () => {
    expect(validity(at(-40 * DAY), { expiryAlertDays: 45 }).state).toBe("EXPIRING");
    expect(validity(at(-40 * DAY), { expiryAlertDays: 30 }).state).toBe("VALID");
  });

  it("los días que faltan se redondean hacia arriba", () => {
    expect(daysToExpiry(notAfter, at(-1))).toBe(1);
    expect(daysToExpiry(notAfter, at(-DAY - 1))).toBe(2);
  });
});

describe("coincidencia del RUC (design D4, Q-17)", () => {
  it("MATCH, MISMATCH y PENDING sin RUC de la empresa", () => {
    expect(rucMatch("1790012345001", "1790012345001")).toBe("MATCH");
    expect(rucMatch("1790012345001", "0992877878001")).toBe("MISMATCH");
    expect(rucMatch("1790012345001", null)).toBe("PENDING");
  });
});
