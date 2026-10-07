// Lectura del XML de origen del RIDE (add-document-archive, design D3; add-credit-notes, design
// D14; add-debit-notes, design D18; add-withholding-receipts, design D19; add-shipping-guides, design
// D20): la factura 1.1.0, la nota de crédito 1.1.0, la nota de débito 1.0.0, el comprobante de
// retención 2.0.0 y la guía de remisión 1.1.0 que el sistema emite, elegidos por la raíz y la versión
// del XML, y nada más. Rechaza un XML peligroso (DTD o
// entidades, demasiado grande o demasiado anidado), cualquier otro documento, y todo elemento que el
// builder del sistema no escribe (ICE, IRBPNR, propina, información adicional…): el RIDE nunca omite
// contenido en silencio ni afirma un soporte que la emisión no tiene. Los textos e importes salen tal
// como están en el XML, sin recortarlos ni convertirlos a número.
import { XMLParser, XMLValidator } from "fast-xml-parser";
import {
  RideRejectedError,
  type RideCreditNote,
  type RideDebitNote,
  type RideDocumentData,
  type RideInvoice,
  type RideLine,
  type RideShippingGuide,
  type RideSourceInput,
  type RideSourceReader,
  type RideTax,
  type RideWithholdingReceipt,
} from "../../application/ride.ts";

/** Mayor que cualquier comprobante firmado admitido por la política de tamaño del envío. */
export const RIDE_XML_MAX_BYTES = 2 * 1024 * 1024;
/** La factura anida unos 8 niveles y la firma XAdES unos 12: 24 deja margen sin abrir abusos. */
export const RIDE_XML_MAX_DEPTH = 24;
/** La única versión que escribe el builder de add-invoice-emission (`INVOICE_SCHEMA_VERSION`). */
export const RIDE_INVOICE_VERSION = "1.1.0";
/** La única versión que escribe el builder de add-credit-notes (`CREDIT_NOTE_SCHEMA_VERSION`). */
export const RIDE_CREDIT_NOTE_VERSION = "1.1.0";
/** La única versión que escribe el builder de add-debit-notes (`DEBIT_NOTE_SCHEMA_VERSION`). */
export const RIDE_DEBIT_NOTE_VERSION = "1.0.0";
/** La única versión que escribe el builder de add-withholding-receipts. */
export const RIDE_WITHHOLDING_RECEIPT_VERSION = "2.0.0";
/** La única versión que escribe el builder de add-shipping-guides (`SHIPPING_GUIDE_SCHEMA_VERSION`). */
export const RIDE_SHIPPING_GUIDE_VERSION = "1.1.0";
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
/** Elementos que el builder de la nota de crédito escribe, por ruta del padre (design D12). */
const CREDIT_NOTE_ALLOWED: Readonly<Record<string, readonly string[]>> = {
  notaCredito: ["infoTributaria", "infoNotaCredito", "detalles", "Signature"],
  "notaCredito.infoTributaria": ALLOWED["factura.infoTributaria"]!,
  "notaCredito.infoNotaCredito": [
    "fechaEmision",
    "dirEstablecimiento",
    "tipoIdentificacionComprador",
    "razonSocialComprador",
    "identificacionComprador",
    "contribuyenteEspecial",
    "obligadoContabilidad",
    "codDocModificado",
    "numDocModificado",
    "fechaEmisionDocSustento",
    "totalSinImpuestos",
    "valorModificacion",
    "moneda",
    "totalConImpuestos",
    "motivo",
  ],
  "notaCredito.infoNotaCredito.totalConImpuestos": ["totalImpuesto"],
  "notaCredito.infoNotaCredito.totalConImpuestos.totalImpuesto": [
    "codigo",
    "codigoPorcentaje",
    "baseImponible",
    "valor",
  ],
  "notaCredito.detalles": ["detalle"],
  "notaCredito.detalles.detalle": [
    "codigoInterno",
    "codigoAdicional",
    "descripcion",
    "cantidad",
    "precioUnitario",
    "descuento",
    "precioTotalSinImpuesto",
    "impuestos",
  ],
  "notaCredito.detalles.detalle.impuestos": ["impuesto"],
  "notaCredito.detalles.detalle.impuestos.impuesto":
    ALLOWED["factura.detalles.detalle.impuestos.impuesto"]!,
};

/**
 * Elementos que el builder de la nota de débito escribe, por ruta del padre (add-debit-notes, design
 * D16): sin `rise`, compensaciones, `valorDevolucionIva`, plazo, unidad de tiempo, máquina fiscal ni
 * información adicional.
 */
const DEBIT_NOTE_ALLOWED: Readonly<Record<string, readonly string[]>> = {
  notaDebito: ["infoTributaria", "infoNotaDebito", "motivos", "Signature"],
  "notaDebito.infoTributaria": ALLOWED["factura.infoTributaria"]!,
  "notaDebito.infoNotaDebito": [
    "fechaEmision",
    "dirEstablecimiento",
    "tipoIdentificacionComprador",
    "razonSocialComprador",
    "identificacionComprador",
    "contribuyenteEspecial",
    "obligadoContabilidad",
    "codDocModificado",
    "numDocModificado",
    "fechaEmisionDocSustento",
    "totalSinImpuestos",
    "impuestos",
    "valorTotal",
    "pagos",
  ],
  "notaDebito.infoNotaDebito.impuestos": ["impuesto"],
  "notaDebito.infoNotaDebito.impuestos.impuesto": [
    "codigo",
    "codigoPorcentaje",
    "tarifa",
    "baseImponible",
    "valor",
  ],
  "notaDebito.infoNotaDebito.pagos": ["pago"],
  "notaDebito.infoNotaDebito.pagos.pago": ["formaPago", "total"],
  "notaDebito.motivos": ["motivo"],
  "notaDebito.motivos.motivo": ["razon", "valor"],
};

/**
 * Elementos que el builder del comprobante de retención escribe, por ruta del padre
 * (add-withholding-receipts, design D17): sin `tipoSujetoRetenido`, `fechaRegistroContable`,
 * `tipoRegi`, `paisEfecPago`, convenios, reembolsos, dividendos, banano, máquina fiscal ni
 * información adicional.
 */
const WITHHOLDING_SUPPORT = "comprobanteRetencion.docsSustento.docSustento";
const WITHHOLDING_ALLOWED: Readonly<Record<string, readonly string[]>> = {
  comprobanteRetencion: ["infoTributaria", "infoCompRetencion", "docsSustento", "Signature"],
  "comprobanteRetencion.infoTributaria": ALLOWED["factura.infoTributaria"]!,
  "comprobanteRetencion.infoCompRetencion": [
    "fechaEmision",
    "dirEstablecimiento",
    "contribuyenteEspecial",
    "obligadoContabilidad",
    "tipoIdentificacionSujetoRetenido",
    "parteRel",
    "razonSocialSujetoRetenido",
    "identificacionSujetoRetenido",
    "periodoFiscal",
  ],
  "comprobanteRetencion.docsSustento": ["docSustento"],
  [WITHHOLDING_SUPPORT]: [
    "codSustento",
    "codDocSustento",
    "numDocSustento",
    "fechaEmisionDocSustento",
    "numAutDocSustento",
    "pagoLocExt",
    "totalSinImpuestos",
    "importeTotal",
    "impuestosDocSustento",
    "retenciones",
    "pagos",
  ],
  [`${WITHHOLDING_SUPPORT}.impuestosDocSustento`]: ["impuestoDocSustento"],
  [`${WITHHOLDING_SUPPORT}.impuestosDocSustento.impuestoDocSustento`]: [
    "codImpuestoDocSustento",
    "codigoPorcentaje",
    "baseImponible",
    "tarifa",
    "valorImpuesto",
  ],
  [`${WITHHOLDING_SUPPORT}.retenciones`]: ["retencion"],
  [`${WITHHOLDING_SUPPORT}.retenciones.retencion`]: [
    "codigo",
    "codigoRetencion",
    "baseImponible",
    "porcentajeRetener",
    "valorRetenido",
  ],
  [`${WITHHOLDING_SUPPORT}.pagos`]: ["pago"],
  [`${WITHHOLDING_SUPPORT}.pagos.pago`]: ["formaPago", "total"],
};
/**
 * Elementos que el builder de la guía de remisión escribe, por ruta del padre (add-shipping-guides,
 * design D16): sin `rise`, `docAduaneroUnico`, `detallesAdicionales`, `maquinaFiscal` ni
 * `infoAdicional`.
 */
const SHIPPING_RECIPIENT = "guiaRemision.destinatarios.destinatario";
const SHIPPING_GUIDE_ALLOWED: Readonly<Record<string, readonly string[]>> = {
  guiaRemision: ["infoTributaria", "infoGuiaRemision", "destinatarios", "Signature"],
  "guiaRemision.infoTributaria": ALLOWED["factura.infoTributaria"]!,
  "guiaRemision.infoGuiaRemision": [
    "dirEstablecimiento",
    "dirPartida",
    "razonSocialTransportista",
    "tipoIdentificacionTransportista",
    "rucTransportista",
    "obligadoContabilidad",
    "contribuyenteEspecial",
    "fechaIniTransporte",
    "fechaFinTransporte",
    "placa",
  ],
  "guiaRemision.destinatarios": ["destinatario"],
  [SHIPPING_RECIPIENT]: [
    "identificacionDestinatario",
    "razonSocialDestinatario",
    "dirDestinatario",
    "motivoTraslado",
    "codEstabDestino",
    "ruta",
    "codDocSustento",
    "numDocSustento",
    "numAutDocSustento",
    "fechaEmisionDocSustento",
    "detalles",
  ],
  [`${SHIPPING_RECIPIENT}.detalles`]: ["detalle"],
  [`${SHIPPING_RECIPIENT}.detalles.detalle`]: [
    "codigoInterno",
    "codigoAdicional",
    "descripcion",
    "cantidad",
  ],
};
/** El único comprobante de venta que la guía referencia: una factura propia (design D8). */
const SHIPPING_SUPPORT_DOCUMENT = "01";
/** Los cuatro datos del sustento: van todos o ninguno. */
const SHIPPING_SUPPORT_FIELDS = [
  "codDocSustento",
  "numDocSustento",
  "numAutDocSustento",
  "fechaEmisionDocSustento",
] as const;

/** Impuestos a retener que la emisión produce (renta e IVA): sin ISD. */
const WITHHOLDING_TAXES = new Set(["1", "2"]);
/** Impuestos declarados del documento sustento: IVA, ICE e IRBPNR. */
const SUPPORT_TAXES = new Set(["2", "3", "5"]);
/** Tipos de documento sustento del MVP: factura, nota de venta y liquidación de compra. */
const SUPPORT_DOCUMENT_TYPES = new Set(["01", "02", "03"]);
/** Pago local (tabla 15 del Catálogo ATS): el único que la emisión escribe. */
const LOCAL_PAYMENT = "01";

/** Lista blanca de una raíz: sus elementos por padre y sus hojas de texto. */
type Whitelist = Readonly<{
  allowed: Readonly<Record<string, readonly string[]>>;
  leaves: ReadonlySet<string>;
  signature: string;
}>;

/** Hojas de texto: no tienen hijos. La firma no es una hoja, pero tampoco se recorre. */
function whitelist(root: string, allowed: Readonly<Record<string, readonly string[]>>): Whitelist {
  const signature = `${root}.Signature`;
  return {
    allowed,
    signature,
    leaves: new Set(
      Object.entries(allowed).flatMap(([parent, children]) =>
        children
          .map((name) => `${parent}.${name}`)
          .filter((path) => !(path in allowed) && path !== signature),
      ),
    ),
  };
}
const INVOICE_WHITELIST = whitelist("factura", ALLOWED);
const CREDIT_NOTE_WHITELIST = whitelist("notaCredito", CREDIT_NOTE_ALLOWED);
const DEBIT_NOTE_WHITELIST = whitelist("notaDebito", DEBIT_NOTE_ALLOWED);
const WITHHOLDING_WHITELIST = whitelist("comprobanteRetencion", WITHHOLDING_ALLOWED);
const SHIPPING_GUIDE_WHITELIST = whitelist("guiaRemision", SHIPPING_GUIDE_ALLOWED);
const ARRAYS = new Set([
  "factura.detalles.detalle",
  "factura.detalles.detalle.impuestos.impuesto",
  "factura.infoFactura.totalConImpuestos.totalImpuesto",
  "factura.infoFactura.pagos.pago",
  "notaCredito.detalles.detalle",
  "notaCredito.detalles.detalle.impuestos.impuesto",
  "notaCredito.infoNotaCredito.totalConImpuestos.totalImpuesto",
  "notaDebito.infoNotaDebito.impuestos.impuesto",
  "notaDebito.infoNotaDebito.pagos",
  "notaDebito.infoNotaDebito.pagos.pago",
  "notaDebito.motivos.motivo",
  "comprobanteRetencion.docsSustento",
  WITHHOLDING_SUPPORT,
  `${WITHHOLDING_SUPPORT}.impuestosDocSustento`,
  `${WITHHOLDING_SUPPORT}.impuestosDocSustento.impuestoDocSustento`,
  `${WITHHOLDING_SUPPORT}.retenciones`,
  `${WITHHOLDING_SUPPORT}.retenciones.retencion`,
  `${WITHHOLDING_SUPPORT}.pagos`,
  `${WITHHOLDING_SUPPORT}.pagos.pago`,
  "guiaRemision.destinatarios",
  SHIPPING_RECIPIENT,
  `${SHIPPING_RECIPIENT}.detalles`,
  `${SHIPPING_RECIPIENT}.detalles.detalle`,
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
function unsupportedElements(
  node: Node,
  path: string,
  found: Set<string>,
  list: Whitelist = INVOICE_WHITELIST,
): void {
  const allowed = list.allowed[path];
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
    if (childPath === list.signature) continue;
    if (list.leaves.has(childPath)) {
      const leaf = Array.isArray(value) ? value : [value];
      if (leaf.length > 1 || leaf.some((item) => isNode(item) && hasElements(item))) {
        found.add(childPath);
      }
      continue;
    }
    for (const item of Array.isArray(value) ? value : [value]) {
      if (isNode(item)) unsupportedElements(item, childPath, found, list);
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

/** El XML de origen parseado con sus defensas: tamaño, UTF-8, sin DTD, bien formado y acotado. */
function parseSource(input: RideSourceInput): Readonly<{ document: unknown; roots: string[] }> {
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
  return { document, roots };
}

/** Lee la factura 1.1.0; cualquier otro comprobante se rechaza. */
export function readRideSource(input: RideSourceInput): RideInvoice {
  return readInvoice(parseSource(input), input);
}

function readInvoice(
  { document, roots }: Readonly<{ document: unknown; roots: string[] }>,
  input: RideSourceInput,
): RideInvoice {
  const { authorization } = input;
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

/** Lee la nota de crédito 1.1.0 que el sistema emite (add-credit-notes, design D14). */
function readCreditNote(
  { document, roots }: Readonly<{ document: unknown; roots: string[] }>,
  input: RideSourceInput,
): RideCreditNote {
  const { authorization } = input;
  const nota = isNode(document) ? document.notaCredito : undefined;
  if (roots.length !== 1 || !isNode(nota)) throw invalid("NOT_CREDIT_NOTE");
  if (nota["@_version"] !== RIDE_CREDIT_NOTE_VERSION) throw invalid("UNSUPPORTED_VERSION");
  const tributaria = nota.infoTributaria;
  const info = nota.infoNotaCredito;
  const detalles = nota.detalles;
  if (!isNode(tributaria) || !isNode(info) || !isNode(detalles)) throw invalid("NOT_CREDIT_NOTE");
  if (required(tributaria, "codDoc", "infoTributaria") !== "04") throw invalid("NOT_CREDIT_NOTE");

  const unsupported = new Set<string>();
  unsupportedElements(nota, "notaCredito", unsupported, CREDIT_NOTE_WHITELIST);
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
  // El XML, la nota guardada y su autorización deben describir el mismo comprobante: la clave
  // impresa y el código de barras son los de la nota, nunca los de la factura que modifica.
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
    mainCode: text(detalle, "codigoInterno", "detalle"),
    auxiliaryCode: text(detalle, "codigoAdicional", "detalle"),
    description: required(detalle, "descripcion", "detalle"),
    quantity: required(detalle, "cantidad", "detalle"),
    unitPrice: required(detalle, "precioUnitario", "detalle"),
    discount: required(detalle, "descuento", "detalle"),
    total: required(detalle, "precioTotalSinImpuesto", "detalle"),
  }));
  if (lines.length === 0) throw invalid("MISSING:detalles.detalle");

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

  return {
    kind: "CREDIT_NOTE",
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
    establishmentAddress: text(info, "dirEstablecimiento", "infoNotaCredito"),
    specialTaxpayer: text(info, "contribuyenteEspecial", "infoNotaCredito"),
    accountingRequired: required(info, "obligadoContabilidad", "infoNotaCredito"),
    withholdingAgentResolution: text(tributaria, "agenteRetencion", "infoTributaria"),
    rimpeLegend: text(tributaria, "contribuyenteRimpe", "infoTributaria"),
    issueDate: required(info, "fechaEmision", "infoNotaCredito"),
    buyer: {
      identificationType: required(info, "tipoIdentificacionComprador", "infoNotaCredito"),
      identification: required(info, "identificacionComprador", "infoNotaCredito"),
      legalName: required(info, "razonSocialComprador", "infoNotaCredito"),
    },
    modified: {
      documentType: required(info, "codDocModificado", "infoNotaCredito"),
      number: required(info, "numDocModificado", "infoNotaCredito"),
      issueDate: required(info, "fechaEmisionDocSustento", "infoNotaCredito"),
    },
    reason: required(info, "motivo", "infoNotaCredito"),
    totals: {
      withoutTaxes: required(info, "totalSinImpuestos", "infoNotaCredito"),
      taxes,
      total: required(info, "valorModificacion", "infoNotaCredito"),
    },
    lines,
    authorization,
  };
}

/**
 * Lee la nota de débito 1.0.0 que el sistema emite (add-debit-notes, design D18): sus motivos, la
 * única forma de pago y los impuestos por tratamiento con su tarifa. Más de un bloque de pagos o de
 * un pago es contenido que el builder no escribe.
 */
function readDebitNote(
  { document, roots }: Readonly<{ document: unknown; roots: string[] }>,
  input: RideSourceInput,
): RideDebitNote {
  const { authorization } = input;
  const nota = isNode(document) ? document.notaDebito : undefined;
  if (roots.length !== 1 || !isNode(nota)) throw invalid("NOT_DEBIT_NOTE");
  if (nota["@_version"] !== RIDE_DEBIT_NOTE_VERSION) throw invalid("UNSUPPORTED_VERSION");
  const tributaria = nota.infoTributaria;
  const info = nota.infoNotaDebito;
  const motivos = nota.motivos;
  if (!isNode(tributaria) || !isNode(info) || !isNode(motivos)) throw invalid("NOT_DEBIT_NOTE");
  if (required(tributaria, "codDoc", "infoTributaria") !== "05") throw invalid("NOT_DEBIT_NOTE");

  const unsupported = new Set<string>();
  unsupportedElements(nota, "notaDebito", unsupported, DEBIT_NOTE_WHITELIST);
  const taxNodes = list(isNode(info.impuestos) ? info.impuestos.impuesto : undefined);
  for (const tax of taxNodes) {
    const code = text(tax, "codigo", "impuesto");
    if (code !== IVA) unsupported.add(`impuesto.codigo:${code ?? ""}`);
  }
  const paymentBlocks = list(info.pagos);
  const paymentNodes = paymentBlocks.flatMap((block) => list(block.pago));
  if (paymentBlocks.length > 1) unsupported.add("notaDebito.infoNotaDebito.pagos");
  if (paymentNodes.length > 1) unsupported.add("notaDebito.infoNotaDebito.pagos.pago");
  if (unsupported.size > 0) {
    throw new RideRejectedError("RIDE_SOURCE_UNSUPPORTED", [...unsupported].sort());
  }

  const accessKey = required(tributaria, "claveAcceso", "infoTributaria");
  const environment = required(tributaria, "ambiente", "infoTributaria");
  if (environment !== "1" && environment !== "2") throw invalid("infoTributaria.ambiente");
  // El XML, la nota guardada y su autorización deben describir el mismo comprobante: la clave
  // impresa y el código de barras son los de la nota, nunca los de la factura que modifica.
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

  const reasons = list(motivos.motivo).map((motivo) => ({
    reason: required(motivo, "razon", "motivo"),
    value: required(motivo, "valor", "motivo"),
  }));
  if (reasons.length === 0) throw invalid("MISSING:motivos.motivo");
  if (paymentNodes.length === 0) throw invalid("MISSING:pagos.pago");
  const payments = paymentNodes.map((pago) => {
    const method = required(pago, "formaPago", "pago");
    return {
      method,
      label: input.paymentLabels[method] ?? null,
      total: required(pago, "total", "pago"),
    };
  });
  const taxes = taxNodes.map((tax): RideTax => ({
    rateCode: required(tax, "codigoPorcentaje", "impuesto"),
    rate: required(tax, "tarifa", "impuesto"),
    base: required(tax, "baseImponible", "impuesto"),
    amount: required(tax, "valor", "impuesto"),
  }));

  return {
    kind: "DEBIT_NOTE",
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
    establishmentAddress: text(info, "dirEstablecimiento", "infoNotaDebito"),
    specialTaxpayer: text(info, "contribuyenteEspecial", "infoNotaDebito"),
    accountingRequired: required(info, "obligadoContabilidad", "infoNotaDebito"),
    withholdingAgentResolution: text(tributaria, "agenteRetencion", "infoTributaria"),
    rimpeLegend: text(tributaria, "contribuyenteRimpe", "infoTributaria"),
    issueDate: required(info, "fechaEmision", "infoNotaDebito"),
    buyer: {
      identificationType: required(info, "tipoIdentificacionComprador", "infoNotaDebito"),
      identification: required(info, "identificacionComprador", "infoNotaDebito"),
      legalName: required(info, "razonSocialComprador", "infoNotaDebito"),
    },
    modified: {
      documentType: required(info, "codDocModificado", "infoNotaDebito"),
      number: required(info, "numDocModificado", "infoNotaDebito"),
      issueDate: required(info, "fechaEmisionDocSustento", "infoNotaDebito"),
    },
    reasons,
    totals: {
      withoutTaxes: required(info, "totalSinImpuestos", "infoNotaDebito"),
      taxes,
      total: required(info, "valorTotal", "infoNotaDebito"),
    },
    payments,
    authorization,
  };
}

/**
 * Lee el comprobante de retención 2.0.0 que el sistema emite (add-withholding-receipts, design D19):
 * el sujeto retenido, el período fiscal y cada documento sustento con sus impuestos declarados y sus
 * retenciones, con las denominaciones del snapshot. Un impuesto a retener distinto de renta o IVA, un
 * impuesto declarado distinto de IVA, ICE o IRBPNR, un tipo de documento fuera del MVP, un pago al
 * exterior o un bloque repetido es contenido que el builder no escribe.
 */
function readWithholdingReceipt(
  { document, roots }: Readonly<{ document: unknown; roots: string[] }>,
  input: RideSourceInput,
): RideWithholdingReceipt {
  const { authorization } = input;
  const comprobante = isNode(document) ? document.comprobanteRetencion : undefined;
  if (roots.length !== 1 || !isNode(comprobante)) throw invalid("NOT_WITHHOLDING_RECEIPT");
  if (comprobante["@_version"] !== RIDE_WITHHOLDING_RECEIPT_VERSION) {
    throw invalid("UNSUPPORTED_VERSION");
  }
  const tributaria = comprobante.infoTributaria;
  const info = comprobante.infoCompRetencion;
  const blocks = list(comprobante.docsSustento);
  if (!isNode(tributaria) || !isNode(info) || blocks.length === 0) {
    throw invalid("NOT_WITHHOLDING_RECEIPT");
  }
  if (required(tributaria, "codDoc", "infoTributaria") !== "07") {
    throw invalid("NOT_WITHHOLDING_RECEIPT");
  }

  const unsupported = new Set<string>();
  unsupportedElements(comprobante, "comprobanteRetencion", unsupported, WITHHOLDING_WHITELIST);
  if (blocks.length > 1) unsupported.add("comprobanteRetencion.docsSustento");
  const supportNodes = blocks.flatMap((block) => list(block.docSustento));
  /** Un único bloque contenedor por documento: uno repetido es contenido que no se emite. */
  const single = (support: Node, name: string): Node[] => {
    const containers = list(support[name]);
    if (containers.length > 1) unsupported.add(`${WITHHOLDING_SUPPORT}.${name}`);
    return containers;
  };
  const supports = supportNodes.map((support) => ({
    support,
    taxes: single(support, "impuestosDocSustento").flatMap((block) =>
      list(block.impuestoDocSustento),
    ),
    withholdings: single(support, "retenciones").flatMap((block) => list(block.retencion)),
    payments: single(support, "pagos").flatMap((block) => list(block.pago)),
  }));
  for (const { support, taxes, withholdings } of supports) {
    const documentType = text(support, "codDocSustento", "docSustento");
    if (!SUPPORT_DOCUMENT_TYPES.has(documentType ?? "")) {
      unsupported.add(`docSustento.codDocSustento:${documentType ?? ""}`);
    }
    const payment = text(support, "pagoLocExt", "docSustento");
    if (payment !== LOCAL_PAYMENT) unsupported.add(`docSustento.pagoLocExt:${payment ?? ""}`);
    for (const tax of taxes) {
      const code = text(tax, "codImpuestoDocSustento", "impuestoDocSustento");
      if (!SUPPORT_TAXES.has(code ?? "")) {
        unsupported.add(`impuestoDocSustento.codImpuestoDocSustento:${code ?? ""}`);
      }
    }
    for (const item of withholdings) {
      const code = text(item, "codigo", "retencion");
      if (!WITHHOLDING_TAXES.has(code ?? "")) unsupported.add(`retencion.codigo:${code ?? ""}`);
    }
  }
  if (unsupported.size > 0) {
    throw new RideRejectedError("RIDE_SOURCE_UNSUPPORTED", [...unsupported].sort());
  }

  const accessKey = required(tributaria, "claveAcceso", "infoTributaria");
  const environment = required(tributaria, "ambiente", "infoTributaria");
  if (environment !== "1" && environment !== "2") throw invalid("infoTributaria.ambiente");
  // El XML, la retención guardada y su autorización deben describir el mismo comprobante: la clave
  // impresa y el código de barras son los de la retención, nunca los de un documento sustento.
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

  if (supports.length === 0) throw invalid("MISSING:docsSustento.docSustento");
  const labels = input.withholdingLabels;
  const readSupports = supports.map(({ support, taxes, withholdings }) => {
    const documentType = required(support, "codDocSustento", "docSustento");
    if (withholdings.length === 0) throw invalid("MISSING:retenciones.retencion");
    return {
      documentType,
      documentTypeLabel: labels?.documentTypes[documentType] ?? null,
      number: required(support, "numDocSustento", "docSustento"),
      issueDate: required(support, "fechaEmisionDocSustento", "docSustento"),
      taxes: taxes.map((tax) => {
        const taxCode = required(tax, "codImpuestoDocSustento", "impuestoDocSustento");
        return {
          taxCode,
          taxLabel: labels?.supportTaxes[taxCode] ?? null,
          rateCode: required(tax, "codigoPorcentaje", "impuestoDocSustento"),
          base: required(tax, "baseImponible", "impuestoDocSustento"),
          tariff: required(tax, "tarifa", "impuestoDocSustento"),
          amount: required(tax, "valorImpuesto", "impuestoDocSustento"),
        };
      }),
      withholdings: withholdings.map((item) => {
        const taxCode = required(item, "codigo", "retencion");
        return {
          taxCode,
          taxLabel: labels?.taxes[taxCode] ?? null,
          code: required(item, "codigoRetencion", "retencion"),
          base: required(item, "baseImponible", "retencion"),
          percentage: required(item, "porcentajeRetener", "retencion"),
          amount: required(item, "valorRetenido", "retencion"),
        };
      }),
    };
  });

  return {
    kind: "WITHHOLDING_RECEIPT",
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
    establishmentAddress: text(info, "dirEstablecimiento", "infoCompRetencion"),
    specialTaxpayer: text(info, "contribuyenteEspecial", "infoCompRetencion"),
    accountingRequired: required(info, "obligadoContabilidad", "infoCompRetencion"),
    withholdingAgentResolution: text(tributaria, "agenteRetencion", "infoTributaria"),
    rimpeLegend: text(tributaria, "contribuyenteRimpe", "infoTributaria"),
    issueDate: required(info, "fechaEmision", "infoCompRetencion"),
    subject: {
      identificationType: required(info, "tipoIdentificacionSujetoRetenido", "infoCompRetencion"),
      identification: required(info, "identificacionSujetoRetenido", "infoCompRetencion"),
      legalName: required(info, "razonSocialSujetoRetenido", "infoCompRetencion"),
    },
    fiscalPeriod: required(info, "periodoFiscal", "infoCompRetencion"),
    supports: readSupports,
    authorization,
  };
}

/**
 * Lee la guía de remisión 1.1.0 que el sistema emite (add-shipping-guides, design D20): el transporte
 * y cada destinatario con su comprobante de venta y su detalle. Un sustento distinto de una factura
 * (`codDocSustento` 01), un sustento incompleto o un bloque repetido es contenido que el builder no
 * escribe.
 */
function readShippingGuide(
  { document, roots }: Readonly<{ document: unknown; roots: string[] }>,
  input: RideSourceInput,
): RideShippingGuide {
  const { authorization } = input;
  const guia = isNode(document) ? document.guiaRemision : undefined;
  if (roots.length !== 1 || !isNode(guia)) throw invalid("NOT_SHIPPING_GUIDE");
  if (guia["@_version"] !== RIDE_SHIPPING_GUIDE_VERSION) throw invalid("UNSUPPORTED_VERSION");
  const tributaria = guia.infoTributaria;
  const info = guia.infoGuiaRemision;
  const blocks = list(guia.destinatarios);
  if (!isNode(tributaria) || !isNode(info) || blocks.length === 0) {
    throw invalid("NOT_SHIPPING_GUIDE");
  }
  if (required(tributaria, "codDoc", "infoTributaria") !== "06") {
    throw invalid("NOT_SHIPPING_GUIDE");
  }

  const unsupported = new Set<string>();
  unsupportedElements(guia, "guiaRemision", unsupported, SHIPPING_GUIDE_WHITELIST);
  if (blocks.length > 1) unsupported.add("guiaRemision.destinatarios");
  const recipientNodes = blocks.flatMap((block) => list(block.destinatario));
  const recipients = recipientNodes.map((recipient) => {
    const containers = list(recipient.detalles);
    if (containers.length > 1) unsupported.add(`${SHIPPING_RECIPIENT}.detalles`);
    return { recipient, details: containers.flatMap((block) => list(block.detalle)) };
  });
  for (const { recipient } of recipients) {
    const present = SHIPPING_SUPPORT_FIELDS.filter((field) => recipient[field] !== undefined);
    if (present.length > 0 && present.length < SHIPPING_SUPPORT_FIELDS.length) {
      unsupported.add(`${SHIPPING_RECIPIENT}.sustento`);
    }
    const documentType = text(recipient, "codDocSustento", "destinatario");
    if (documentType !== null && documentType !== SHIPPING_SUPPORT_DOCUMENT) {
      unsupported.add(`destinatario.codDocSustento:${documentType}`);
    }
  }
  if (unsupported.size > 0) {
    throw new RideRejectedError("RIDE_SOURCE_UNSUPPORTED", [...unsupported].sort());
  }

  const accessKey = required(tributaria, "claveAcceso", "infoTributaria");
  const environment = required(tributaria, "ambiente", "infoTributaria");
  if (environment !== "1" && environment !== "2") throw invalid("infoTributaria.ambiente");
  // El XML, la guía guardada y su autorización deben describir el mismo comprobante: la clave impresa
  // y el código de barras son los de la guía, nunca los de una factura sustento.
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

  if (recipients.length === 0) throw invalid("MISSING:destinatarios.destinatario");
  const readRecipients = recipients.map(({ recipient, details }) => {
    if (details.length === 0) throw invalid("MISSING:detalles.detalle");
    const documentType = text(recipient, "codDocSustento", "destinatario");
    return {
      identification: required(recipient, "identificacionDestinatario", "destinatario"),
      legalName: required(recipient, "razonSocialDestinatario", "destinatario"),
      address: required(recipient, "dirDestinatario", "destinatario"),
      motive: required(recipient, "motivoTraslado", "destinatario"),
      destinationEstablishmentCode: text(recipient, "codEstabDestino", "destinatario"),
      route: text(recipient, "ruta", "destinatario"),
      support:
        documentType === null
          ? null
          : {
              documentType,
              number: required(recipient, "numDocSustento", "destinatario"),
              authorizationNumber: required(recipient, "numAutDocSustento", "destinatario"),
              issueDate: required(recipient, "fechaEmisionDocSustento", "destinatario"),
            },
      details: details.map((detalle) => ({
        mainCode: text(detalle, "codigoInterno", "detalle"),
        auxiliaryCode: text(detalle, "codigoAdicional", "detalle"),
        description: required(detalle, "descripcion", "detalle"),
        quantity: required(detalle, "cantidad", "detalle"),
      })),
    };
  });

  return {
    kind: "SHIPPING_GUIDE",
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
    establishmentAddress: text(info, "dirEstablecimiento", "infoGuiaRemision"),
    specialTaxpayer: text(info, "contribuyenteEspecial", "infoGuiaRemision"),
    accountingRequired: required(info, "obligadoContabilidad", "infoGuiaRemision"),
    withholdingAgentResolution: text(tributaria, "agenteRetencion", "infoTributaria"),
    rimpeLegend: text(tributaria, "contribuyenteRimpe", "infoTributaria"),
    carrier: {
      identificationType: required(info, "tipoIdentificacionTransportista", "infoGuiaRemision"),
      identification: required(info, "rucTransportista", "infoGuiaRemision"),
      legalName: required(info, "razonSocialTransportista", "infoGuiaRemision"),
    },
    plate: required(info, "placa", "infoGuiaRemision"),
    departureAddress: required(info, "dirPartida", "infoGuiaRemision"),
    transportStart: required(info, "fechaIniTransporte", "infoGuiaRemision"),
    transportEnd: required(info, "fechaFinTransporte", "infoGuiaRemision"),
    recipients: readRecipients,
    authorization,
  };
}

/**
 * Elige la lectura por la raíz del XML: la factura, la nota de crédito, la nota de débito, el
 * comprobante de retención o la guía de remisión que el sistema emite.
 */
export function readRideDocument(input: RideSourceInput): RideDocumentData {
  const parsed = parseSource(input);
  const root = parsed.roots.length === 1 ? parsed.roots[0] : undefined;
  if (root === "notaCredito") return readCreditNote(parsed, input);
  if (root === "notaDebito") return readDebitNote(parsed, input);
  if (root === "comprobanteRetencion") return readWithholdingReceipt(parsed, input);
  if (root === "guiaRemision") return readShippingGuide(parsed, input);
  return readInvoice(parsed, input);
}

export const rideSourceReader: RideSourceReader = { read: readRideDocument };
