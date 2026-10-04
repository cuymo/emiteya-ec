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
  read(input: RideSourceInput): RideInvoice;
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
  | Readonly<{ status: "RENDERED"; pdf: Uint8Array; pages: number; versions: RideVersions }>
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
