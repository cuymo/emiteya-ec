import { describe, expect, it } from "vitest";
import { receiversOf, resolveRecipients } from "../../src/modules/email/domain/recipients.ts";

// Destinatarios por tipo y por ambiente (add-email-delivery, design D3; spec email-delivery,
// «Receptores de cada comprobante» y «Destino de prueba en el ambiente de Pruebas»).
const emails = new Map<string, readonly string[]>([
  ["comprador", ["compras@cliente.ec", "Contabilidad@cliente.ec"]],
  ["proveedor", ["juan@proveedor.ec"]],
  ["destinatario-1", ["bodega@uno.ec"]],
  ["destinatario-2", ["recepcion@dos.ec", "compras@cliente.ec"]],
  ["transportista", ["despacho@transporte.ec"]],
  ["sin-correo", []],
]);
const production = (
  receivers: ReturnType<typeof receiversOf>,
  testRecipient: string | null = null,
) =>
  resolveRecipients({ environment: "PRODUCTION", receivers, emailsByParty: emails, testRecipient });

describe("receptores de cada comprobante", () => {
  it("factura: el comprador con todos sus correos", () => {
    const receivers = receiversOf("01", { buyer: { partyId: "comprador", consumerFinal: false } });
    expect(production(receivers)).toEqual({
      kind: "ADDRESSES",
      addresses: ["compras@cliente.ec", "Contabilidad@cliente.ec"],
      testRedirect: false,
    });
  });

  it("nota de crédito y de débito: el comprador de la factura modificada", () => {
    const invoice = { buyer: { partyId: "comprador", consumerFinal: false } };
    for (const type of ["04", "05"] as const) {
      const receivers = receiversOf(
        type,
        { buyer: { legalName: "Comercial" }, invoice: { id: "f1" } },
        invoice,
      );
      expect(receivers.partyIds).toEqual(["comprador"]);
    }
  });

  it("retención y liquidación: el proveedor", () => {
    expect(receiversOf("07", { subject: { partyId: "proveedor" } }).partyIds).toEqual([
      "proveedor",
    ]);
    expect(receiversOf("03", { supplier: { partyId: "proveedor" } }).partyIds).toEqual([
      "proveedor",
    ]);
    expect(production(receiversOf("07", { subject: { partyId: "proveedor" } }))).toMatchObject({
      addresses: ["juan@proveedor.ec"],
    });
  });

  it("guía: los destinatarios terceros y el transportista, sin el establecimiento propio ni repetidos", () => {
    const receivers = receiversOf("06", {
      recipients: [
        { position: 1, kind: "PARTY", partyId: "destinatario-1" },
        { position: 2, kind: "OWN_COMPANY", partyId: null },
        { position: 3, kind: "PARTY", partyId: "destinatario-2" },
      ],
      transporter: { source: "PARTY", partyId: "transportista" },
    });
    expect(receivers.partyIds).toEqual(["destinatario-1", "destinatario-2", "transportista"]);
    expect(production(receivers)).toMatchObject({
      addresses: [
        "bodega@uno.ec",
        "recepcion@dos.ec",
        "compras@cliente.ec",
        "despacho@transporte.ec",
      ],
    });
  });

  it("guía con transporte propio: solo los destinatarios", () => {
    const receivers = receiversOf("06", {
      recipients: [{ kind: "PARTY", partyId: "destinatario-1" }],
      transporter: { source: "SELF", partyId: null },
    });
    expect(receivers.partyIds).toEqual(["destinatario-1"]);
  });

  it("direcciones repetidas entre terceros se envían una vez, sin distinguir mayúsculas", () => {
    const receivers = { partyIds: ["comprador", "destinatario-2"], consumerFinal: false };
    expect(production(receivers)).toMatchObject({
      addresses: ["compras@cliente.ec", "Contabilidad@cliente.ec", "recepcion@dos.ec"],
    });
  });

  it("sin correo, o el consumidor final: sin destinatario con su motivo", () => {
    expect(
      production(receiversOf("01", { buyer: { partyId: "sin-correo", consumerFinal: false } })),
    ).toEqual({
      kind: "NONE",
      reason: "NO_ADDRESS",
      testRedirect: false,
    });
    expect(
      production(receiversOf("01", { buyer: { partyId: "cf", consumerFinal: true } })),
    ).toEqual({
      kind: "NONE",
      reason: "CONSUMER_FINAL",
      testRedirect: false,
    });
  });
});

describe("destino de prueba en el ambiente de Pruebas", () => {
  const receivers = receiversOf("01", { buyer: { partyId: "comprador", consumerFinal: false } });

  it("solo al correo de prueba, nunca al receptor", () => {
    expect(
      resolveRecipients({
        environment: "TEST",
        receivers,
        emailsByParty: emails,
        testRecipient: "revision@empresa.ec",
      }),
    ).toEqual({ kind: "ADDRESSES", addresses: ["revision@empresa.ec"], testRedirect: true });
  });

  it("sin correo de prueba no se envía", () => {
    expect(
      resolveRecipients({
        environment: "TEST",
        receivers,
        emailsByParty: emails,
        testRecipient: null,
      }),
    ).toEqual({ kind: "NONE", reason: "NO_TEST_RECIPIENT", testRedirect: true });
  });

  it("en Producción el correo de prueba no se usa", () => {
    expect(production(receivers, "revision@empresa.ec")).toMatchObject({
      addresses: ["compras@cliente.ec", "Contabilidad@cliente.ec"],
      testRedirect: false,
    });
  });
});
