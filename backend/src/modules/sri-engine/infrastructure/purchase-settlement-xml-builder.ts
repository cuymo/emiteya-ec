// Builder propio del XML de la liquidación de compra 1.1.0 (add-purchase-settlements, design D15).
// Como los de los demás comprobantes, es una función pura de su snapshot: no calcula importes, no
// convierte ningún valor a `number`, escribe los elementos en el orden de la secuencia del XSD
// `LiquidacionCompra_V1.1.0` y no usa el builder de alto nivel de facturacion-electronica-ec. Escribe
// el descuento de cada línea siempre, y `plazo` y `unidadTiempo` en cada pago. No escribe reembolsos ni
// sus totales, `codDocReembolso`, `descuentoAdicional`, `precioSinSubsidio`, `detallesAdicionales`,
// `tipoNegociable`, `maquinaFiscal` ni `infoAdicional`, ni ningún nodo vacío. Las declaraciones de
// procedencia nunca llegan aquí.
import { isDecimalString } from "@facturador/contracts";
import {
  PurchaseSettlementXmlError,
  type PurchaseSettlementXmlBuilder,
  type PurchaseSettlementXmlSnapshot,
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

/** Versión del XSD de la liquidación de compra que este builder escribe (registro de esquemas). */
export const PURCHASE_SETTLEMENT_SCHEMA_VERSION = "1.1.0";
/** Versión del builder: cambia con cualquier cambio de su salida para un mismo snapshot. */
export const PURCHASE_SETTLEMENT_XML_BUILDER_VERSION = "1";

const DOCUMENT_TYPE = "03";

/** Importe o cantidad tal como viene del snapshot; un texto que no es `DecimalString` no se escribe. */
function amount(name: string, value: string): XmlNode {
  if (!isDecimalString(value)) throw new PurchaseSettlementXmlError("INVALID_SNAPSHOT_AMOUNT");
  return leaf(name, value);
}

/** Texto que debe cumplir el patrón del XSD; si no, el snapshot no se escribe. */
function matching(name: string, value: string, pattern: RegExp): XmlNode {
  if (!pattern.test(value)) throw new PurchaseSettlementXmlError("INVALID_SNAPSHOT_TEXT");
  return leaf(name, value);
}

const text = (max: number) => new RegExp(`^[^\\r\\n]{1,${max}}$`, "u");

function infoLiquidacionCompra(snapshot: PurchaseSettlementXmlSnapshot): XmlNode {
  const { issuer, supplier, totals } = snapshot;
  return element("infoLiquidacionCompra", [
    leaf("fechaEmision", sriDate(snapshot.issueDate)),
    optionalLeaf("dirEstablecimiento", issuer.establishmentAddress),
    optionalLeaf("contribuyenteEspecial", issuer.specialTaxpayerNumber),
    leaf("obligadoContabilidad", issuer.accountingRequired ? "SI" : "NO"),
    matching("tipoIdentificacionProveedor", supplier.identificationType, /^0[4-8]$/),
    matching("razonSocialProveedor", supplier.legalName, text(300)),
    matching("identificacionProveedor", supplier.identification, text(20)),
    matching("direccionProveedor", supplier.address, text(300)),
    amount("totalSinImpuestos", totals.withoutTaxes),
    amount("totalDescuento", totals.discount),
    element(
      "totalConImpuestos",
      totals.taxes.map((tax) =>
        element("totalImpuesto", [
          matching("codigo", tax.taxCode, /^2$/),
          matching("codigoPorcentaje", tax.rateCode, /^[0-9]{1,4}$/),
          amount("baseImponible", tax.base),
          amount("tarifa", tax.rate),
          amount("valor", tax.amount),
        ]),
      ),
    ),
    amount("importeTotal", totals.total),
    matching("moneda", snapshot.currency, text(15)),
    element(
      "pagos",
      snapshot.payments.map((payment) =>
        element("pago", [
          matching("formaPago", payment.method, /^(?:0[1-9]|1[0-9]|2[01])$/),
          amount("total", payment.total),
          amount("plazo", payment.term),
          matching("unidadTiempo", payment.timeUnit, text(10)),
        ]),
      ),
    ),
  ]);
}

function detalle(line: PurchaseSettlementXmlSnapshot["lines"][number]): XmlNode {
  return element("detalle", [
    line.mainCode === null ? null : matching("codigoPrincipal", line.mainCode, text(25)),
    line.auxiliaryCode === null ? null : matching("codigoAuxiliar", line.auxiliaryCode, text(25)),
    matching("descripcion", line.description, text(300)),
    line.unit === null ? null : matching("unidadMedida", line.unit, text(50)),
    amount("cantidad", line.quantity),
    amount("precioUnitario", line.unitPrice),
    amount("descuento", line.discount),
    amount("precioTotalSinImpuesto", line.taxableBase),
    element("impuestos", [
      element("impuesto", [
        matching("codigo", line.tax.taxCode, /^2$/),
        matching("codigoPorcentaje", line.tax.rateCode, /^[0-9]{1,4}$/),
        amount("tarifa", line.tax.rate),
        amount("baseImponible", line.tax.base),
        amount("valor", line.tax.amount),
      ]),
    ]),
  ]);
}

export function createPurchaseSettlementXmlBuilder(): PurchaseSettlementXmlBuilder {
  return {
    version: PURCHASE_SETTLEMENT_XML_BUILDER_VERSION,
    build(snapshot: PurchaseSettlementXmlSnapshot): string {
      if (snapshot.schemaVersion !== PURCHASE_SETTLEMENT_SCHEMA_VERSION) {
        throw new PurchaseSettlementXmlError("UNSUPPORTED_SCHEMA_VERSION");
      }
      if (snapshot.lines.length === 0 || snapshot.payments.length === 0) {
        throw new PurchaseSettlementXmlError("INVALID_SNAPSHOT_TEXT");
      }
      try {
        return serializeXml(
          element(
            "liquidacionCompra",
            [
              infoTributaria(snapshot, DOCUMENT_TYPE),
              infoLiquidacionCompra(snapshot),
              element("detalles", snapshot.lines.map(detalle)),
            ],
            [
              ["id", "comprobante"],
              ["version", PURCHASE_SETTLEMENT_SCHEMA_VERSION],
            ],
          ),
        );
      } catch (error) {
        if (error instanceof XmlWriterError) {
          throw new PurchaseSettlementXmlError("INVALID_SNAPSHOT_TEXT");
        }
        throw error;
      }
    },
  };
}
