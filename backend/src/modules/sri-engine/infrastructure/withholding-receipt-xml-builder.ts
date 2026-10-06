// Builder propio del XML del comprobante de retención 2.0.0 (add-withholding-receipts, design D17).
// Como los de la factura y las notas, es una función pura de su snapshot: no calcula importes, no
// convierte ningún valor a `number`, escribe los elementos en el orden de la secuencia del XSD
// `ComprobanteRetencion_V2.0.0` y no usa el builder de alto nivel de facturacion-electronica-ec. Los
// valores retenidos son los que congeló la reserva con `calculateWithholdingAmounts`; los impuestos y
// los pagos de cada documento sustento, los que declaró el usuario. `codDocSustento` se escribe con
// el código de dos caracteres del snapshot (`01`, `02`, `03`), nunca como un número. No escribe
// `tipoSujetoRetenido`, `fechaRegistroContable`, `tipoRegi`, `paisEfecPago`, `aplicConvDobTrib`,
// `pagExtSujRetNorLeg`, `pagoRegFis`, los totales de reembolso, `reembolsos`, `dividendos`,
// `compraCajBanano`, `maquinaFiscal` ni `infoAdicional`.
import { isDecimalString } from "@facturador/contracts";
import {
  WithholdingReceiptXmlError,
  type WithholdingReceiptXmlBuilder,
  type WithholdingReceiptXmlSnapshot,
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

/** Versión del XSD del comprobante de retención que este builder escribe (registro de esquemas). */
export const WITHHOLDING_RECEIPT_SCHEMA_VERSION = "2.0.0";
/** Versión del builder: cambia con cualquier cambio de su salida para un mismo snapshot. */
export const WITHHOLDING_RECEIPT_XML_BUILDER_VERSION = "1";

const DOCUMENT_TYPE = "07";
/** Pago local (tabla 15 del Catálogo ATS): los pagos al exterior están fuera de alcance. */
const LOCAL_PAYMENT = "01";

/** Importe tal como viene del snapshot; un texto que no es `DecimalString` no se escribe. */
function amount(name: string, value: string): XmlNode {
  if (!isDecimalString(value)) throw new WithholdingReceiptXmlError("INVALID_SNAPSHOT_AMOUNT");
  return leaf(name, value);
}

/** Código de dos caracteres: un `01` nunca se convierte en `1`. */
function code(name: string, value: string, pattern: RegExp): XmlNode {
  if (!pattern.test(value)) throw new WithholdingReceiptXmlError("INVALID_SNAPSHOT_TEXT");
  return leaf(name, value);
}

function infoCompRetencion(snapshot: WithholdingReceiptXmlSnapshot): XmlNode {
  const { issuer, subject } = snapshot;
  return element("infoCompRetencion", [
    leaf("fechaEmision", sriDate(snapshot.issueDate)),
    optionalLeaf("dirEstablecimiento", issuer.establishmentAddress),
    optionalLeaf("contribuyenteEspecial", issuer.specialTaxpayerNumber),
    leaf("obligadoContabilidad", issuer.accountingRequired ? "SI" : "NO"),
    leaf("tipoIdentificacionSujetoRetenido", subject.identificationType),
    leaf("parteRel", snapshot.relatedParty),
    leaf("razonSocialSujetoRetenido", subject.legalName),
    leaf("identificacionSujetoRetenido", subject.identification),
    leaf("periodoFiscal", snapshot.fiscalPeriod),
  ]);
}

function docSustento(support: WithholdingReceiptXmlSnapshot["supports"][number]): XmlNode {
  return element("docSustento", [
    code("codSustento", support.supportCode, /^[0-9]{2}$/),
    code("codDocSustento", support.documentType, /^[0-9]{2}$/),
    code("numDocSustento", support.number, /^[0-9]{15}$/),
    leaf("fechaEmisionDocSustento", sriDate(support.issueDate)),
    optionalLeaf("numAutDocSustento", support.authorizationNumber),
    leaf("pagoLocExt", LOCAL_PAYMENT),
    amount("totalSinImpuestos", support.totalWithoutTaxes),
    amount("importeTotal", support.importTotal),
    element(
      "impuestosDocSustento",
      support.taxes.map((tax) =>
        element("impuestoDocSustento", [
          leaf("codImpuestoDocSustento", tax.taxCode),
          leaf("codigoPorcentaje", tax.rateCode),
          amount("baseImponible", tax.base),
          amount("tarifa", tax.tariff),
          amount("valorImpuesto", tax.amount),
        ]),
      ),
    ),
    element(
      "retenciones",
      support.withholdings.map((item) =>
        element("retencion", [
          leaf("codigo", item.taxCode),
          leaf("codigoRetencion", item.code),
          amount("baseImponible", item.base),
          amount("porcentajeRetener", item.percentage),
          amount("valorRetenido", item.amount),
        ]),
      ),
    ),
    element(
      "pagos",
      support.payments.map((payment) =>
        element("pago", [leaf("formaPago", payment.method), amount("total", payment.total)]),
      ),
    ),
  ]);
}

export function createWithholdingReceiptXmlBuilder(): WithholdingReceiptXmlBuilder {
  return {
    version: WITHHOLDING_RECEIPT_XML_BUILDER_VERSION,
    build(snapshot: WithholdingReceiptXmlSnapshot): string {
      if (snapshot.schemaVersion !== WITHHOLDING_RECEIPT_SCHEMA_VERSION) {
        throw new WithholdingReceiptXmlError("UNSUPPORTED_SCHEMA_VERSION");
      }
      try {
        return serializeXml(
          element(
            "comprobanteRetencion",
            [
              infoTributaria(snapshot, DOCUMENT_TYPE),
              infoCompRetencion(snapshot),
              element("docsSustento", snapshot.supports.map(docSustento)),
            ],
            [
              ["id", "comprobante"],
              ["version", WITHHOLDING_RECEIPT_SCHEMA_VERSION],
            ],
          ),
        );
      } catch (error) {
        if (error instanceof XmlWriterError) {
          throw new WithholdingReceiptXmlError("INVALID_SNAPSHOT_TEXT");
        }
        throw error;
      }
    },
  };
}
