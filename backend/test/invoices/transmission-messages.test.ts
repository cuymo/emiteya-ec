// Motivos de una transmisión detenida (add-sri-transmission, design D18 y D20): cada código tiene su
// frase de negocio, sin datos técnicos, y un código desconocido recibe la genérica.
import { describe, expect, it } from "vitest";
import { TRANSMISSION_STOP_CODES } from "../../src/modules/fiscal/domain/transmission.ts";
import { stopMessage } from "../../src/modules/invoices/application/transmission-messages.ts";

describe("motivo de una transmisión detenida", () => {
  it("cada código tiene su frase, sin XML, SOAP ni códigos técnicos, y solo dice qué pasó", () => {
    const messages = TRANSMISSION_STOP_CODES.map((code) => stopMessage(code));
    expect(new Set(messages).size).toBe(TRANSMISSION_STOP_CODES.length);
    for (const message of messages) {
      expect(message).not.toMatch(/<|soap|_|\bReconcilia\b/i);
    }
    expect(stopMessage("INTEGRITY_FAILED")).toBe(
      "El XML firmado guardado no superó la comprobación de integridad. No se envió nada al SRI; requiere soporte.",
    );
  });

  it("la política de tamaño habla del límite de EmiteYa, nunca de un límite del SRI (adopt-conservative-sri-transmission-size-policy-v1)", () => {
    const message = stopMessage("TRANSMISSION_SIZE_POLICY_EXCEEDED");
    expect(message).toBe(
      "El comprobante excede el límite de seguridad de transmisión de EmiteYa. Reduzca el contenido antes de enviarlo.",
    );
    expect(message).not.toMatch(/SRI|KB|40/);
  });

  it("los motivos retirados ya no existen y reciben el mensaje genérico", () => {
    for (const code of [
      "TOO_LARGE",
      "SIZE_POLICY_MISSING",
      "CERTIFICATION_SIZE_CAP_EXCEEDED",
      "CERTIFICATION_ENVIRONMENT_NOT_TEST",
    ]) {
      expect(TRANSMISSION_STOP_CODES).not.toContain(code);
      expect(stopMessage(code)).toBe("La transmisión se detuvo.");
    }
  });

  it("un código desconocido recibe el mensaje genérico", () => {
    expect(stopMessage("ALGO_NUEVO")).toBe("La transmisión se detuvo.");
  });
});
