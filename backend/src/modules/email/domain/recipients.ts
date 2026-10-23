// Destinatarios del correo de un comprobante (add-email-delivery, design D3; spec email-delivery,
// «Receptores de cada comprobante» y «Destino de prueba en el ambiente de Pruebas»). Los terceros
// salen del snapshot congelado del comprobante; sus correos, de los vigentes del tercero al enviar.
// En Pruebas la única dirección es el correo de prueba.
import type { DocumentType, Environment } from "@facturador/contracts";
import type { EmailFailureCode } from "./failures.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const record = (value: unknown, key: string): Record<string, unknown> | null => {
  const inner = isRecord(value) ? value[key] : undefined;
  return isRecord(inner) ? inner : null;
};

const text = (value: unknown, key: string): string | null => {
  const inner = isRecord(value) ? value[key] : undefined;
  return typeof inner === "string" && inner !== "" ? inner : null;
};

/** Los terceros receptores de un comprobante, tal como los congeló su snapshot. */
export type DocumentReceivers = Readonly<{ partyIds: readonly string[]; consumerFinal: boolean }>;

/**
 * - 01 factura: el comprador.
 * - 04 nota de crédito y 05 nota de débito: el comprador de la factura modificada, cuyo snapshot
 *   se pasa en `invoiceSnapshot` (las notas no guardan el tercero).
 * - 07 retención: el sujeto retenido. 03 liquidación: el proveedor.
 * - 06 guía: los destinatarios terceros y el transportista tercero; un traslado a un
 *   establecimiento propio o un transporte propio no aportan direcciones.
 */
export function receiversOf(
  documentType: DocumentType,
  snapshot: unknown,
  invoiceSnapshot: unknown = null,
): DocumentReceivers {
  const single = (party: Record<string, unknown> | null): DocumentReceivers => {
    const partyId = text(party, "partyId");
    return {
      partyIds: partyId ? [partyId] : [],
      consumerFinal: party?.consumerFinal === true,
    };
  };
  switch (documentType) {
    case "01":
      return single(record(snapshot, "buyer"));
    case "04":
    case "05":
      return single(record(invoiceSnapshot, "buyer"));
    case "07":
      return single(record(snapshot, "subject"));
    case "03":
      return single(record(snapshot, "supplier"));
    case "06": {
      const recipients =
        isRecord(snapshot) && Array.isArray(snapshot.recipients) ? snapshot.recipients : [];
      const partyIds = recipients
        .filter((recipient) => isRecord(recipient) && recipient.kind === "PARTY")
        .map((recipient) => text(recipient, "partyId"))
        .filter((partyId): partyId is string => partyId !== null);
      const transporter = record(snapshot, "transporter");
      const carrier = transporter?.source === "PARTY" ? text(transporter, "partyId") : null;
      return {
        partyIds: [...new Set(carrier ? [...partyIds, carrier] : partyIds)],
        consumerFinal: false,
      };
    }
  }
}

/** Las direcciones de un envío, o el motivo de no tener ninguna. */
export type ResolvedRecipients =
  | Readonly<{ kind: "ADDRESSES"; addresses: readonly string[]; testRedirect: boolean }>
  | Readonly<{ kind: "NONE"; reason: EmailFailureCode; testRedirect: boolean }>;

/** Sin repetir, sin distinguir mayúsculas, en el orden de los terceros y de sus correos. */
export function distinctAddresses(addresses: readonly string[]): string[] {
  const seen = new Set<string>();
  return addresses.filter((address) => {
    const key = address.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function resolveRecipients(
  input: Readonly<{
    environment: Environment;
    receivers: DocumentReceivers;
    /** Los correos vigentes de cada tercero receptor. */
    emailsByParty: ReadonlyMap<string, readonly string[]>;
    testRecipient: string | null;
  }>,
): ResolvedRecipients {
  if (input.environment === "TEST") {
    return input.testRecipient
      ? { kind: "ADDRESSES", addresses: [input.testRecipient], testRedirect: true }
      : { kind: "NONE", reason: "NO_TEST_RECIPIENT", testRedirect: true };
  }
  const addresses = distinctAddresses(
    input.receivers.partyIds.flatMap((partyId) => input.emailsByParty.get(partyId) ?? []),
  );
  if (addresses.length > 0) return { kind: "ADDRESSES", addresses, testRedirect: false };
  return {
    kind: "NONE",
    reason: input.receivers.consumerFinal ? "CONSUMER_FINAL" : "NO_ADDRESS",
    testRedirect: false,
  };
}
