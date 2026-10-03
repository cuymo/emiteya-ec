// Adaptador XmlSigner sobre EcSriSigner de facturacion-electronica-ec (ADR 0018), que firma con
// ec-sri-invoice-signer. Único lugar, junto con el resto de este módulo, que importa la librería.
// No se usan emitir*, ISequenceProvider, rollback, EmissionHooks ni generateCodigoNumerico.
import {
  COD_DOC_TO_DOCUMENT_TYPE,
  EcSriSigner,
  buildDocumentXml,
  generateClaveAcceso,
  schemaRegistry,
} from "facturacion-electronica-ec";
import { XmlSignerError, type XmlSigner, type XmlSignerErrorCode } from "../application/ports.ts";

/**
 * Versiones del firmador que registra el artefacto firmado (add-invoice-emission, design D9). Una
 * prueba las compara con las dependencias exactas de backend/package.json.
 */
export const XML_SIGNER_VERSION = "facturacion-electronica-ec@1.0.1 (ec-sri-invoice-signer@1.8.2)";

/** Traduce el error del firmador a un código; el mensaje original nunca sale del adaptador. */
function classify(error: unknown): XmlSignerErrorCode {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : "";
  if (message.includes("MAC could not be verified")) return "PASSWORD_INVALID";
  if (message.includes("Failed to decrypt")) return "INCOMPATIBLE";
  if (name === "UnsuportedPkcs12Error") return "INCOMPATIBLE";
  if (/ASN\.1|DER|Too few bytes|Unparsed|bits supported/i.test(message)) return "UNREADABLE";
  return "SIGNER_FAILED";
}

// Documento de la firma de prueba: datos ficticios y fijos, nunca se envía al SRI. La clave de
// acceso usa un código numérico fijo porque este XML no es un comprobante.
const TEST_DOCUMENT = (() => {
  const schema = schemaRegistry.get("FACTURA");
  const base = {
    ambiente: "1" as const,
    ruc: "9999999999001",
    razonSocial: "FIRMA DE PRUEBA",
    nombreComercial: null,
    dirMatriz: "N/A",
    codDoc: schema.codDoc,
    establecimiento: "001",
    puntoEmision: "001",
    secuencial: "000000001",
    direccionEstablecimiento: "N/A",
    contribuyenteEspecial: null,
    obligadoContabilidad: false,
  };
  const claveAcceso = generateClaveAcceso({
    fechaEmision: "01/01/2026",
    tipoComprobante: schema.codDoc,
    ruc: base.ruc,
    ambiente: base.ambiente,
    establecimiento: base.establecimiento,
    puntoEmision: base.puntoEmision,
    secuencial: base.secuencial,
    codigoNumerico: "00000000",
    tipoEmision: "1",
  });
  return buildDocumentXml(
    "FACTURA",
    { ...base, claveAcceso },
    {
      fechaEmision: "01/01/2026",
      tipoIdentificacionComprador: "07",
      razonSocialComprador: "CONSUMIDOR FINAL",
      identificacionComprador: "9999999999999",
      totalSinImpuestos: 0,
      totalDescuento: 0,
      totalConImpuestos: [{ codigo: "2", codigoPorcentaje: "0", baseImponible: 0, valor: 0 }],
      propina: 0,
      importeTotal: 0,
      pagos: [{ formaPago: "01", total: 0 }],
      detalles: [
        {
          codigoPrincipal: "PRUEBA",
          descripcion: "Firma de prueba",
          cantidad: 1,
          precioUnitario: 0,
          descuento: 0,
          precioTotalSinImpuesto: 0,
          impuestos: [
            { codigo: "2", codigoPorcentaje: "0", tarifa: 0, baseImponible: 0, valor: 0 },
          ],
        },
      ],
    },
  );
})();

export function createXmlSigner(): XmlSigner {
  const signer = new EcSriSigner();
  return {
    async sign({ xml, documentType, p12, password }) {
      const libraryType = COD_DOC_TO_DOCUMENT_TYPE[documentType];
      if (!libraryType) throw new XmlSignerError("SIGNER_FAILED");
      try {
        return await signer.sign(xml, libraryType, { p12, p12Password: password });
      } catch (error) {
        throw new XmlSignerError(classify(error));
      }
    },
    testDocument: () => TEST_DOCUMENT,
  };
}
