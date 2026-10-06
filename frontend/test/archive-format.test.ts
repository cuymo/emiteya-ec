// Receptor de un comprobante en la bandeja (add-shipping-guides, tarea 1.3, design D21): el
// comprador, o en una guía de remisión el nombre de su único destinatario o "N destinatarios".
import { describe, expect, it } from "vitest";
import { receiverOf, recipientCountLabel } from "@/features/archive/archive-format";

describe("receptor de la bandeja", () => {
  it("un comprobante con comprador muestra su nombre y su identificación", () => {
    expect(
      receiverOf({
        buyer: { name: "EL PERNO CIA. LTDA.", identification: "0992877878001" },
        recipients: null,
      }),
    ).toEqual({ name: "EL PERNO CIA. LTDA.", identification: "0992877878001" });
  });

  it("una guía con un solo destinatario muestra su nombre", () => {
    expect(receiverOf({ buyer: null, recipients: { count: 1, name: "María Pérez" } })).toEqual({
      name: "María Pérez",
      identification: null,
    });
  });

  it("una guía con varios destinatarios no elige a ninguno como receptor", () => {
    expect(receiverOf({ buyer: null, recipients: { count: 4, name: null } })).toEqual({
      name: "4 destinatarios",
      identification: null,
    });
    expect(recipientCountLabel(1)).toBe("1 destinatario");
  });
});
