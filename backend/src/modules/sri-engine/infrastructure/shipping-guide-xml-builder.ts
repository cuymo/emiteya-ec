// Builder propio del XML de la guía de remisión 1.1.0 (add-shipping-guides, design D16). Como los de
// los demás comprobantes, es una función pura de su snapshot: no convierte ningún valor a `number`,
// escribe los elementos en el orden de la secuencia del XSD `GuiaRemision_V1.1.0` y no usa el builder
// de alto nivel de facturacion-electronica-ec. Los cuatro datos del sustento se escriben solo con una
// factura; una excepción declarada no tiene campo en el XML. No escribe `rise`, `docAduaneroUnico`,
// `detallesAdicionales`, `maquinaFiscal` ni `infoAdicional`, ni ningún nodo vacío.
import { isDecimalString } from "@facturador/contracts";
import {
  ShippingGuideXmlError,
  type ShippingGuideXmlBuilder,
  type ShippingGuideXmlSnapshot,
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

/** Versión del XSD de la guía de remisión que este builder escribe (registro de esquemas). */
export const SHIPPING_GUIDE_SCHEMA_VERSION = "1.1.0";
/** Versión del builder: cambia con cualquier cambio de su salida para un mismo snapshot. */
export const SHIPPING_GUIDE_XML_BUILDER_VERSION = "1";

const DOCUMENT_TYPE = "06";

/** Texto que debe cumplir el patrón del XSD; si no, el snapshot no se escribe. */
function matching(name: string, value: string, pattern: RegExp): XmlNode {
  if (!pattern.test(value)) throw new ShippingGuideXmlError("INVALID_SNAPSHOT_TEXT");
  return leaf(name, value);
}

/** Cantidad tal como viene del snapshot, en su forma canónica; nunca un `number`. */
function quantity(value: string): XmlNode {
  if (!isDecimalString(value)) throw new ShippingGuideXmlError("INVALID_SNAPSHOT_AMOUNT");
  return leaf("cantidad", value);
}

function infoGuiaRemision(snapshot: ShippingGuideXmlSnapshot): XmlNode {
  const { issuer, carrier } = snapshot;
  return element("infoGuiaRemision", [
    optionalLeaf("dirEstablecimiento", issuer.establishmentAddress),
    leaf("dirPartida", snapshot.departureAddress),
    leaf("razonSocialTransportista", carrier.legalName),
    matching("tipoIdentificacionTransportista", carrier.identificationType, /^0[456]$/),
    matching("rucTransportista", carrier.identification, /^[^\r\n]{1,13}$/),
    leaf("obligadoContabilidad", issuer.accountingRequired ? "SI" : "NO"),
    optionalLeaf("contribuyenteEspecial", issuer.specialTaxpayerNumber),
    leaf("fechaIniTransporte", sriDate(snapshot.transportStart)),
    leaf("fechaFinTransporte", sriDate(snapshot.transportEnd)),
    matching("placa", snapshot.plate, /^[^\r\n]{1,20}$/),
  ]);
}

function destinatario(recipient: ShippingGuideXmlSnapshot["recipients"][number]): XmlNode {
  const support = recipient.support;
  return element("destinatario", [
    matching("identificacionDestinatario", recipient.identification, /^[^\r\n]{1,20}$/),
    leaf("razonSocialDestinatario", recipient.legalName),
    leaf("dirDestinatario", recipient.address),
    leaf("motivoTraslado", recipient.motive),
    recipient.destinationEstablishmentCode === null
      ? null
      : matching("codEstabDestino", recipient.destinationEstablishmentCode, /^[0-9]{3}$/),
    optionalLeaf("ruta", recipient.route),
    ...(support === null
      ? []
      : [
          matching("codDocSustento", support.documentType, /^[0-9]{2}$/),
          matching("numDocSustento", support.documentNumber, /^[0-9]{3}-[0-9]{3}-[0-9]{9}$/),
          matching(
            "numAutDocSustento",
            support.authorizationNumber,
            /^(?:[0-9]{10}|[0-9]{37}|[0-9]{49})$/,
          ),
          leaf("fechaEmisionDocSustento", sriDate(support.issueDate)),
        ]),
    element(
      "detalles",
      recipient.details.map((detail) =>
        element("detalle", [
          optionalLeaf("codigoInterno", detail.mainCode),
          optionalLeaf("codigoAdicional", detail.auxiliaryCode),
          leaf("descripcion", detail.description),
          quantity(detail.quantity),
        ]),
      ),
    ),
  ]);
}

export function createShippingGuideXmlBuilder(): ShippingGuideXmlBuilder {
  return {
    version: SHIPPING_GUIDE_XML_BUILDER_VERSION,
    build(snapshot: ShippingGuideXmlSnapshot): string {
      if (snapshot.schemaVersion !== SHIPPING_GUIDE_SCHEMA_VERSION) {
        throw new ShippingGuideXmlError("UNSUPPORTED_SCHEMA_VERSION");
      }
      if (snapshot.recipients.length === 0) {
        throw new ShippingGuideXmlError("INVALID_SNAPSHOT_TEXT");
      }
      try {
        return serializeXml(
          element(
            "guiaRemision",
            [
              infoTributaria(snapshot, DOCUMENT_TYPE),
              infoGuiaRemision(snapshot),
              element("destinatarios", snapshot.recipients.map(destinatario)),
            ],
            [
              ["id", "comprobante"],
              ["version", SHIPPING_GUIDE_SCHEMA_VERSION],
            ],
          ),
        );
      } catch (error) {
        if (error instanceof XmlWriterError) {
          throw new ShippingGuideXmlError("INVALID_SNAPSHOT_TEXT");
        }
        throw error;
      }
    },
  };
}
