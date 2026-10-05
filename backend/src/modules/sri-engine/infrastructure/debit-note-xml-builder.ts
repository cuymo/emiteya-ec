// Builder propio del XML de la nota de débito 1.0.0 (add-debit-notes, design D16). Como los de la
// factura y la nota de crédito, es una función pura de su snapshot: no calcula importes, no
// convierte ningún valor a `number`, escribe los elementos en el orden de la secuencia del XSD
// `NotaDebito_V1.0.0` y no usa el builder de alto nivel de facturacion-electronica-ec. Los importes
// son los que congeló la reserva con `calculateDebitNoteAmounts`, y la forma de pago es la única del
// snapshot: `pagos` se escribe siempre, porque la ficha técnica lo exige aunque el XSD lo permita
// omitir. No escribe `rise`, `compensaciones`, `valorDevolucionIva`, `plazo`, `unidadTiempo`,
// `maquinaFiscal` ni `infoAdicional`.
import { isDecimalString } from "@facturador/contracts";
import {
  DebitNoteXmlError,
  type DebitNoteXmlBuilder,
  type DebitNoteXmlSnapshot,
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

/** Versión del XSD de nota de débito que este builder escribe (registro de esquemas). */
export const DEBIT_NOTE_SCHEMA_VERSION = "1.0.0";
/** Versión del builder: cambia con cualquier cambio de su salida para un mismo snapshot. */
export const DEBIT_NOTE_XML_BUILDER_VERSION = "1";

const DOCUMENT_TYPE = "05";

/** Importe tal como viene del snapshot; un texto que no es `DecimalString` no se escribe. */
function amount(name: string, value: string): XmlNode {
  if (!isDecimalString(value)) throw new DebitNoteXmlError("INVALID_SNAPSHOT_AMOUNT");
  return leaf(name, value);
}

function infoNotaDebito(snapshot: DebitNoteXmlSnapshot): XmlNode {
  const { issuer, buyer, modified } = snapshot;
  return element("infoNotaDebito", [
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
    amount("totalSinImpuestos", snapshot.withoutTaxes),
    element(
      "impuestos",
      snapshot.taxes.map((tax) =>
        element("impuesto", [
          leaf("codigo", tax.taxCode),
          leaf("codigoPorcentaje", tax.rateCode),
          amount("tarifa", tax.rate),
          amount("baseImponible", tax.base),
          amount("valor", tax.amount),
        ]),
      ),
    ),
    amount("valorTotal", snapshot.total),
    element("pagos", [
      element("pago", [
        leaf("formaPago", snapshot.payment.method),
        amount("total", snapshot.payment.total),
      ]),
    ]),
  ]);
}

function motivos(snapshot: DebitNoteXmlSnapshot): XmlNode {
  return element(
    "motivos",
    snapshot.reasons.map((motivo) =>
      element("motivo", [leaf("razon", motivo.reason), amount("valor", motivo.value)]),
    ),
  );
}

export function createDebitNoteXmlBuilder(): DebitNoteXmlBuilder {
  return {
    version: DEBIT_NOTE_XML_BUILDER_VERSION,
    build(snapshot: DebitNoteXmlSnapshot): string {
      if (snapshot.schemaVersion !== DEBIT_NOTE_SCHEMA_VERSION) {
        throw new DebitNoteXmlError("UNSUPPORTED_SCHEMA_VERSION");
      }
      try {
        return serializeXml(
          element(
            "notaDebito",
            [infoTributaria(snapshot, DOCUMENT_TYPE), infoNotaDebito(snapshot), motivos(snapshot)],
            [
              ["id", "comprobante"],
              ["version", DEBIT_NOTE_SCHEMA_VERSION],
            ],
          ),
        );
      } catch (error) {
        if (error instanceof XmlWriterError) throw new DebitNoteXmlError("INVALID_SNAPSHOT_TEXT");
        throw error;
      }
    },
  };
}
