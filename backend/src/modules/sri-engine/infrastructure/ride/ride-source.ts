// Lectura del XML de origen del RIDE (add-document-archive, design D3): la factura 1.1.0 que el
// sistema emite, y nada más. Rechaza un XML peligroso (DTD o entidades, demasiado grande o
// demasiado anidado), cualquier otro documento, y todo elemento que el builder del sistema no
// escribe (ICE, IRBPNR, propina, información adicional…): el RIDE nunca omite contenido en silencio
// ni afirma un soporte que la emisión no tiene. Los textos e importes salen tal como están en el
// XML, sin recortarlos ni convertirlos a número.
import { XMLParser, XMLValidator } from "fast-xml-parser";
import {
  RideRejectedError,
  type RideInvoice,
  type RideLine,
  type RideSourceInput,
  type RideSourceReader,
  type RideTax,
} from "../../application/ride.ts";

/** Mayor que cualquier comprobante firmado admitido por la política de tamaño del envío. */
export const RIDE_XML_MAX_BYTES = 2 * 1024 * 1024;
/** La factura anida unos 8 niveles y la firma XAdES unos 12: 24 deja margen sin abrir abusos. */
export const RIDE_XML_MAX_DEPTH = 24;
/** La única versión que escribe el builder de add-invoice-emission (`INVOICE_SCHEMA_VERSION`). */
export const RIDE_INVOICE_VERSION = "1.1.0";
/** IVA, el único impuesto que la emisión produce: ICE e IRBPNR no tienen datos de cálculo. */
const IVA = "2";

/**
 * Elementos que el builder del sistema escribe, por ruta del padre. La firma (`Signature`) se
 * admite entera y no se lee.
 */
const ALLOWED: Readonly<Record<string, readonly string[]>> = {
  factura: ["infoTributaria", "infoFactura", "detalles", "Signature"],
  "factura.infoTributaria": [
    "ambiente",
    "tipoEmision",
    "razonSocial",
    "nombreComercial",
    "ruc",
    "claveAcceso",
    "codDoc",
    "estab",
    "ptoEmi",
    "secuencial",
    "dirMatriz",
    "agenteRetencion",
    "contribuyenteRimpe",
  ],
  "factura.infoFactura": [
    "fechaEmision",
    "dirEstablecimiento",
    "contribuyenteEspecial",
    "obligadoContabilidad",
    "tipoIdentificacionComprador",
    "razonSocialComprador",
    "identificacionComprador",
    "direccionComprador",
    "totalSinImpuestos",
    "totalDescuento",
    "totalConImpuestos",
    "importeTotal",
    "moneda",
    "pagos",
  ],
  "factura.infoFactura.totalConImpuestos": ["totalImpuesto"],
  "factura.infoFactura.totalConImpuestos.totalImpuesto": [
    "codigo",
    "codigoPorcentaje",
    "baseImponible",
    "valor",
  ],
  "factura.infoFactura.pagos": ["pago"],
  "factura.infoFactura.pagos.pago": ["formaPago", "total"],
  "factura.detalles": ["detalle"],
  "factura.detalles.detalle": [
    "codigoPrincipal",
    "codigoAuxiliar",
    "descripcion",
    "cantidad",
    "precioUnitario",
    "descuento",
    "precioTotalSinImpuesto",
    "impuestos",
  ],
  "factura.detalles.detalle.impuestos": ["impuesto"],
  "factura.detalles.detalle.impuestos.impuesto": [
    "codigo",
    "codigoPorcentaje",
    "tarifa",
    "baseImponible",
    "valor",
  ],
};
/** Hojas de texto: no tienen hijos. La firma no es una hoja, pero tampoco se recorre. */
const LEAVES = new Set(
  Object.entries(ALLOWED).flatMap(([parent, children]) =>
    children
      .map((name) => `${parent}.${name}`)
      .filter((path) => !(path in ALLOWED) && path !== "factura.Signature"),
  ),
);
const ARRAYS = new Set([
  "factura.detalles.detalle",
  "factura.detalles.detalle.impuestos.impuesto",
  "factura.infoFactura.totalConImpuestos.totalImpuesto",
  "factura.infoFactura.pagos.pago",
]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  processEntities: true,
  htmlEntities: false,
  isArray: (_name, jpath) => ARRAYS.has(String(jpath)),
});

type Node = Record<string, unknown>;
const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const invalid = (detail: string) => new RideRejectedError("RIDE_SOURCE_INVALID", [detail]);

/** Profundidad máxima de etiquetas, sin construir el árbol (defensa ante anidamiento abusivo). */
function depthOf(xml: string): number {
  let depth = 0;
  let max = 0;
  for (const match of xml.matchAll(/<(\/?)([A-Za-z_][\w.:-]*)[^>]*?(\/?)>/g)) {
    if (match[1] === "/") depth--;
    else if (match[3] !== "/") max = Math.max(max, ++depth);
  }
  return max;
}

/** Elementos fuera de lo que escribe el builder, con su ruta; la firma no se recorre. */
function unsupportedElements(node: Node, path: string, found: Set<string>): void {
  const allowed = ALLOWED[path];
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("@_")) continue;
    if (key === "#text") {
      if (typeof value === "string" && value.trim() !== "") found.add(`${path}#text`);
      continue;
    }
    const childPath = `${path}.${key}`;
    if (!allowed?.includes(key)) {
      found.add(childPath);
      continue;
    }
    if (childPath === "factura.Signature") continue;
    if (LEAVES.has(childPath)) {
      const leaf = Array.isArray(value) ? value : [value];
      if (leaf.length > 1 || leaf.some((item) => isNode(item) && hasElements(item))) {
        found.add(childPath);
      }
      continue;
    }
    for (const item of Array.isArray(value) ? value : [value]) {
      if (isNode(item)) unsupportedElements(item, childPath, found);
      else if (typeof item === "string" && item.trim() !== "") found.add(`${childPath}#text`);
    }
  }
}
const hasElements = (node: Node) =>
  Object.keys(node).some((key) => !key.startsWith("@_") && key !== "#text");

function text(parent: Node, key: string, path: string): string | null {
  const value = parent[key];
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  if (isNode(value) && !hasElements(value)) {
    return typeof value["#text"] === "string" ? value["#text"] : "";
  }
  throw invalid(`${path}.${key}`);
}
function required(parent: Node, key: string, path: string): string {
  const value = text(parent, key, path);
  if (value === null || value === "") throw invalid(`MISSING:${path}.${key}`);
  return value;
}
const list = (value: unknown): Node[] =>
  Array.isArray(value) ? value.filter(isNode) : isNode(value) ? [value] : [];

export function readRideSource(input: RideSourceInput): RideInvoice {
  const { authorization } = input;
  if (input.xml.byteLength > RIDE_XML_MAX_BYTES) throw invalid("TOO_LARGE");
  let xml: string;
  try {
    xml = new TextDecoder("utf-8", { fatal: true }).decode(input.xml);
  } catch {
    throw invalid("NOT_UTF8");
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw invalid("DTD");
  if (XMLValidator.validate(xml) !== true) throw invalid("MALFORMED");
  if (depthOf(xml) > RIDE_XML_MAX_DEPTH) throw invalid("TOO_DEEP");
  let document: unknown;
  try {
    document = parser.parse(xml);
  } catch {
    throw invalid("MALFORMED");
  }
  const roots = isNode(document)
    ? Object.keys(document).filter((key) => !key.startsWith("?") && key !== "#text")
    : [];
  const factura = isNode(document) ? document.factura : undefined;
  if (roots.length !== 1 || !isNode(factura)) throw invalid("NOT_INVOICE");
  if (factura["@_version"] !== RIDE_INVOICE_VERSION) throw invalid("UNSUPPORTED_VERSION");
  const tributaria = factura.infoTributaria;
  const info = factura.infoFactura;
  const detalles = factura.detalles;
  if (!isNode(tributaria) || !isNode(info) || !isNode(detalles)) throw invalid("NOT_INVOICE");
  if (required(tributaria, "codDoc", "infoTributaria") !== "01") throw invalid("NOT_INVOICE");

  const unsupported = new Set<string>();
  unsupportedElements(factura, "factura", unsupported);
  const taxNodes = [
    ...list(isNode(info.totalConImpuestos) ? info.totalConImpuestos.totalImpuesto : undefined),
    ...list(detalles.detalle).flatMap((detalle) =>
      list(isNode(detalle.impuestos) ? detalle.impuestos.impuesto : undefined),
    ),
  ];
  for (const tax of taxNodes) {
    const code = text(tax, "codigo", "impuesto");
    if (code !== IVA) unsupported.add(`impuesto.codigo:${code ?? ""}`);
  }
  if (unsupported.size > 0) {
    throw new RideRejectedError("RIDE_SOURCE_UNSUPPORTED", [...unsupported].sort());
  }

  const accessKey = required(tributaria, "claveAcceso", "infoTributaria");
  const environment = required(tributaria, "ambiente", "infoTributaria");
  if (environment !== "1" && environment !== "2") throw invalid("infoTributaria.ambiente");
  // El XML, el comprobante guardado y su autorización deben describir el mismo comprobante.
  const mismatches = [
    ...(accessKey !== input.accessKey ? ["claveAcceso"] : []),
    ...(authorization.number !== accessKey ? ["numeroAutorizacion"] : []),
    ...(authorization.environment !== (environment === "1" ? "TEST" : "PRODUCTION")
      ? ["ambiente"]
      : []),
  ];
  if (mismatches.length > 0) {
    throw new RideRejectedError("RIDE_AUTHORIZATION_MISMATCH", mismatches);
  }

  const detalleNodes = list(detalles.detalle);
  const lines = detalleNodes.map((detalle): RideLine => ({
    mainCode: text(detalle, "codigoPrincipal", "detalle"),
    auxiliaryCode: text(detalle, "codigoAuxiliar", "detalle"),
    description: required(detalle, "descripcion", "detalle"),
    quantity: required(detalle, "cantidad", "detalle"),
    unitPrice: required(detalle, "precioUnitario", "detalle"),
    discount: required(detalle, "descuento", "detalle"),
    total: required(detalle, "precioTotalSinImpuesto", "detalle"),
  }));
  if (lines.length === 0) throw invalid("MISSING:detalles.detalle");

  // Tarifa por código de tarifa, tal como la declaran las líneas del mismo XML.
  const rates = new Map<string, string>();
  for (const detalle of detalleNodes) {
    for (const impuesto of list(
      isNode(detalle.impuestos) ? detalle.impuestos.impuesto : undefined,
    )) {
      const rate = text(impuesto, "tarifa", "impuesto");
      if (rate !== null) rates.set(required(impuesto, "codigoPorcentaje", "impuesto"), rate);
    }
  }
  const taxes = list(
    isNode(info.totalConImpuestos) ? info.totalConImpuestos.totalImpuesto : undefined,
  ).map((tax): RideTax => {
    const rateCode = required(tax, "codigoPorcentaje", "totalImpuesto");
    return {
      rateCode,
      rate: rates.get(rateCode) ?? null,
      base: required(tax, "baseImponible", "totalImpuesto"),
      amount: required(tax, "valor", "totalImpuesto"),
    };
  });

  const payments = list(isNode(info.pagos) ? info.pagos.pago : undefined).map((pago) => {
    const method = required(pago, "formaPago", "pago");
    return {
      method,
      label: input.paymentLabels[method] ?? null,
      total: required(pago, "total", "pago"),
    };
  });

  return {
    environment,
    emissionType: required(tributaria, "tipoEmision", "infoTributaria"),
    legalName: required(tributaria, "razonSocial", "infoTributaria"),
    tradeName: text(tributaria, "nombreComercial", "infoTributaria"),
    ruc: required(tributaria, "ruc", "infoTributaria"),
    accessKey,
    establishment: required(tributaria, "estab", "infoTributaria"),
    emissionPoint: required(tributaria, "ptoEmi", "infoTributaria"),
    sequential: required(tributaria, "secuencial", "infoTributaria"),
    headOfficeAddress: required(tributaria, "dirMatriz", "infoTributaria"),
    establishmentAddress: text(info, "dirEstablecimiento", "infoFactura"),
    specialTaxpayer: text(info, "contribuyenteEspecial", "infoFactura"),
    accountingRequired: required(info, "obligadoContabilidad", "infoFactura"),
    withholdingAgentResolution: text(tributaria, "agenteRetencion", "infoTributaria"),
    rimpeLegend: text(tributaria, "contribuyenteRimpe", "infoTributaria"),
    issueDate: required(info, "fechaEmision", "infoFactura"),
    buyer: {
      identificationType: required(info, "tipoIdentificacionComprador", "infoFactura"),
      identification: required(info, "identificacionComprador", "infoFactura"),
      legalName: required(info, "razonSocialComprador", "infoFactura"),
      address: text(info, "direccionComprador", "infoFactura"),
    },
    totals: {
      withoutTaxes: required(info, "totalSinImpuestos", "infoFactura"),
      discount: required(info, "totalDescuento", "infoFactura"),
      taxes,
      total: required(info, "importeTotal", "infoFactura"),
    },
    payments,
    lines,
    authorization,
  };
}

export const rideSourceReader: RideSourceReader = { read: readRideSource };
