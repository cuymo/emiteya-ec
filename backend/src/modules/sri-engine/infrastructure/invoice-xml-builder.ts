// Builder propio del XML de la factura 1.1.0 (Q-44, add-invoice-emission design D4 y D12). Sustituye
// a buildFacturaXml de facturacion-electronica-ec, que convierte los importes a `number` y no
// escribe `agenteRetencion` ni `contribuyenteRimpe` (spike S-3). Es una función pura de su
// snapshot: no calcula importes, no convierte ningún valor a `number` y escribe los elementos en el
// orden de la secuencia del XSD.
import { isDecimalString } from "@facturador/contracts";
import {
  InvoiceXmlError,
  type InvoiceLineSnapshot,
  type InvoiceSnapshot,
  type InvoiceXmlBuilder,
} from "../application/ports.ts";
import {
  XmlWriterError,
  element,
  leaf,
  optionalLeaf,
  serializeXml,
  type XmlNode,
} from "./xml-writer.ts";

/** Versión del XSD de factura que este builder escribe (registro de esquemas). */
export const INVOICE_SCHEMA_VERSION = "1.1.0";
/** Versión del builder: cambia con cualquier cambio de su salida para un mismo snapshot. */
export const INVOICE_XML_BUILDER_VERSION = "1";

const DOCUMENT_TYPE = "01";
// Fuera de línea, el tipo de emisión es siempre normal (CTX §8.2).
const EMISSION_TYPE = "1";
// Único valor que admite el tipo `contribuyenteRimpe` del XSD.
const RIMPE_LEGEND = "CONTRIBUYENTE RÉGIMEN RIMPE";
// La factura se emite en dólares.
const CURRENCY = "DOLAR";

/** Importe tal como viene del snapshot; un texto que no es `DecimalString` no se escribe. */
function amount(name: string, value: string): XmlNode {
  if (!isDecimalString(value)) throw new InvoiceXmlError("INVALID_SNAPSHOT_AMOUNT");
  return leaf(name, value);
}

const sriDate = (iso: string) => iso.split("-").reverse().join("/");

function infoTributaria(snapshot: InvoiceSnapshot): XmlNode {
  const { issuer } = snapshot;
  return element("infoTributaria", [
    leaf("ambiente", snapshot.environment),
    leaf("tipoEmision", EMISSION_TYPE),
    leaf("razonSocial", issuer.legalName),
    optionalLeaf("nombreComercial", issuer.tradeName),
    leaf("ruc", issuer.ruc),
    leaf("claveAcceso", snapshot.accessKey),
    leaf("codDoc", DOCUMENT_TYPE),
    leaf("estab", issuer.establishment),
    leaf("ptoEmi", issuer.emissionPoint),
    leaf("secuencial", snapshot.sequential),
    leaf("dirMatriz", issuer.headOfficeAddress),
    optionalLeaf("agenteRetencion", issuer.withholdingAgentResolution),
    issuer.rimpe ? leaf("contribuyenteRimpe", RIMPE_LEGEND) : null,
  ]);
}

function infoFactura(snapshot: InvoiceSnapshot): XmlNode {
  const { issuer, buyer, totals } = snapshot;
  return element("infoFactura", [
    leaf("fechaEmision", sriDate(snapshot.issueDate)),
    optionalLeaf("dirEstablecimiento", issuer.establishmentAddress),
    optionalLeaf("contribuyenteEspecial", issuer.specialTaxpayerNumber),
    leaf("obligadoContabilidad", issuer.accountingRequired ? "SI" : "NO"),
    leaf("tipoIdentificacionComprador", buyer.identificationType),
    leaf("razonSocialComprador", buyer.legalName),
    leaf("identificacionComprador", buyer.identification),
    optionalLeaf("direccionComprador", buyer.address),
    amount("totalSinImpuestos", totals.withoutTaxes),
    amount("totalDescuento", totals.discount),
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
    amount("importeTotal", totals.total),
    leaf("moneda", CURRENCY),
    snapshot.payments.length === 0
      ? null
      : element(
          "pagos",
          snapshot.payments.map((payment) =>
            element("pago", [leaf("formaPago", payment.method), amount("total", payment.total)]),
          ),
        ),
  ]);
}

function detalle(line: InvoiceLineSnapshot): XmlNode {
  return element("detalle", [
    optionalLeaf("codigoPrincipal", line.mainCode),
    optionalLeaf("codigoAuxiliar", line.auxiliaryCode),
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

export function createInvoiceXmlBuilder(): InvoiceXmlBuilder {
  return {
    version: INVOICE_XML_BUILDER_VERSION,
    build(snapshot: InvoiceSnapshot): string {
      if (snapshot.schemaVersion !== INVOICE_SCHEMA_VERSION) {
        throw new InvoiceXmlError("UNSUPPORTED_SCHEMA_VERSION");
      }
      try {
        return serializeXml(
          element(
            "factura",
            [
              infoTributaria(snapshot),
              infoFactura(snapshot),
              element("detalles", snapshot.lines.map(detalle)),
            ],
            [
              ["id", "comprobante"],
              ["version", INVOICE_SCHEMA_VERSION],
            ],
          ),
        );
      } catch (error) {
        if (error instanceof XmlWriterError) throw new InvoiceXmlError("INVALID_SNAPSHOT_TEXT");
        throw error;
      }
    },
  };
}
