// Builder propio del XML de la nota de crédito 1.1.0 (add-credit-notes, design D12). Como el de la
// factura, es una función pura de su snapshot: no calcula importes, no convierte ningún valor a
// `number`, escribe los elementos en el orden de la secuencia del XSD `NotaCredito_V1.1.0` y no usa
// el builder de alto nivel de facturacion-electronica-ec. Los importes son los que congeló la
// reserva con `calculateCreditNoteAmounts`.
import { isDecimalString } from "@facturador/contracts";
import {
  CreditNoteXmlError,
  type CreditNoteXmlBuilder,
  type CreditNoteXmlSnapshot,
  type InvoiceLineSnapshot,
} from "../application/ports.ts";
import { infoTributaria, sriDate } from "./info-tributaria.ts";
import {
  XmlWriterError,
  element,
  leaf,
  optionalLeaf,
  serializeXml,
  type XmlNode,
} from "./xml-writer.ts";

/** Versión del XSD de nota de crédito que este builder escribe (registro de esquemas). */
export const CREDIT_NOTE_SCHEMA_VERSION = "1.1.0";
/** Versión del builder: cambia con cualquier cambio de su salida para un mismo snapshot. */
export const CREDIT_NOTE_XML_BUILDER_VERSION = "1";

const DOCUMENT_TYPE = "04";
// La nota se emite en dólares, como la factura que modifica.
const CURRENCY = "DOLAR";

/** Importe tal como viene del snapshot; un texto que no es `DecimalString` no se escribe. */
function amount(name: string, value: string): XmlNode {
  if (!isDecimalString(value)) throw new CreditNoteXmlError("INVALID_SNAPSHOT_AMOUNT");
  return leaf(name, value);
}

function infoNotaCredito(snapshot: CreditNoteXmlSnapshot): XmlNode {
  const { issuer, buyer, modified, totals } = snapshot;
  return element("infoNotaCredito", [
    leaf("fechaEmision", sriDate(snapshot.issueDate)),
    optionalLeaf("dirEstablecimiento", issuer.establishmentAddress),
    leaf("tipoIdentificacionComprador", buyer.identificationType),
    leaf("razonSocialComprador", buyer.legalName),
    leaf("identificacionComprador", buyer.identification),
    optionalLeaf("contribuyenteEspecial", issuer.specialTaxpayerNumber),
    leaf("obligadoContabilidad", issuer.accountingRequired ? "SI" : "NO"),
    leaf("codDocModificado", modified.documentType),
    leaf("numDocModificado", modified.documentNumber),
    leaf("fechaEmisionDocSustento", sriDate(modified.issueDate)),
    amount("totalSinImpuestos", totals.withoutTaxes),
    amount("valorModificacion", totals.total),
    leaf("moneda", CURRENCY),
    element(
      "totalConImpuestos",
      totals.taxes.map((tax) =>
        element("totalImpuesto", [
          leaf("codigo", tax.taxCode),
          leaf("codigoPorcentaje", tax.rateCode),
          amount("baseImponible", tax.base),
          amount("valor", tax.amount),
        ]),
      ),
    ),
    leaf("motivo", snapshot.reason),
  ]);
}

function detalle(line: InvoiceLineSnapshot): XmlNode {
  return element("detalle", [
    optionalLeaf("codigoInterno", line.mainCode),
    optionalLeaf("codigoAdicional", line.auxiliaryCode),
    leaf("descripcion", line.description),
    amount("cantidad", line.quantity),
    amount("precioUnitario", line.unitPrice),
    amount("descuento", line.discount),
    amount("precioTotalSinImpuesto", line.taxableBase),
    element(
      "impuestos",
      line.taxes.map((tax) =>
        element("impuesto", [
          leaf("codigo", tax.taxCode),
          leaf("codigoPorcentaje", tax.rateCode),
          amount("tarifa", tax.rate),
          amount("baseImponible", tax.base),
          amount("valor", tax.amount),
        ]),
      ),
    ),
  ]);
}

export function createCreditNoteXmlBuilder(): CreditNoteXmlBuilder {
  return {
    version: CREDIT_NOTE_XML_BUILDER_VERSION,
    build(snapshot: CreditNoteXmlSnapshot): string {
      if (snapshot.schemaVersion !== CREDIT_NOTE_SCHEMA_VERSION) {
        throw new CreditNoteXmlError("UNSUPPORTED_SCHEMA_VERSION");
      }
      try {
        return serializeXml(
          element(
            "notaCredito",
            [
              infoTributaria(snapshot, DOCUMENT_TYPE),
              infoNotaCredito(snapshot),
              element("detalles", snapshot.lines.map(detalle)),
            ],
            [
              ["id", "comprobante"],
              ["version", CREDIT_NOTE_SCHEMA_VERSION],
            ],
          ),
        );
      } catch (error) {
        if (error instanceof XmlWriterError) throw new CreditNoteXmlError("INVALID_SNAPSHOT_TEXT");
        throw error;
      }
    },
  };
}
