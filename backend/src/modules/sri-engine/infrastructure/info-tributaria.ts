// `infoTributaria` común a los comprobantes que el sistema emite (add-credit-notes, design D12):
// el mismo bloque y el mismo orden del XSD en la factura y en la nota de crédito, con el tipo del
// comprobante (`codDoc`) como dato. Lo extrajo el builder de la factura sin cambiar su salida.
import type { DocumentType } from "@facturador/contracts";
import type { InvoiceSnapshot } from "../application/ports.ts";
import { element, leaf, optionalLeaf, type XmlNode } from "./xml-writer.ts";

// Fuera de línea, el tipo de emisión es siempre normal (CTX §8.2).
const EMISSION_TYPE = "1";
// Único valor que admite el tipo `contribuyenteRimpe` del XSD.
const RIMPE_LEGEND = "CONTRIBUYENTE RÉGIMEN RIMPE";

export type InfoTributariaInput = Pick<
  InvoiceSnapshot,
  "environment" | "accessKey" | "sequential" | "issuer"
>;

export function infoTributaria(input: InfoTributariaInput, documentType: DocumentType): XmlNode {
  const { issuer } = input;
  return element("infoTributaria", [
    leaf("ambiente", input.environment),
    leaf("tipoEmision", EMISSION_TYPE),
    leaf("razonSocial", issuer.legalName),
    optionalLeaf("nombreComercial", issuer.tradeName),
    leaf("ruc", issuer.ruc),
    leaf("claveAcceso", input.accessKey),
    leaf("codDoc", documentType),
    leaf("estab", issuer.establishment),
    leaf("ptoEmi", issuer.emissionPoint),
    leaf("secuencial", input.sequential),
    leaf("dirMatriz", issuer.headOfficeAddress),
    optionalLeaf("agenteRetencion", issuer.withholdingAgentResolution),
    issuer.rimpe ? leaf("contribuyenteRimpe", RIMPE_LEGEND) : null,
  ]);
}

/** Fecha `YYYY-MM-DD` en el formato `dd/mm/aaaa` del XSD. */
export const sriDate = (iso: string) => iso.split("-").reverse().join("/");
