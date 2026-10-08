// RIDE de la factura en PDF con pdfmake 0.3 (sobre pdfkit) y Code128 de bwip-js, en el servidor y
// sin navegador (ADR 0022; add-document-archive, design D7). Distribución del anexo 2 de la ficha
// v2.34 (página 60) para el contenido que la factura 1.1.0 del sistema trae: emisor y autorización
// arriba, comprador, detalle, formas de pago y totales de IVA. Solo lo carga el worker del RIDE.
//
// La nota de crédito 1.1.0 tiene su propia distribución (add-credit-notes, design D14; anexo 2,
// página 61): la misma cabecera con "NOTA DE CRÉDITO", su autorización y el Code128 de su clave; el
// comprador con el bloque del comprobante que se modifica, su fecha y la razón de la modificación;
// el detalle con código y código auxiliar; y los subtotales con el valor total, sin formas de pago.
//
// La nota de débito 1.0.0 también tiene la suya (add-debit-notes, design D18; anexo 2, página 62):
// "NOTA DE DÉBITO" con su autorización y el Code128 de su clave; el comprador con el comprobante que
// se modifica y su fecha; la tabla de razones y valores de la modificación; la forma de pago con su
// denominación del snapshot; y los subtotales por tratamiento con el IVA y el valor total.
//
// El comprobante de retención 2.0.0 tiene la suya (add-withholding-receipts, design D19; anexo 2,
// página 63, que la ficha manda usar para la versión 2.0.0): "COMPROBANTE DE RETENCIÓN" con su
// autorización y el Code128 de su clave; el sujeto retenido con la fecha de emisión; una fila por
// retención con el tipo, el número y la fecha de su documento sustento, el ejercicio fiscal, la base,
// el impuesto, el porcentaje y el valor retenido; y, como datos adicionales (anexo 2, página 60), un
// bloque por documento con sus impuestos declarados. Sin totales: el XML no trae un total retenido y
// el RIDE no suma.
//
// La guía de remisión 1.1.0 tiene la suya (add-shipping-guides, design D20; anexo 2, página 64):
// "GUÍA DE REMISIÓN" con su autorización y el Code128 de su clave; el bloque del transporte con el
// transportista, la placa, el punto de partida y las fechas; y un bloque por destinatario con su
// comprobante de venta, su fecha y su autorización, el motivo, el destino, la identificación, la
// razón social, el documento aduanero, el código del establecimiento de destino y la ruta (los
// rótulos sin dato quedan vacíos, como en el modelo), y la tabla de cantidad, descripción y códigos.
// Sin importes ni una fila para la fecha de emisión de la guía, que el modelo no tiene.
//
// La liquidación de compra 1.1.0 tiene la suya (add-purchase-settlements, design D19; anexo 2,
// página 65): "LIQUIDACIÓN DE COMPRA DE BIENES Y PRESTACIÓN DE SERVICIOS" con su autorización y el
// Code128 de su clave; el proveedor con su identificación, la fecha de emisión y su dirección; el
// detalle con códigos, cantidad, descripción, la unidad de medida cuando alguna línea la trae, precio
// unitario, descuento y precio total; cada forma de pago con su plazo y su valor; y los subtotales
// llenados, el IVA por tarifa y el valor total. Sin "Placa / Matrícula", "Guía Remisión", "Detalle
// Adicional", "Subsidio" ni "Precio sin Subsidio", que el dibujo hereda de la factura y la
// liquidación 1.1.0 del sistema no tiene; tampoco el total de descuentos, que el modelo no lleva.
//
// La lectura y la distribución se eligen por la raíz y la versión del XML.
//
// - Fuentes embebidas desde memoria (Noto Sans 2.015, OFL 1.1), con subconjunto; antes de dibujar
//   se comprueba que cada carácter tenga glifo en Regular y en Bold: nunca hay sustitución.
// - Ningún recurso externo: se niegan todas las URL y todo archivo local; el logo y las fuentes
//   llegan como bytes. pdfmake no interpreta HTML: el texto del comprobante se dibuja literal.
// - Code128 vectorial: rectángulos desde la secuencia barra/espacio de bwip-js, con zona de silencio
//   de 10 módulos; ocupa la columna de la autorización (unos 0.33 mm por módulo, nunca menos de
//   0.25) con un alto de al menos el 15 % del ancho y 6.35 mm.
// - Los importes son el texto exacto del XML, sin separadores ni conversión.
// - La fecha de creación es la de autorización: con las mismas versiones y la misma entrada, los
//   mismos bytes.
import bwipjs from "bwip-js";
import * as fontkit from "fontkit";
import pdfmake, { type Content, type DocumentDefinition, type TableCell } from "pdfmake";
import { FiscalDecimal } from "../../../../platform/decimal/fiscal-decimal.ts";
import {
  RideRejectedError,
  type RideCreditNote,
  type RideDebitNote,
  type RideDocumentData,
  type RideInvoice,
  type RideLogo,
  type RidePurchaseSettlement,
  type RideRenderInput,
  type RideRenderOutcome,
  type RideRenderer,
  type RideShippingGuide,
  type RideVersions,
  type RideWithholdingReceipt,
} from "../../application/ride.ts";
import { RIDE_FONTS_MANIFEST, type RideFonts } from "./ride-assets.ts";
import { readRideDocument } from "./ride-source.ts";

/** Versión propia del layout: cambia con cualquier cambio de la salida para una misma entrada. */
export const RIDE_RENDERER_VERSION = "1";
/** Versiones exactas instaladas; una prueba las compara con los paquetes. */
export const RIDE_LIBRARY_VERSIONS = {
  pdfmake: "0.3.11",
  pdfkit: "0.19.1",
  bwipJs: "4.11.4",
  fontkit: "2.0.4",
} as const;

export const RIDE_VERSIONS: RideVersions = {
  rendererVersion: RIDE_RENDERER_VERSION,
  ...RIDE_LIBRARY_VERSIONS,
  fonts: {
    family: RIDE_FONTS_MANIFEST.family,
    version: RIDE_FONTS_MANIFEST.version,
    regular: {
      file: RIDE_FONTS_MANIFEST.fonts.regular.file,
      sha256: RIDE_FONTS_MANIFEST.fonts.regular.sha256,
    },
    bold: {
      file: RIDE_FONTS_MANIFEST.fonts.bold.file,
      sha256: RIDE_FONTS_MANIFEST.fonts.bold.sha256,
    },
  },
};

/** Versión de la distribución de la nota de crédito: cambia con cualquier cambio de su salida. */
export const CREDIT_NOTE_RIDE_RENDERER_VERSION = "nota-credito-1";
export const CREDIT_NOTE_RIDE_VERSIONS: RideVersions = {
  ...RIDE_VERSIONS,
  rendererVersion: CREDIT_NOTE_RIDE_RENDERER_VERSION,
};

/** Versión de la distribución de la nota de débito: cambia con cualquier cambio de su salida. */
export const DEBIT_NOTE_RIDE_RENDERER_VERSION = "nota-debito-1";
export const DEBIT_NOTE_RIDE_VERSIONS: RideVersions = {
  ...RIDE_VERSIONS,
  rendererVersion: DEBIT_NOTE_RIDE_RENDERER_VERSION,
};

/** Versión de la distribución del comprobante de retención: cambia con cualquier cambio de su salida. */
export const WITHHOLDING_RIDE_RENDERER_VERSION = "retencion-1";
export const WITHHOLDING_RIDE_VERSIONS: RideVersions = {
  ...RIDE_VERSIONS,
  rendererVersion: WITHHOLDING_RIDE_RENDERER_VERSION,
};

/** Versión de la distribución de la guía de remisión: cambia con cualquier cambio de su salida. */
export const SHIPPING_GUIDE_RIDE_RENDERER_VERSION = "guia-remision-1";
export const SHIPPING_GUIDE_RIDE_VERSIONS: RideVersions = {
  ...RIDE_VERSIONS,
  rendererVersion: SHIPPING_GUIDE_RIDE_RENDERER_VERSION,
};

/** Versión de la distribución de la liquidación de compra: cambia con cualquier cambio de su salida. */
export const PURCHASE_SETTLEMENT_RIDE_RENDERER_VERSION = "liquidacion-compra-1";
export const PURCHASE_SETTLEMENT_RIDE_VERSIONS: RideVersions = {
  ...RIDE_VERSIONS,
  rendererVersion: PURCHASE_SETTLEMENT_RIDE_RENDERER_VERSION,
};

/** Tablas normativas fijas de la ficha (no son estado mutable). */
const ENVIRONMENTS: Readonly<Record<string, string>> = { "1": "PRUEBAS", "2": "PRODUCCIÓN" }; // tabla 4
const EMISSION_TYPES: Readonly<Record<string, string>> = { "1": "NORMAL" }; // tabla 2
/** Códigos de tarifa de IVA sin porcentaje propio (tabla 17): 0 %, no objeto y exento. */
const ZERO_RATE = "0";
const NOT_SUBJECT = "6";
const EXEMPT = "7";

export const PAGE_MARGIN_PT = 24;
const COLUMN_GAP_PT = 10;
/** Columna de la autorización, más ancha que la del emisor para un módulo de barras legible. */
export const AUTHORIZATION_COLUMN_PT = 330;
const BOX_PADDING_PT = 6;
const MM = 72 / 25.4;
export const BARCODE_QUIET_ZONE_MODULES = 10;
/** El código ocupa la columna de la autorización: unos 0.33 mm por módulo, nunca menos de 0.25. */
export const BARCODE_MIN_MODULE_MM = 0.25;
export const BARCODE_MIN_HEIGHT_MM = 6.35;
const FONT_NAME = "NotoSans";
const FONT_FILES = { normal: "NotoSans-Regular.ttf", bold: "NotoSans-Bold.ttf" } as const;

/** Geometría del código de barras de una clave: módulos, módulo y alto en puntos. */
export function barcodeGeometry(accessKey: string) {
  const [encoded] = bwipjs.raw({ bcid: "code128", text: accessKey }) as [
    { sbs: number[]; bbs: number[]; bhs: number[] },
  ];
  const modules = encoded.sbs.reduce((sum, width) => sum + width, 0);
  const available = AUTHORIZATION_COLUMN_PT - 2 * BOX_PADDING_PT;
  const moduleWidth = available / (modules + 2 * BARCODE_QUIET_ZONE_MODULES);
  const width = moduleWidth * (modules + 2 * BARCODE_QUIET_ZONE_MODULES);
  const height = Math.max(BARCODE_MIN_HEIGHT_MM * MM, 0.15 * width);
  return { sbs: encoded.sbs, modules, moduleWidth, width, height };
}

function barcode(accessKey: string): Content {
  const { sbs, moduleWidth, width, height } = barcodeGeometry(accessKey);
  if (moduleWidth < BARCODE_MIN_MODULE_MM * MM) {
    throw new Error("el módulo del código de barras quedaría por debajo del mínimo legible");
  }
  let x = BARCODE_QUIET_ZONE_MODULES * moduleWidth;
  const bars: Content[] = [];
  sbs.forEach((modules, index) => {
    const w = modules * moduleWidth;
    if (index % 2 === 0) bars.push({ type: "rect", x, y: 0, w, h: height, color: "#000000" });
    x += w;
  });
  return { canvas: bars, width, height, alignment: "center", margin: [0, 4, 0, 2] };
}

/** Fecha y hora de Ecuador (UTC-5, sin horario de verano) de la autorización guardada. */
function ecuadorDateTime(date: Date): string {
  const local = new Date(date.getTime() - 5 * 3_600_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(local.getUTCDate())}/${pad(local.getUTCMonth() + 1)}/${local.getUTCFullYear()} ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}`;
}

const rateOf = (rate: string | null) => FiscalDecimal.parse("tarifa", rate ?? "0");

const isCreditNote = (ride: RideDocumentData): ride is RideCreditNote =>
  ride.kind === "CREDIT_NOTE";
const isDebitNote = (ride: RideDocumentData): ride is RideDebitNote => ride.kind === "DEBIT_NOTE";
const isWithholding = (ride: RideDocumentData): ride is RideWithholdingReceipt =>
  ride.kind === "WITHHOLDING_RECEIPT";
const isShippingGuide = (ride: RideDocumentData): ride is RideShippingGuide =>
  ride.kind === "SHIPPING_GUIDE";
const isPurchaseSettlement = (ride: RideDocumentData): ride is RidePurchaseSettlement =>
  ride.kind === "PURCHASE_SETTLEMENT";
const isInvoice = (ride: RideDocumentData): ride is RideInvoice =>
  !isCreditNote(ride) &&
  !isDebitNote(ride) &&
  !isWithholding(ride) &&
  !isShippingGuide(ride) &&
  !isPurchaseSettlement(ride);
/** Denominación del comprobante modificado o de venta por su código (tabla 3 de la ficha). */
const MODIFIED_TYPES: Readonly<Record<string, string>> = { "01": "FACTURA" };
const modifiedTypeText = (ride: RideCreditNote | RideDebitNote) =>
  MODIFIED_TYPES[ride.modified.documentType] ?? ride.modified.documentType;
const titleOf = (ride: RideDocumentData) =>
  isCreditNote(ride)
    ? "NOTA DE CRÉDITO"
    : isDebitNote(ride)
      ? "NOTA DE DÉBITO"
      : isWithholding(ride)
        ? "COMPROBANTE DE RETENCIÓN"
        : isShippingGuide(ride)
          ? "GUÍA DE REMISIÓN"
          : isPurchaseSettlement(ride)
            ? "LIQUIDACIÓN DE COMPRA DE BIENES Y PRESTACIÓN DE SERVICIOS"
            : "FACTURA";

/** Subtotales en el orden del anexo 2; solo los que el comprobante llenó. */
export function totalRows(
  ride: RideInvoice | RideCreditNote | RideDebitNote | RidePurchaseSettlement,
): [string, string][] {
  const withRate = ride.totals.taxes
    .filter((tax) => ![ZERO_RATE, NOT_SUBJECT, EXEMPT].includes(tax.rateCode))
    // Solo para ordenar de menor a mayor tarifa; lo dibujado es el texto del XML.
    .toSorted((a, b) => rateOf(a.rate).compare(rateOf(b.rate)));
  const rateLabel = (tax: (typeof withRate)[number]) =>
    tax.rate === null ? `IVA código ${tax.rateCode}` : `${tax.rate}%`;
  const byCode = (code: string) => ride.totals.taxes.filter((tax) => tax.rateCode === code);
  const rows: [string, string][] = [];
  for (const tax of withRate) rows.push([`SUBTOTAL ${rateLabel(tax)}`, tax.base]);
  for (const tax of byCode(ZERO_RATE)) rows.push(["SUBTOTAL 0%", tax.base]);
  for (const tax of byCode(NOT_SUBJECT)) rows.push(["SUBTOTAL NO OBJETO DE IVA", tax.base]);
  for (const tax of byCode(EXEMPT)) rows.push(["SUBTOTAL EXENTO DE IVA", tax.base]);
  rows.push(["SUBTOTAL SIN IMPUESTOS", ride.totals.withoutTaxes]);
  // Las notas de crédito y de débito no traen el total de descuentos en su XML: no se calcula. El
  // modelo de la liquidación de compra (página 65) no tiene esa fila.
  if (isInvoice(ride)) rows.push(["TOTAL DESCUENTO", ride.totals.discount]);
  for (const tax of withRate) rows.push([`IVA ${rateLabel(tax)}`, tax.amount]);
  rows.push(["VALOR TOTAL", ride.totals.total]);
  return rows;
}

const paymentText = (payment: Readonly<{ method: string; label: string | null }>) =>
  payment.label === null ? payment.method : `${payment.method} - ${payment.label}`;
const documentNumber = (ride: RideDocumentData) =>
  `${ride.establishment}-${ride.emissionPoint}-${ride.sequential}`;
const environmentText = (ride: RideDocumentData) =>
  ENVIRONMENTS[ride.environment] ?? ride.environment;
const emissionText = (ride: RideDocumentData) =>
  EMISSION_TYPES[ride.emissionType] ?? ride.emissionType;

/** Textos del comprobante que se dibujan, para comprobar los glifos antes de maquetar. */
export function drawnStrings(ride: RideDocumentData): string[] {
  if (isCreditNote(ride)) return creditNoteStrings(ride);
  if (isDebitNote(ride)) return debitNoteStrings(ride);
  if (isWithholding(ride)) return withholdingStrings(ride);
  if (isShippingGuide(ride)) return shippingGuideStrings(ride);
  if (isPurchaseSettlement(ride)) return purchaseSettlementStrings(ride);
  return [
    documentNumber(ride),
    ride.authorization.number,
    environmentText(ride),
    emissionText(ride),
    ride.accessKey,
    ride.legalName,
    ride.tradeName ?? "",
    ride.headOfficeAddress,
    ride.establishmentAddress ?? "",
    ride.specialTaxpayer ?? "",
    ride.accountingRequired,
    ride.withholdingAgentResolution ?? "",
    ride.rimpeLegend ?? "",
    ride.ruc,
    ride.issueDate,
    ride.buyer.legalName,
    ride.buyer.identification,
    ride.buyer.address ?? "",
    ...ride.lines.flatMap((line) => [
      line.mainCode ?? "",
      line.auxiliaryCode ?? "",
      line.description,
      line.quantity,
      line.unitPrice,
      line.discount,
      line.total,
    ]),
    ...ride.payments.flatMap((payment) => [paymentText(payment), payment.total]),
    ...totalRows(ride).flat(),
  ];
}

const termText = (payment: RidePurchaseSettlement["payments"][number]) =>
  `${payment.term} ${payment.timeUnit}`;

function purchaseSettlementStrings(ride: RidePurchaseSettlement): string[] {
  return [
    documentNumber(ride),
    ride.authorization.number,
    environmentText(ride),
    emissionText(ride),
    ride.accessKey,
    ride.legalName,
    ride.tradeName ?? "",
    ride.headOfficeAddress,
    ride.establishmentAddress ?? "",
    ride.specialTaxpayer ?? "",
    ride.accountingRequired,
    ride.withholdingAgentResolution ?? "",
    ride.rimpeLegend ?? "",
    ride.ruc,
    ride.issueDate,
    ride.supplier.legalName,
    ride.supplier.identification,
    ride.supplier.address,
    ...ride.lines.flatMap((line) => [
      line.mainCode ?? "",
      line.auxiliaryCode ?? "",
      line.description,
      line.unit ?? "",
      line.quantity,
      line.unitPrice,
      line.discount,
      line.total,
    ]),
    ...ride.payments.flatMap((payment) => [paymentText(payment), termText(payment), payment.total]),
    ...totalRows(ride).flat(),
  ];
}

function creditNoteStrings(ride: RideCreditNote): string[] {
  return [
    documentNumber(ride),
    ride.authorization.number,
    environmentText(ride),
    emissionText(ride),
    ride.accessKey,
    ride.legalName,
    ride.tradeName ?? "",
    ride.headOfficeAddress,
    ride.establishmentAddress ?? "",
    ride.specialTaxpayer ?? "",
    ride.accountingRequired,
    ride.withholdingAgentResolution ?? "",
    ride.rimpeLegend ?? "",
    ride.ruc,
    ride.issueDate,
    ride.buyer.legalName,
    ride.buyer.identification,
    modifiedTypeText(ride),
    ride.modified.number,
    ride.modified.issueDate,
    ride.reason,
    ...ride.lines.flatMap((line) => [
      line.mainCode ?? "",
      line.auxiliaryCode ?? "",
      line.description,
      line.quantity,
      line.unitPrice,
      line.discount,
      line.total,
    ]),
    ...totalRows(ride).flat(),
  ];
}

function debitNoteStrings(ride: RideDebitNote): string[] {
  return [
    documentNumber(ride),
    ride.authorization.number,
    environmentText(ride),
    emissionText(ride),
    ride.accessKey,
    ride.legalName,
    ride.tradeName ?? "",
    ride.headOfficeAddress,
    ride.establishmentAddress ?? "",
    ride.specialTaxpayer ?? "",
    ride.accountingRequired,
    ride.withholdingAgentResolution ?? "",
    ride.rimpeLegend ?? "",
    ride.ruc,
    ride.issueDate,
    ride.buyer.legalName,
    ride.buyer.identification,
    modifiedTypeText(ride),
    ride.modified.number,
    ride.modified.issueDate,
    ...ride.reasons.flatMap((motivo) => [motivo.reason, motivo.value]),
    ...ride.payments.flatMap((payment) => [paymentText(payment), payment.total]),
    ...totalRows(ride).flat(),
  ];
}

type WithholdingSupport = RideWithholdingReceipt["supports"][number];
/** `numDocSustento` de 15 dígitos con el formato establecimiento-punto-secuencial. */
const supportNumber = (number: string) =>
  /^\d{15}$/.test(number)
    ? `${number.slice(0, 3)}-${number.slice(3, 6)}-${number.slice(6)}`
    : number;
const supportTypeText = (support: WithholdingSupport) =>
  support.documentTypeLabel ?? support.documentType;
const coded = (code: string, name: string | null) => (name === null ? code : `${code} - ${name}`);

function withholdingStrings(ride: RideWithholdingReceipt): string[] {
  return [
    documentNumber(ride),
    ride.authorization.number,
    environmentText(ride),
    emissionText(ride),
    ride.accessKey,
    ride.legalName,
    ride.tradeName ?? "",
    ride.headOfficeAddress,
    ride.establishmentAddress ?? "",
    ride.specialTaxpayer ?? "",
    ride.accountingRequired,
    ride.withholdingAgentResolution ?? "",
    ride.rimpeLegend ?? "",
    ride.ruc,
    ride.issueDate,
    ride.subject.legalName,
    ride.subject.identification,
    ride.fiscalPeriod,
    ...ride.supports.flatMap((support) => [
      supportTypeText(support),
      supportNumber(support.number),
      support.issueDate,
      ...support.withholdings.flatMap((item) => [
        item.base,
        item.taxLabel ?? item.taxCode,
        item.percentage,
        item.amount,
      ]),
      ...support.taxes.flatMap((tax) => [
        coded(tax.taxCode, tax.taxLabel),
        tax.rateCode,
        tax.base,
        tax.tariff,
        tax.amount,
      ]),
    ]),
  ];
}

type ShippingRecipient = RideShippingGuide["recipients"][number];
const saleDocumentText = (support: NonNullable<ShippingRecipient["support"]>) =>
  `${MODIFIED_TYPES[support.documentType] ?? support.documentType} ${support.number}`;

function shippingGuideStrings(ride: RideShippingGuide): string[] {
  return [
    documentNumber(ride),
    ride.authorization.number,
    environmentText(ride),
    emissionText(ride),
    ride.accessKey,
    ride.legalName,
    ride.tradeName ?? "",
    ride.headOfficeAddress,
    ride.establishmentAddress ?? "",
    ride.specialTaxpayer ?? "",
    ride.accountingRequired,
    ride.withholdingAgentResolution ?? "",
    ride.rimpeLegend ?? "",
    ride.ruc,
    ride.carrier.identification,
    ride.carrier.legalName,
    ride.plate,
    ride.departureAddress,
    ride.transportStart,
    ride.transportEnd,
    ...ride.recipients.flatMap((recipient) => [
      recipient.support ? saleDocumentText(recipient.support) : "",
      recipient.support?.issueDate ?? "",
      recipient.support?.authorizationNumber ?? "",
      recipient.motive,
      recipient.address,
      recipient.identification,
      recipient.legalName,
      recipient.destinationEstablishmentCode ?? "",
      recipient.route ?? "",
      ...recipient.details.flatMap((detail) => [
        detail.quantity,
        detail.description,
        detail.mainCode ?? "",
        detail.auxiliaryCode ?? "",
      ]),
    ]),
  ];
}

const label = (text: string) => ({ text, style: "label" });
const value = (text: string | null) => ({ text: text ?? "", style: "value" });
const amountCell = (text: string) => ({ text, alignment: "right", style: "cell" });
const box = (stack: Content[], margin?: number[]): Content => ({
  table: {
    widths: ["*"],
    body: [[{ stack, margin: [BOX_PADDING_PT, BOX_PADDING_PT, BOX_PADDING_PT, BOX_PADDING_PT] }]],
  },
  layout: "box",
  ...(margin ? { margin } : {}),
});
const row = (labelWidth: number, name: string, text: string | null, margin = [0, 3, 0, 0]) => ({
  columns: [
    { width: labelWidth, ...label(name) },
    { width: "*", ...value(text) },
  ],
  margin,
});

function issuerSection(ride: RideDocumentData): Content {
  return box([
    { text: ride.legalName, style: "issuerName" },
    ...(ride.tradeName ? [{ text: ride.tradeName, style: "value", margin: [0, 2, 0, 2] }] : []),
    row(58, "Dirección Matriz:", ride.headOfficeAddress),
    ...(ride.establishmentAddress
      ? [row(58, "Dirección Sucursal:", ride.establishmentAddress)]
      : []),
    ...(ride.specialTaxpayer
      ? [row(120, "Contribuyente Especial Nro:", ride.specialTaxpayer, [0, 4, 0, 0])]
      : []),
    row(150, "OBLIGADO A LLEVAR CONTABILIDAD:", ride.accountingRequired, [0, 4, 0, 0]),
    ...(ride.withholdingAgentResolution
      ? [
          row(
            150,
            "Agente de Retención Resolución No.:",
            ride.withholdingAgentResolution,
            [0, 4, 0, 0],
          ),
        ]
      : []),
    ...(ride.rimpeLegend ? [{ text: ride.rimpeLegend, style: "label", margin: [0, 4, 0, 0] }] : []),
  ]);
}

function authorizationSection(ride: RideDocumentData, number: string): Content {
  return box([
    {
      columns: [
        { width: 40, ...label("R.U.C.:") },
        { width: "*", text: ride.ruc, style: "ruc" },
      ],
    },
    { text: titleOf(ride), style: "documentTitle", margin: [0, 4, 0, 2] },
    {
      columns: [
        { width: 20, ...label("No.") },
        { width: "*", ...value(number) },
      ],
    },
    { text: "NÚMERO DE AUTORIZACIÓN", style: "label", margin: [0, 6, 0, 1] },
    { text: ride.authorization.number, style: "key" },
    row(
      110,
      "FECHA Y HORA DE AUTORIZACIÓN:",
      ecuadorDateTime(ride.authorization.authorizedAt),
      [0, 6, 0, 0],
    ),
    row(110, "AMBIENTE:", environmentText(ride), [0, 4, 0, 0]),
    row(110, "EMISIÓN:", emissionText(ride), [0, 4, 0, 0]),
    { text: "CLAVE DE ACCESO", style: "label", margin: [0, 6, 0, 0] },
    barcode(ride.accessKey),
    { text: ride.accessKey, style: "key", alignment: "center" },
  ]);
}

/** Sujeto retenido con su identificación y la fecha de emisión (anexo 2, página 63). */
function subjectSection(ride: RideWithholdingReceipt): Content {
  return box(
    [
      row(150, "Razón Social / Nombres y Apellidos:", ride.subject.legalName, [0, 0, 0, 0]),
      {
        columns: [
          { width: 150, ...label("Identificación:") },
          { width: "*", ...value(ride.subject.identification) },
          { width: 70, ...label("Fecha Emisión:") },
          { width: 70, ...value(ride.issueDate) },
        ],
        margin: [0, 3, 0, 0],
      },
    ],
    [0, 8, 0, 8],
  );
}

/**
 * Una fila por retención con los datos de su documento sustento (anexo 2, página 63). El
 * encabezado se repite en cada página y ninguna fila se parte entre dos.
 */
function withholdingsSection(ride: RideWithholdingReceipt): Content {
  const headers = [
    "Comprobante",
    "Número",
    "Fecha Emisión",
    "Ejercicio Fiscal",
    "Base Imponible para la Retención",
    "Impuesto",
    "Porcentaje Retención",
    "Valor Retenido",
  ];
  const body: TableCell[][] = [
    headers.map((text) => ({ text, style: "tableHeader" })),
    ...ride.supports.flatMap((support) =>
      support.withholdings.map((item) => [
        { text: supportTypeText(support), style: "cell" },
        { text: supportNumber(support.number), style: "cell" },
        { text: support.issueDate, style: "cell" },
        { text: ride.fiscalPeriod, style: "cell" },
        amountCell(item.base),
        { text: item.taxLabel ?? item.taxCode, style: "cell" },
        amountCell(item.percentage),
        amountCell(item.amount),
      ]),
    ),
  ];
  return {
    table: {
      headerRows: 1,
      dontBreakRows: true,
      widths: ["*", 74, 50, 44, 66, 44, 50, 56],
      body,
    },
    layout: "grid",
  };
}

/**
 * Datos adicionales (anexo 2, página 60): un bloque por documento sustento con sus impuestos
 * declarados, cada uno con su código, su código de porcentaje, su base, su tarifa y su valor, tal
 * como los declaró el usuario. Un bloque nunca se parte entre dos páginas.
 */
function supportTaxesSection(ride: RideWithholdingReceipt): Content[] {
  const blocks = ride.supports
    .filter((support) => support.taxes.length > 0)
    .map((support): Content => ({
      stack: [
        {
          text: `${supportTypeText(support)} ${supportNumber(support.number)}`,
          style: "label",
          margin: [0, 0, 0, 2],
        },
        {
          table: {
            headerRows: 1,
            widths: ["*", 70, 70, 50, 64],
            body: [
              ["Impuesto", "Código Porcentaje", "Base Imponible", "Tarifa", "Valor"].map(
                (text) => ({ text, style: "tableHeader" }),
              ),
              ...support.taxes.map((tax) => [
                { text: coded(tax.taxCode, tax.taxLabel), style: "cell" },
                { text: tax.rateCode, style: "cell", alignment: "center" },
                amountCell(tax.base),
                amountCell(tax.tariff),
                amountCell(tax.amount),
              ]),
            ],
          },
          layout: "grid",
        },
      ],
      margin: [0, 6, 0, 0],
      unbreakable: true,
    }));
  if (blocks.length === 0) return [];
  return [
    {
      text: "DATOS ADICIONALES: IMPUESTOS DECLARADOS DE LOS DOCUMENTOS SUSTENTO",
      style: "label",
      margin: [0, 10, 0, 0],
    },
    ...blocks,
  ];
}

/**
 * Transporte (anexo 2, página 64): la identificación y la razón social del transportista, la placa,
 * el punto de partida y las fechas de inicio y fin del transporte.
 */
function transportSection(ride: RideShippingGuide): Content {
  return box(
    [
      row(150, "Identificación (Transportista):", ride.carrier.identification, [0, 0, 0, 0]),
      row(150, "Razón Social / Nombres y Apellidos:", ride.carrier.legalName),
      row(150, "Placa:", ride.plate),
      row(150, "Punto de Partida:", ride.departureAddress),
      {
        columns: [
          { width: 150, ...label("Fecha inicio Transporte:") },
          { width: "*", ...value(ride.transportStart) },
          { width: 110, ...label("Fecha fin Transporte:") },
          { width: 70, ...value(ride.transportEnd) },
        ],
        margin: [0, 3, 0, 0],
      },
    ],
    [0, 8, 0, 0],
  );
}

/**
 * Un bloque por destinatario (anexo 2, página 64): su comprobante de venta con su fecha y su
 * autorización, el motivo, el destino, la identificación, la razón social, el documento aduanero (el
 * sistema no lo emite), el código del establecimiento de destino y la ruta, con los rótulos sin dato
 * vacíos; y su tabla de cantidad, descripción y códigos. Los datos del destinatario y el encabezado
 * son las filas de cabecera de la tabla: nunca se separan de su primera fila y se repiten en cada
 * página que continúa el bloque; ninguna fila se parte entre dos.
 */
function recipientSection(recipient: ShippingRecipient): Content {
  const { support } = recipient;
  const data: Content = {
    stack: [
      {
        columns: [
          { width: 150, ...label("Comprobante de Venta:") },
          { width: "*", ...value(support ? saleDocumentText(support) : null) },
          { width: 90, ...label("Fecha de Emisión:") },
          { width: 60, ...value(support?.issueDate ?? null) },
        ],
      },
      row(150, "Número de Autorización:", support?.authorizationNumber ?? null),
      row(150, "Motivo Traslado:", recipient.motive),
      row(150, "Destino (Punto de llegada):", recipient.address),
      row(150, "Identificación (Destinatario):", recipient.identification),
      row(150, "Razón Social / Nombres y Apellidos:", recipient.legalName),
      row(150, "Documento Aduanero:", null),
      row(150, "Código Establecimiento Destino:", recipient.destinationEstablishmentCode),
      row(150, "Ruta:", recipient.route),
    ],
    margin: [BOX_PADDING_PT - 3, BOX_PADDING_PT - 2, BOX_PADDING_PT - 3, BOX_PADDING_PT - 2],
  };
  const body: TableCell[][] = [
    [{ ...data, colSpan: 4 }, {}, {}, {}],
    ["Cantidad", "Descripción", "Código Principal", "Código Auxiliar"].map((text) => ({
      text,
      style: "tableHeader",
    })),
    ...recipient.details.map((detail) => [
      amountCell(detail.quantity),
      { text: detail.description, style: "cell" },
      { text: detail.mainCode ?? "", style: "cell" },
      { text: detail.auxiliaryCode ?? "", style: "cell" },
    ]),
  ];
  return {
    table: {
      headerRows: 2,
      keepWithHeaderRows: 1,
      dontBreakRows: true,
      widths: [70, "*", 80, 80],
      body,
    },
    layout: "grid",
    margin: [0, 8, 0, 0],
  };
}

function buyerSection(ride: RideInvoice): Content {
  return box(
    [
      row(150, "Razón Social / Nombres y Apellidos:", ride.buyer.legalName, [0, 0, 0, 0]),
      {
        columns: [
          { width: 150, ...label("Identificación:") },
          { width: "*", ...value(ride.buyer.identification) },
          { width: 70, ...label("Fecha Emisión:") },
          { width: 70, ...value(ride.issueDate) },
        ],
        margin: [0, 3, 0, 0],
      },
      ...(ride.buyer.address ? [row(150, "Dirección:", ride.buyer.address)] : []),
    ],
    [0, 8, 0, 8],
  );
}

function detailSection(ride: RideInvoice): Content {
  const hasMain = ride.lines.some((line) => line.mainCode);
  const hasAuxiliary = ride.lines.some((line) => line.auxiliaryCode);
  const headers = [
    ...(hasMain ? ["Cod. Principal"] : []),
    ...(hasAuxiliary ? ["Cod. Auxiliar"] : []),
    "Cantidad",
    "Descripción",
    "Precio Unitario",
    "Descuento",
    "Precio Total",
  ];
  const widths = [...(hasMain ? [52] : []), ...(hasAuxiliary ? [52] : []), 58, "*", 58, 48, 56];
  const body: TableCell[][] = [
    headers.map((text) => ({ text, style: "tableHeader" })),
    ...ride.lines.map((line) => [
      ...(hasMain ? [{ text: line.mainCode ?? "", style: "cell" }] : []),
      ...(hasAuxiliary ? [{ text: line.auxiliaryCode ?? "", style: "cell" }] : []),
      amountCell(line.quantity),
      { text: line.description, style: "cell" },
      amountCell(line.unitPrice),
      amountCell(line.discount),
      amountCell(line.total),
    ]),
  ];
  // El encabezado se repite en cada página y ninguna fila se parte entre dos.
  return { table: { headerRows: 1, dontBreakRows: true, widths, body }, layout: "grid" };
}

/** Proveedor con su identificación, la fecha de emisión y su dirección (anexo 2, página 65). */
function supplierSection(ride: RidePurchaseSettlement): Content {
  return box(
    [
      row(150, "Razón Social / Nombres y Apellidos:", ride.supplier.legalName, [0, 0, 0, 0]),
      {
        columns: [
          { width: 150, ...label("Identificación:") },
          { width: "*", ...value(ride.supplier.identification) },
          { width: 70, ...label("Fecha Emisión:") },
          { width: 70, ...value(ride.issueDate) },
        ],
        margin: [0, 3, 0, 0],
      },
      row(150, "Dirección:", ride.supplier.address),
    ],
    [0, 8, 0, 8],
  );
}

/** Detalle con la unidad de medida solo cuando alguna línea la trae (anexo 2, página 65). */
function purchaseSettlementDetailSection(ride: RidePurchaseSettlement): Content {
  const hasMain = ride.lines.some((line) => line.mainCode);
  const hasAuxiliary = ride.lines.some((line) => line.auxiliaryCode);
  const hasUnit = ride.lines.some((line) => line.unit);
  const headers = [
    ...(hasMain ? ["Cod. Principal"] : []),
    ...(hasAuxiliary ? ["Cod. Auxiliar"] : []),
    "Cantidad",
    "Descripción",
    ...(hasUnit ? ["Unidad"] : []),
    "Precio Unitario",
    "Descuento",
    "Precio Total",
  ];
  const widths = [
    ...(hasMain ? [52] : []),
    ...(hasAuxiliary ? [52] : []),
    58,
    "*",
    ...(hasUnit ? [48] : []),
    58,
    48,
    56,
  ];
  const body: TableCell[][] = [
    headers.map((text) => ({ text, style: "tableHeader" })),
    ...ride.lines.map((line) => [
      ...(hasMain ? [{ text: line.mainCode ?? "", style: "cell" }] : []),
      ...(hasAuxiliary ? [{ text: line.auxiliaryCode ?? "", style: "cell" }] : []),
      amountCell(line.quantity),
      { text: line.description, style: "cell" },
      ...(hasUnit ? [{ text: line.unit ?? "", style: "cell" }] : []),
      amountCell(line.unitPrice),
      amountCell(line.discount),
      amountCell(line.total),
    ]),
  ];
  // El encabezado se repite en cada página y ninguna fila se parte entre dos.
  return { table: { headerRows: 1, dontBreakRows: true, widths, body }, layout: "grid" };
}

/** Cada forma de pago con su plazo y su valor, y los subtotales con el valor total. */
function purchaseSettlementClosingSection(ride: RidePurchaseSettlement): Content {
  const payments: Content = {
    table: {
      widths: ["*", 56, 64],
      body: [
        [
          { text: "Forma de pago", style: "tableHeader" },
          { text: "Plazo", style: "tableHeader" },
          { text: "Valor", style: "tableHeader" },
        ],
        ...ride.payments.map((payment) => [
          { text: paymentText(payment), style: "cell" },
          { text: termText(payment), style: "cell" },
          amountCell(payment.total),
        ]),
      ],
    },
    layout: "grid",
  };
  return closingColumns(payments, ride);
}

/** Las formas de pago y los totales nunca se parten: si no caben, pasan juntos a otra página. */
function closingColumns(
  payments: Content | null,
  ride: RideInvoice | RideDebitNote | RidePurchaseSettlement,
): Content {
  const totals: Content = {
    table: {
      widths: ["*", 64],
      body: totalRows(ride).map(([name, amount]) => {
        const strong = name === "VALOR TOTAL";
        return [
          { text: name, style: strong ? "totalStrong" : "cell" },
          { ...amountCell(amount), ...(strong ? { style: "totalStrong" } : {}) },
        ];
      }),
    },
    layout: "grid",
  };
  return {
    columns: [
      { width: "*", stack: payments === null ? [] : [payments] },
      { width: 200, stack: [totals] },
    ],
    columnGap: COLUMN_GAP_PT,
    margin: [0, 8, 0, 0],
    unbreakable: true,
  };
}

function closingSection(ride: RideInvoice | RideDebitNote): Content {
  const payments: Content | null =
    ride.payments.length === 0
      ? null
      : {
          table: {
            widths: ["*", 64],
            body: [
              [
                { text: "Forma de pago", style: "tableHeader" },
                { text: "Valor", style: "tableHeader" },
              ],
              ...ride.payments.map((payment) => [
                { text: paymentText(payment), style: "cell" },
                amountCell(payment.total),
              ]),
            ],
          },
          layout: "grid",
        };
  return closingColumns(payments, ride);
}

/**
 * Comprador y comprobante que se modifica (anexo 2, páginas 61 y 62), con las filas propias de la
 * nota al final: la razón de la modificación en la nota de crédito; ninguna en la de débito, que
 * lleva sus razones en su propia tabla.
 */
function modifiedDocumentSection(ride: RideCreditNote | RideDebitNote, extra: Content[]): Content {
  return box(
    [
      row(150, "Razón Social / Nombres y Apellidos:", ride.buyer.legalName, [0, 0, 0, 0]),
      {
        columns: [
          { width: 150, ...label("Identificación:") },
          { width: "*", ...value(ride.buyer.identification) },
          { width: 70, ...label("Fecha Emisión:") },
          { width: 70, ...value(ride.issueDate) },
        ],
        margin: [0, 3, 0, 0],
      },
      {
        canvas: [
          { type: "line", x1: 0, y1: 0, x2: 535, y2: 0, lineWidth: 0.5, lineColor: "#000000" },
        ],
        margin: [0, 6, 0, 4],
      },
      {
        columns: [
          { width: 150, ...label("Comprobante que se modifica:") },
          { width: 70, ...value(modifiedTypeText(ride)) },
          { width: "*", ...value(ride.modified.number) },
        ],
      },
      row(150, "Fecha Emisión (Comprobante a modificar):", ride.modified.issueDate),
      ...extra,
    ],
    [0, 8, 0, 8],
  );
}

/** Comprador, comprobante que se modifica y razón de la modificación (anexo 2, página 61). */
const creditNoteBuyerSection = (ride: RideCreditNote): Content =>
  modifiedDocumentSection(ride, [row(150, "Razón de Modificación:", ride.reason)]);

/** Razones y valores de la modificación, un motivo por fila (anexo 2, página 62). */
function debitNoteReasonsSection(ride: RideDebitNote): Content {
  const body: TableCell[][] = [
    [
      { text: "RAZÓN DE LA MODIFICACIÓN", style: "tableHeader" },
      { text: "VALOR DE LA MODIFICACIÓN", style: "tableHeader" },
    ],
    ...ride.reasons.map((motivo) => [
      { text: motivo.reason, style: "cell" },
      amountCell(motivo.value),
    ]),
  ];
  return {
    table: { headerRows: 1, dontBreakRows: true, widths: ["*", 120], body },
    layout: "grid",
  };
}

function creditNoteDetailSection(ride: RideCreditNote): Content {
  const hasMain = ride.lines.some((line) => line.mainCode);
  const hasAuxiliary = ride.lines.some((line) => line.auxiliaryCode);
  const headers = [
    ...(hasMain ? ["Código"] : []),
    ...(hasAuxiliary ? ["Código Auxiliar"] : []),
    "Cantidad",
    "Descripción",
    "Precio Unitario",
    "Descuento",
    "Precio Total",
  ];
  const widths = [...(hasMain ? [52] : []), ...(hasAuxiliary ? [52] : []), 58, "*", 58, 48, 56];
  const body: TableCell[][] = [
    headers.map((text) => ({ text, style: "tableHeader" })),
    ...ride.lines.map((line) => [
      ...(hasMain ? [{ text: line.mainCode ?? "", style: "cell" }] : []),
      ...(hasAuxiliary ? [{ text: line.auxiliaryCode ?? "", style: "cell" }] : []),
      amountCell(line.quantity),
      { text: line.description, style: "cell" },
      amountCell(line.unitPrice),
      amountCell(line.discount),
      amountCell(line.total),
    ]),
  ];
  return { table: { headerRows: 1, dontBreakRows: true, widths, body }, layout: "grid" };
}

/** Subtotales con el valor total; la nota no lleva formas de pago. */
function creditNoteClosingSection(ride: RideCreditNote): Content {
  return {
    columns: [
      { width: "*", text: "" },
      {
        width: 200,
        table: {
          widths: ["*", 64],
          body: totalRows(ride).map(([name, amount]) => {
            const strong = name === "VALOR TOTAL";
            return [
              { text: name, style: strong ? "totalStrong" : "cell" },
              { ...amountCell(amount), ...(strong ? { style: "totalStrong" } : {}) },
            ];
          }),
        },
        layout: "grid",
      },
    ],
    columnGap: COLUMN_GAP_PT,
    margin: [0, 8, 0, 0],
    unbreakable: true,
  };
}

/** Definición del documento; `onPageCount` recibe el número de páginas al maquetar. */
export function rideDocument(
  ride: RideDocumentData,
  logo: RideLogo | null,
  onPageCount: (pages: number) => void = () => {},
): DocumentDefinition {
  const number = documentNumber(ride);
  return {
    pageSize: "A4",
    pageMargins: [PAGE_MARGIN_PT, 40, PAGE_MARGIN_PT, 36],
    info: {
      title: `RIDE ${number}`,
      author: ride.legalName,
      subject: ride.accessKey,
      creator: "facturador-sri",
      producer: "facturador-sri",
      creationDate: ride.authorization.authorizedAt,
      modDate: ride.authorization.authorizedAt,
    },
    header: (currentPage: number) =>
      currentPage === 1
        ? { text: "" }
        : {
            text: `${titleOf(ride)} No. ${number} · R.U.C. ${ride.ruc} · Clave de acceso ${ride.accessKey}`,
            style: "running",
            margin: [PAGE_MARGIN_PT, 16, PAGE_MARGIN_PT, 0],
          },
    footer: (currentPage: number, pageCount: number) => {
      onPageCount(pageCount);
      return {
        text: `Página ${currentPage} de ${pageCount}`,
        style: "running",
        alignment: "right",
        margin: [PAGE_MARGIN_PT, 10, PAGE_MARGIN_PT, 0],
      };
    },
    content: [
      {
        columns: [
          {
            width: "*",
            stack: [
              ...(logo ? [{ image: "logo", fit: [180, 70], margin: [0, 0, 0, 6] }] : []),
              issuerSection(ride),
            ],
          },
          { width: AUTHORIZATION_COLUMN_PT, stack: [authorizationSection(ride, number)] },
        ],
        columnGap: COLUMN_GAP_PT,
        // La autorización y el código de barras quedan enteros en la primera página.
        unbreakable: true,
      },
      ...(isCreditNote(ride)
        ? [
            creditNoteBuyerSection(ride),
            creditNoteDetailSection(ride),
            creditNoteClosingSection(ride),
          ]
        : isDebitNote(ride)
          ? [modifiedDocumentSection(ride, []), debitNoteReasonsSection(ride), closingSection(ride)]
          : isWithholding(ride)
            ? [subjectSection(ride), withholdingsSection(ride), ...supportTaxesSection(ride)]
            : isShippingGuide(ride)
              ? [transportSection(ride), ...ride.recipients.map(recipientSection)]
              : isPurchaseSettlement(ride)
                ? [
                    supplierSection(ride),
                    purchaseSettlementDetailSection(ride),
                    purchaseSettlementClosingSection(ride),
                  ]
                : [buyerSection(ride), detailSection(ride), closingSection(ride)]),
    ],
    images: logo
      ? { logo: `data:${logo.mediaType};base64,${Buffer.from(logo.bytes).toString("base64")}` }
      : {},
    defaultStyle: { font: FONT_NAME, fontSize: 8, lineHeight: 1.1 },
    styles: {
      label: { fontSize: 7.5, bold: true },
      value: { fontSize: 7.5 },
      issuerName: { fontSize: 10, bold: true },
      ruc: { fontSize: 11, bold: true },
      documentTitle: { fontSize: 12, bold: true },
      key: { fontSize: 7.5, characterSpacing: 0.2 },
      tableHeader: { fontSize: 7, bold: true, alignment: "center", fillColor: "#eeeeee" },
      cell: { fontSize: 7.5 },
      totalStrong: { fontSize: 8, bold: true },
      running: { fontSize: 7, color: "#444444" },
    },
  };
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const startsWith = (bytes: Uint8Array, signature: readonly number[]) =>
  signature.every((byte, index) => bytes[index] === byte);

/** El logo solo puede ser un PNG o un JPEG en memoria, nunca una ruta ni una URL. */
function assertLogo(logo: RideLogo | null): void {
  if (logo === null) return;
  const valid =
    (logo.mediaType === "image/png" && startsWith(logo.bytes, PNG_SIGNATURE)) ||
    (logo.mediaType === "image/jpeg" && startsWith(logo.bytes, JPEG_SIGNATURE));
  if (!valid) throw new RideRejectedError("RIDE_LOGO_INVALID", [logo.mediaType]);
}

let configured = false;

/** Configura pdfmake una vez por proceso: fuentes en memoria, ningún recurso externo, tablas. */
function configurePdfmake(fonts: RideFonts): void {
  if (configured) return;
  pdfmake.virtualfs.writeFileSync(FONT_FILES.normal, fonts.regular);
  pdfmake.virtualfs.writeFileSync(FONT_FILES.bold, fonts.bold);
  pdfmake.setFonts({
    [FONT_NAME]: {
      normal: FONT_FILES.normal,
      bold: FONT_FILES.bold,
      italics: FONT_FILES.normal,
      bolditalics: FONT_FILES.bold,
    },
  });
  pdfmake.setUrlAccessPolicy(() => false);
  pdfmake.setLocalAccessPolicy(() => false);
  pdfmake.setTableLayouts({
    box: {
      hLineWidth: () => 0.8,
      vLineWidth: () => 0.8,
      hLineColor: () => "#000000",
      vLineColor: () => "#000000",
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 0,
      paddingBottom: () => 0,
    },
    grid: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => "#000000",
      vLineColor: () => "#000000",
      paddingLeft: () => 3,
      paddingRight: () => 3,
      paddingTop: () => 2,
      paddingBottom: () => 2,
    },
  });
  configured = true;
}

/**
 * Renderer en el hilo que lo llama: lo usan el worker del RIDE y las pruebas. La API nunca lo
 * llama: usa el renderer del pool (`pooled-ride-renderer.ts`).
 */
export function createInProcessRideRenderer(fonts: RideFonts): RideRenderer {
  configurePdfmake(fonts);
  const glyphs = { regular: fontkit.create(fonts.regular), bold: fontkit.create(fonts.bold) };

  /** Cada carácter que se dibuja debe tener glifo en las dos variantes de la fuente. */
  function assertGlyphs(strings: readonly string[]): void {
    const missing = new Set<string>();
    for (const text of strings) {
      for (const char of text) {
        const codePoint = char.codePointAt(0)!;
        if (codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d) continue;
        if (
          !glyphs.regular.hasGlyphForCodePoint(codePoint) ||
          !glyphs.bold.hasGlyphForCodePoint(codePoint)
        ) {
          missing.add(`U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`);
        }
      }
    }
    if (missing.size > 0) throw new RideRejectedError("RIDE_GLYPH_MISSING", [...missing]);
  }

  return {
    async render(input: RideRenderInput): Promise<RideRenderOutcome> {
      const started = performance.now();
      try {
        const ride = readRideDocument(input);
        assertLogo(input.logo);
        assertGlyphs(drawnStrings(ride));
        let pages = 0;
        const pdf = await pdfmake
          .createPdf(
            rideDocument(ride, input.logo, (count) => {
              pages = count;
            }),
          )
          .getBuffer();
        return {
          status: "RENDERED",
          pdf: new Uint8Array(pdf),
          pages,
          versions: isCreditNote(ride)
            ? CREDIT_NOTE_RIDE_VERSIONS
            : isDebitNote(ride)
              ? DEBIT_NOTE_RIDE_VERSIONS
              : isWithholding(ride)
                ? WITHHOLDING_RIDE_VERSIONS
                : isShippingGuide(ride)
                  ? SHIPPING_GUIDE_RIDE_VERSIONS
                  : isPurchaseSettlement(ride)
                    ? PURCHASE_SETTLEMENT_RIDE_VERSIONS
                    : RIDE_VERSIONS,
          renderMs: performance.now() - started,
        };
      } catch (error) {
        if (error instanceof RideRejectedError) {
          return { status: "REJECTED", code: error.code, detail: error.detail };
        }
        throw error;
      }
    },
  };
}
