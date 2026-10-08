// Puertos del RIDE de un comprobante autorizado (ADR 0022; add-document-archive, design D3 y D7).
// El motor SRI lee el XML de origen y dibuja el PDF; `fiscal` elige la fuente, la verifica y guarda
// el artefacto. Los importes y textos viajan como el texto exacto del XML: nunca se convierten a
// `number`, se recalculan ni se redondean.

/** Autorización inmutable del comprobante (columnas de autorización, add-sri-transmission D16). */
export type RideAuthorization = Readonly<{
  /** En el esquema off-line, igual a la clave de acceso. */
  number: string;
  authorizedAt: Date;
  environment: "TEST" | "PRODUCTION";
}>;

/** Lo que el lector necesita: el XML de origen y los datos inmutables que el XML no trae. */
export type RideSourceInput = Readonly<{
  /** Bytes exactos del `AUTHORIZED_XML` o, en el respaldo, del `SIGNED_XML` transmitido. */
  xml: Uint8Array;
  /** Clave de acceso del comprobante guardado. */
  accessKey: string;
  authorization: RideAuthorization;
  /** Denominación oficial de cada forma de pago (`formaPago`), del snapshot del comprobante. */
  paymentLabels: Readonly<Record<string, string>>;
  /** Denominaciones del comprobante de retención, de su snapshot; ausentes en los demás tipos. */
  withholdingLabels?: RideWithholdingLabels;
}>;

/**
 * Denominaciones que el XML del comprobante de retención no trae (add-withholding-receipts, design
 * D19): las congeló su snapshot al reservar y nunca se leen del catálogo vigente.
 */
export type RideWithholdingLabels = Readonly<{
  /** Tipo de documento sustento por su `codDocSustento` (tabla 4 del Catálogo ATS). */
  documentTypes: Readonly<Record<string, string>>;
  /** Impuesto a retener por el `codigo` de la retención (tabla 19 de la ficha). */
  taxes: Readonly<Record<string, string>>;
  /** Impuesto declarado del documento sustento por su `codImpuestoDocSustento`. */
  supportTaxes: Readonly<Record<string, string>>;
}>;

export type RideTax = Readonly<{
  /** Siempre IVA (código 2): la emisión no produce otros impuestos. */
  rateCode: string;
  /** Tarifa declarada por las líneas con el mismo código de tarifa; null si ninguna la trae. */
  rate: string | null;
  base: string;
  amount: string;
}>;

export type RideLine = Readonly<{
  mainCode: string | null;
  auxiliaryCode: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  total: string;
}>;

/** Contenido de la factura 1.1.0 que el sistema emite, tal como está en el XML de origen. */
export type RideInvoice = Readonly<{
  /** Ausente en la factura: la distingue de las notas de crédito y de débito. */
  kind?: "INVOICE";
  environment: "1" | "2";
  emissionType: string;
  legalName: string;
  tradeName: string | null;
  ruc: string;
  accessKey: string;
  establishment: string;
  emissionPoint: string;
  sequential: string;
  headOfficeAddress: string;
  establishmentAddress: string | null;
  specialTaxpayer: string | null;
  accountingRequired: string;
  withholdingAgentResolution: string | null;
  rimpeLegend: string | null;
  issueDate: string;
  buyer: Readonly<{
    identificationType: string;
    identification: string;
    legalName: string;
    address: string | null;
  }>;
  totals: Readonly<{
    withoutTaxes: string;
    discount: string;
    taxes: readonly RideTax[];
    total: string;
  }>;
  payments: readonly Readonly<{ method: string; label: string | null; total: string }>[];
  lines: readonly RideLine[];
  authorization: RideAuthorization;
}>;

/**
 * Contenido de la nota de crédito 1.1.0 que el sistema emite (add-credit-notes, design D14): lo de
 * la factura salvo las formas de pago, la dirección del comprador y el total de descuentos, que el
 * XML de la nota no trae, más el comprobante que modifica, su fecha y la razón de la modificación.
 */
export type RideCreditNote = Omit<RideInvoice, "kind" | "buyer" | "totals" | "payments"> &
  Readonly<{
    kind: "CREDIT_NOTE";
    buyer: Omit<RideInvoice["buyer"], "address">;
    totals: Readonly<{ withoutTaxes: string; taxes: readonly RideTax[]; total: string }>;
    /** Comprobante modificado: su tipo (`01`), su número y su fecha `dd/mm/aaaa`. */
    modified: Readonly<{ documentType: string; number: string; issueDate: string }>;
    reason: string;
  }>;

/**
 * Contenido de la nota de débito 1.0.0 que el sistema emite (add-debit-notes, design D18): la
 * cabecera y el emisor de la factura, el comprador, el comprobante modificado, un motivo por
 * concepto, la única forma de pago y los impuestos por tratamiento, con la tarifa de cada impuesto.
 */
export type RideDebitNote = Omit<RideInvoice, "kind" | "buyer" | "totals" | "lines"> &
  Readonly<{
    kind: "DEBIT_NOTE";
    buyer: Omit<RideInvoice["buyer"], "address">;
    totals: Readonly<{ withoutTaxes: string; taxes: readonly RideTax[]; total: string }>;
    /** Comprobante modificado: su tipo (`01`), su número y su fecha `dd/mm/aaaa`. */
    modified: Readonly<{ documentType: string; number: string; issueDate: string }>;
    /** Un motivo por concepto, en su orden: la razón y el valor de la modificación. */
    reasons: readonly Readonly<{ reason: string; value: string }>[];
  }>;

/**
 * Contenido del comprobante de retención 2.0.0 que el sistema emite (add-withholding-receipts, design
 * D19): la cabecera y el emisor de la factura, el sujeto retenido, el período fiscal y cada documento
 * sustento con sus impuestos declarados y sus retenciones, con las denominaciones del snapshot.
 */
export type RideWithholdingReceipt = Omit<
  RideInvoice,
  "kind" | "buyer" | "totals" | "payments" | "lines"
> &
  Readonly<{
    kind: "WITHHOLDING_RECEIPT";
    subject: Readonly<{ identificationType: string; identification: string; legalName: string }>;
    /** `periodoFiscal`, `MM/AAAA`: el ejercicio fiscal de cada fila. */
    fiscalPeriod: string;
    supports: readonly Readonly<{
      /** `codDocSustento` con la denominación del snapshot; null si no la trae. */
      documentType: string;
      documentTypeLabel: string | null;
      /** `numDocSustento`, 15 dígitos. */
      number: string;
      /** `dd/mm/aaaa`. */
      issueDate: string;
      taxes: readonly Readonly<{
        taxCode: string;
        taxLabel: string | null;
        rateCode: string;
        base: string;
        tariff: string;
        amount: string;
      }>[];
      withholdings: readonly Readonly<{
        taxCode: string;
        taxLabel: string | null;
        code: string;
        base: string;
        percentage: string;
        amount: string;
      }>[];
    }>[];
  }>;

/**
 * Contenido de la guía de remisión 1.1.0 que el sistema emite (add-shipping-guides, design D20): la
 * cabecera y el emisor de la factura, sin fecha de emisión (el XML no la trae), el transporte con el
 * transportista, la placa, el punto de partida y las fechas, y cada destinatario con su comprobante de
 * venta (solo una factura `01`), su motivo, su destino, su ruta y su detalle de cantidades. Sin
 * importes.
 */
export type RideShippingGuide = Omit<
  RideInvoice,
  "kind" | "buyer" | "totals" | "payments" | "lines" | "issueDate"
> &
  Readonly<{
    kind: "SHIPPING_GUIDE";
    carrier: Readonly<{ identificationType: string; identification: string; legalName: string }>;
    plate: string;
    departureAddress: string;
    /** `dd/mm/aaaa`. */
    transportStart: string;
    transportEnd: string;
    recipients: readonly Readonly<{
      identification: string;
      legalName: string;
      address: string;
      motive: string;
      destinationEstablishmentCode: string | null;
      route: string | null;
      /** La factura sustento (`codDocSustento` 01), o null en una excepción declarada. */
      support: Readonly<{
        documentType: string;
        number: string;
        authorizationNumber: string;
        /** `dd/mm/aaaa`. */
        issueDate: string;
      }> | null;
      details: readonly Readonly<{
        mainCode: string | null;
        auxiliaryCode: string | null;
        description: string;
        quantity: string;
      }>[];
    }>[];
  }>;

/**
 * Contenido de la liquidación de compra 1.1.0 que el sistema emite (add-purchase-settlements, design
 * D19): la cabecera y el emisor de la factura, el proveedor con su identificación y su dirección, la
 * fecha de emisión, cada línea con su unidad de medida cuando la tiene, cada pago con su plazo y su
 * unidad de tiempo, y los totales de IVA. Sin reembolsos, subsidios, detalles adicionales ni
 * información adicional.
 */
export type RidePurchaseSettlement = Omit<RideInvoice, "kind" | "buyer" | "payments" | "lines"> &
  Readonly<{
    kind: "PURCHASE_SETTLEMENT";
    supplier: Readonly<{
      identificationType: string;
      identification: string;
      legalName: string;
      address: string;
    }>;
    lines: readonly (RideLine & Readonly<{ unit: string | null }>)[];
    payments: readonly Readonly<{
      method: string;
      label: string | null;
      total: string;
      term: string;
      timeUnit: string;
    }>[];
  }>;

/** Un comprobante que el RIDE dibuja, elegido por la raíz y la versión de su XML. */
export type RideDocumentData =
  | RideInvoice
  | RideCreditNote
  | RideDebitNote
  | RideWithholdingReceipt
  | RideShippingGuide
  | RidePurchaseSettlement;

/**
 * Motivos deterministas por los que el RIDE no se genera: reintentar da lo mismo, así que la
 * generación se detiene con el motivo (design D5).
 */
export const RIDE_REJECTION_CODES = [
  "RIDE_SOURCE_INVALID",
  "RIDE_SOURCE_UNSUPPORTED",
  "RIDE_AUTHORIZATION_MISMATCH",
  "RIDE_GLYPH_MISSING",
  "RIDE_LOGO_INVALID",
  "RIDE_FONTS_UNAVAILABLE",
] as const;
export type RideRejectionCode = (typeof RIDE_REJECTION_CODES)[number];

/**
 * Rechazo determinista con un detalle seguro: nombres de elementos o puntos de código, nunca el
 * contenido del comprobante.
 */
export class RideRejectedError extends Error {
  readonly code: RideRejectionCode;
  readonly detail: readonly string[];

  constructor(code: RideRejectionCode, detail: readonly string[] = []) {
    super(detail.length > 0 ? `${code}: ${detail.join(",")}` : code);
    this.name = "RideRejectedError";
    this.code = code;
    this.detail = detail;
  }
}

export interface RideSourceReader {
  /** Lee y valida el XML de origen; lanza `RideRejectedError` si no puede ser la fuente. */
  read(input: RideSourceInput): RideDocumentData;
}

export type RideLogo = Readonly<{ bytes: Uint8Array; mediaType: "image/png" | "image/jpeg" }>;

export type RideRenderInput = RideSourceInput & Readonly<{ logo: RideLogo | null }>;

/** Versiones con que se generó un RIDE: viajan a los metadatos del artefacto (design D4). */
export type RideVersions = Readonly<{
  rendererVersion: string;
  pdfmake: string;
  pdfkit: string;
  bwipJs: string;
  fontkit: string;
  fonts: Readonly<{
    family: string;
    version: string;
    regular: Readonly<{ file: string; sha256: string }>;
    bold: Readonly<{ file: string; sha256: string }>;
  }>;
}>;

export type RideRenderOutcome =
  | Readonly<{
      status: "RENDERED";
      pdf: Uint8Array;
      pages: number;
      versions: RideVersions;
      /** Duración del render donde ocurrió (el worker), sin la espera de la cola. */
      renderMs: number;
    }>
  | Readonly<{ status: "REJECTED"; code: RideRejectionCode; detail: readonly string[] }>;

/**
 * Dibuja el RIDE fuera del event loop de la API. Un rechazo determinista vuelve como `REJECTED`;
 * los fallos operativos (pool ocupado, plazo vencido, worker caído, pool cerrado) se lanzan como
 * `RideRenderUnavailableError`.
 */
export interface RideRenderer {
  render(input: RideRenderInput): Promise<RideRenderOutcome>;
}

export type RideUnavailableReason = "BUSY" | "TIMEOUT" | "WORKER" | "CLOSED" | "INTERNAL";

/** Fallo operativo del render: el job decide si reprograma o falla con backoff (design D5). */
export class RideRenderUnavailableError extends Error {
  readonly reason: RideUnavailableReason;

  constructor(reason: RideUnavailableReason) {
    super(`RIDE_RENDER_${reason}`);
    this.name = "RideRenderUnavailableError";
    this.reason = reason;
  }
}
