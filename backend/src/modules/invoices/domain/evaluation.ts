// Evaluación de una factura antes de reservar (add-invoice-emission, design D5 y D6): una función
// pura de los datos ya leídos, con la fecha capturada una vez. Devuelve todos los problemas en el
// orden de los diez grupos de D6 y los importes calculados. La vista previa del borrador muestra
// todos; la emisión rechaza con el primero. No lee base de datos, reloj ni configuración.
import {
  compareDecimalStrings,
  type InvoiceErrorCode,
  type InvoiceIssue,
} from "@facturador/contracts";
import { subtractExact, sumExact } from "../../../platform/decimal/fiscal-decimal.ts";
import {
  InvoiceAmountError,
  invoiceTotals,
  lineDiscount,
  lineSubtotal,
  materializeMoney,
  taxAmount,
  taxableBase,
  type InvoiceTotals,
  type LineTaxRate,
} from "./amounts.ts";

export const CONSUMER_FINAL = "CONSUMER_FINAL";

/** Anexos de casos especiales cuya generación soporta la factura 1.1.0 de este cambio. */
export const SUPPORTED_SPECIAL_CASES: ReadonlySet<number> = new Set([21, 22, 24]);
const SUPPORTED_CATEGORIES: ReadonlySet<string> = new Set(["CORE", "CONDITIONAL_ISSUER_RULE"]);

/** Tipo del impuesto de cada posición del producto (design D7 de add-parties-and-products). */
const TAX_LABELS: Record<string, string> = {
  "iva-rate": "IVA",
  "ice-rate": "ICE",
  "irbpnr-rate": "IRBPNR",
};

export type CatalogVersionLike = Readonly<{
  id: string;
  code: string;
  officialLabel: string;
  sriTaxCode: string | null;
  rateKind: string | null;
  percentage: string | null;
  datasetVersion: number;
}>;

/** Porcentaje de cálculo: el publicado o 0 para no objeto y exento, que no publican porcentaje. */
const ZERO_RATE_KINDS: ReadonlySet<string> = new Set(["NOT_SUBJECT", "EXEMPT"]);
function calculationPercentage(version: CatalogVersionLike): string | null {
  if (version.percentage !== null) return version.percentage;
  return version.rateKind !== null && ZERO_RATE_KINDS.has(version.rateKind) ? "0" : null;
}

/** Disponibilidad de una entrada de catálogo para la empresa en la fecha de emisión. */
export type AvailabilityLike = Readonly<{
  code: string;
  usable: boolean;
  calculationData: "COMPLETE" | "MISSING";
  applicable: CatalogVersionLike | null;
  latest: Readonly<{ officialLabel: string }>;
}>;

export type IssuerProfile = Readonly<{
  ruc: string;
  legalName: string;
  tradeName: string | null;
  headOfficeAddress: string;
  accountingRequired: boolean;
  specialTaxpayerNumber: string | null;
  withholdingAgentResolution: string | null;
  largeTaxpayer: boolean;
  rimpeCategory: "EMPRENDEDOR" | "NEGOCIO_POPULAR" | null;
  providerRuc: string | null;
}>;

export type EvaluationConfig = Readonly<{
  versionId: string;
  version: number;
  profile: IssuerProfile;
  environment: "TEST" | "PRODUCTION";
}>;

export type EvaluationPoint = Readonly<{
  point: Readonly<{ id: string; code: string; status: "ACTIVE" | "INACTIVE" }>;
  establishment: Readonly<{
    id: string;
    code: string;
    address: string;
    status: "ACTIVE" | "INACTIVE";
  }>;
}>;

export type EvaluationBuyer = Readonly<{
  id: string;
  identificationType: string;
  identification: string;
  legalName: string;
  address: string | null;
  roles: readonly string[];
  status: "ACTIVE" | "INACTIVE";
  systemRecord: string | null;
}>;

/** Referencia fiscal de una posición del producto. */
export type ProductTaxRef = Readonly<{ catalogType: string; entryKey: string }>;

export type EvaluationProduct = Readonly<{
  id: string;
  mainCode: string | null;
  auxiliaryCode: string | null;
  name: string;
  unitPrice: string;
  status: "ACTIVE" | "INACTIVE";
  taxes: readonly ProductTaxRef[];
  /** Marca de control de stock del producto al leerlo (add-minimal-inventory, design D4). */
  stockTracked: boolean;
}>;

export type EvaluationPolicy = Readonly<{ id: string; maxAmount: string; datasetVersion: number }>;

export type EvaluationInput = Readonly<{
  /** `YYYY-MM-DD` en Ecuador, capturada una vez (design D6). */
  issueDate: string;
  maxLines: number;
  draft: Readonly<{
    emissionPointId: string | null;
    buyerPartyId: string | null;
    lines: readonly Readonly<{ productId: string; quantity: string; discount: string }>[];
    payments: readonly Readonly<{ paymentMethod: string; amount: string | null }>[];
  }>;
  config: EvaluationConfig | null;
  point: EvaluationPoint | null;
  certificate: Readonly<{ usable: boolean }> | null;
  buyer: EvaluationBuyer | null;
  /** El tipo de identificación del comprador tiene versión vigente en la fecha. */
  buyerIdentificationTypeUsable: boolean;
  products: ReadonlyMap<string, EvaluationProduct | null>;
  /** Disponibilidad por catálogo (`iva-rate`, `ice-rate`, `irbpnr-rate`) y entrada. */
  taxes: ReadonlyMap<string, ReadonlyMap<string, AvailabilityLike>>;
  paymentMethods: ReadonlyMap<string, AvailabilityLike>;
  consumerFinalPolicy: EvaluationPolicy | null;
  specialCases: readonly Readonly<{ annex: number; topic: string; category: string }>[];
  /** El registro tiene la factura 1.1.0 soportada con todos sus imports. */
  schemaAvailable: boolean;
  /**
   * Saldo de los productos de las líneas que tienen inventario inicializado, leído con la
   * evaluación (add-minimal-inventory, design D4 y D9); sin inicializar, el producto no aparece.
   */
  stockBalances: ReadonlyMap<string, string>;
}>;

export type EvaluatedTax = LineTaxRate &
  Readonly<{
    catalogType: string;
    entryKey: string;
    versionId: string;
    officialLabel: string;
    datasetVersion: number;
    base: string;
    amount: string;
  }>;

export type EvaluatedLine = Readonly<{
  position: number;
  productId: string;
  mainCode: string | null;
  auxiliaryCode: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  subtotal: string;
  taxableBase: string;
  taxes: readonly EvaluatedTax[];
}>;

export type EvaluatedPayment = Readonly<{
  position: number;
  entryKey: string;
  code: string;
  versionId: string;
  officialLabel: string;
  datasetVersion: number;
  amount: string;
}>;

export type SpecialCaseRule = Readonly<{
  annex: number;
  active: boolean;
  category: string | null;
  supported: boolean;
}>;

export type Evaluation = Readonly<{
  issues: readonly InvoiceIssue[];
  /** Líneas que pudieron calcularse, en orden. */
  lines: readonly EvaluatedLine[];
  /** `null` mientras alguna línea no pueda calcularse o no haya líneas. */
  totals: InvoiceTotals | null;
  /** `null` si alguna forma de pago no es utilizable o los importes no cuadran. */
  payments: readonly EvaluatedPayment[] | null;
  /** Reglas del emisor evaluadas (anexos 21, 22, 24 y 26), para el snapshot. */
  specialCases: readonly SpecialCaseRule[];
}>;

const issue = (
  code: InvoiceErrorCode,
  message: string,
  where: { line?: number; payment?: number } = {},
): InvoiceIssue => ({ code, message, line: where.line ?? null, payment: where.payment ?? null });

const usd = (amount: string) => `USD ${amount}`;

/** Reglas del emisor que activan un anexo de casos especiales (design D6, grupo 9). */
export function issuerSpecialCases(
  profile: IssuerProfile,
): readonly Readonly<{ annex: number; active: boolean }>[] {
  return [
    { annex: 21, active: profile.withholdingAgentResolution !== null },
    { annex: 22, active: profile.rimpeCategory !== null },
    { annex: 24, active: profile.largeTaxpayer },
    // Anexo 26: un RUC proveedor distinto del propio indica el sistema de un tercero (CTX §37).
    { annex: 26, active: profile.providerRuc !== null && profile.providerRuc !== profile.ruc },
  ];
}

/** Mide un tramo síncrono; la identidad por defecto. */
export type MeasureSync = <T>(work: () => T) => T;

/**
 * `measureArithmetic` envuelve el cálculo de importes (grupo 6) para la etapa `arithmetic` del
 * benchmark (design D16); no cambia el resultado.
 */
export function evaluateInvoice(
  input: EvaluationInput,
  measureArithmetic: MeasureSync = (work) => work(),
): Evaluation {
  const issues: InvoiceIssue[] = [];
  const { draft } = input;

  // 1. Borrador completo.
  const missing = [
    draft.emissionPointId === null ? "el punto de emisión" : null,
    draft.buyerPartyId === null ? "el comprador" : null,
    draft.lines.length === 0 ? "al menos una línea" : null,
    draft.payments.length === 0 ? "al menos una forma de pago" : null,
  ].filter((part): part is string => part !== null);
  if (missing.length > 0) {
    issues.push(issue("INVOICE_DRAFT_INCOMPLETE", `Al borrador le falta ${missing.join(", ")}.`));
  }
  if (draft.lines.length > input.maxLines) {
    issues.push(
      issue(
        "INVOICE_TOO_MANY_LINES",
        `La factura admite como máximo ${input.maxLines} líneas, un límite de la aplicación.`,
      ),
    );
  }

  // 2. Preparación: configuración, punto y firma.
  if (!input.config) {
    issues.push(
      issue(
        "TAXPAYER_NOT_CONFIGURED",
        "Registra los datos tributarios de la empresa antes de emitir.",
      ),
    );
  }
  if (draft.emissionPointId !== null) {
    if (!input.point) {
      issues.push(
        issue("EMISSION_POINT_NOT_FOUND", "El punto de emisión no existe en la empresa."),
      );
    } else if (
      input.point.point.status !== "ACTIVE" ||
      input.point.establishment.status !== "ACTIVE"
    ) {
      issues.push(
        issue(
          "EMISSION_POINT_UNAVAILABLE",
          `El punto de emisión ${input.point.establishment.code}-${input.point.point.code} o su establecimiento está desactivado.`,
        ),
      );
    }
  }
  if (!input.certificate?.usable) {
    issues.push(
      issue(
        "SIGNING_CERTIFICATE_NOT_USABLE",
        "La empresa no tiene una firma electrónica utilizable: carga una vigente.",
      ),
    );
  }

  // 3. Comprador.
  const buyer = input.buyer;
  if (draft.buyerPartyId !== null) {
    if (!buyer) {
      issues.push(issue("BUYER_NOT_FOUND", "El comprador no existe en la empresa."));
    } else {
      if (buyer.status !== "ACTIVE") {
        issues.push(issue("BUYER_INACTIVE", `El comprador ${buyer.legalName} está desactivado.`));
      }
      if (buyer.systemRecord !== CONSUMER_FINAL && !buyer.roles.includes("CUSTOMER")) {
        issues.push(
          issue(
            "BUYER_NOT_CUSTOMER",
            `El comprador ${buyer.legalName} debe tener el rol de cliente o ser el consumidor final.`,
          ),
        );
      }
      if (!input.buyerIdentificationTypeUsable) {
        issues.push(
          issue(
            "BUYER_IDENTIFICATION_TYPE_NOT_USABLE",
            `El tipo de identificación ${buyer.identificationType} del comprador no tiene una versión vigente en la fecha de emisión.`,
          ),
        );
      }
    }
  }

  // 4. Líneas: producto activo y descuento entre 0 y el subtotal.
  const lineIssues = new Set<number>();
  const subtotals = new Map<number, string>();
  draft.lines.forEach((line, index) => {
    const position = index + 1;
    const product = input.products.get(line.productId) ?? null;
    if (!product) {
      issues.push(
        issue("PRODUCT_NOT_FOUND", `Línea ${position}: el producto no existe.`, { line: position }),
      );
      lineIssues.add(position);
      return;
    }
    if (product.status !== "ACTIVE") {
      issues.push(
        issue(
          "PRODUCT_INACTIVE",
          `Línea ${position}: el producto ${product.name} está desactivado.`,
          {
            line: position,
          },
        ),
      );
      lineIssues.add(position);
    }
    try {
      const subtotal = lineSubtotal(line.quantity, product.unitPrice);
      lineDiscount(line.discount, subtotal);
      subtotals.set(position, subtotal);
    } catch (error) {
      if (!(error instanceof InvoiceAmountError)) throw error;
      issues.push(
        error.code === "DISCOUNT_EXCEEDS_SUBTOTAL"
          ? issue(
              "DISCOUNT_EXCEEDS_SUBTOTAL",
              `Línea ${position}: el descuento ${line.discount} supera la cantidad por el precio.`,
              { line: position },
            )
          : issue("AMOUNT_OUT_OF_RANGE", `Línea ${position}: un importe no cabe en el XSD.`, {
              line: position,
            }),
      );
      lineIssues.add(position);
    }
  });

  // 5. Impuestos de cada referencia del producto, por la fecha de emisión.
  const rates = new Map<number, EvaluatedTax[]>();
  draft.lines.forEach((line, index) => {
    const position = index + 1;
    const product = input.products.get(line.productId);
    if (!product) return;
    const lineRates: EvaluatedTax[] = [];
    for (const ref of product.taxes) {
      const label = `${TAX_LABELS[ref.catalogType] ?? ref.catalogType} ${ref.entryKey}`;
      const availability = input.taxes.get(ref.catalogType)?.get(ref.entryKey);
      const version = availability?.applicable ?? null;
      if (!availability?.usable || !version) {
        issues.push(
          issue(
            "TAX_REFERENCE_NOT_USABLE",
            `Línea ${position}: la tarifa ${label} del producto ${product.name} no está habilitada o no está vigente en la fecha de emisión.`,
            { line: position },
          ),
        );
        lineIssues.add(position);
        continue;
      }
      const percentage = calculationPercentage(version);
      if (
        availability.calculationData !== "COMPLETE" ||
        version.sriTaxCode === null ||
        percentage === null
      ) {
        issues.push(
          issue(
            "TAX_CALCULATION_DATA_MISSING",
            `Línea ${position}: el ${label} del producto ${product.name} no tiene datos de cálculo (falta la tarifa aplicable).`,
            { line: position },
          ),
        );
        lineIssues.add(position);
        continue;
      }
      lineRates.push({
        taxCode: version.sriTaxCode,
        rateCode: availability.code,
        percentage,
        catalogType: ref.catalogType,
        entryKey: ref.entryKey,
        versionId: version.id,
        officialLabel: version.officialLabel,
        datasetVersion: version.datasetVersion,
        base: "0",
        amount: "0",
      });
    }
    rates.set(position, lineRates);
  });

  // 6. Cálculo y límites del esquema.
  const { lines, totals } = measureArithmetic(() => {
    const lines: EvaluatedLine[] = [];
    draft.lines.forEach((line, index) => {
      const position = index + 1;
      const product = input.products.get(line.productId);
      const subtotal = subtotals.get(position);
      if (!product || subtotal === undefined || lineIssues.has(position)) return;
      try {
        const discount = lineDiscount(line.discount, subtotal);
        const base = taxableBase(subtotal, discount);
        lines.push({
          position,
          productId: product.id,
          mainCode: product.mainCode,
          auxiliaryCode: product.auxiliaryCode,
          description: product.name,
          quantity: line.quantity,
          unitPrice: product.unitPrice,
          discount,
          subtotal,
          taxableBase: base,
          taxes: (rates.get(position) ?? []).map((rate) => ({
            ...rate,
            base,
            amount: taxAmount(base, rate.percentage),
          })),
        });
      } catch (error) {
        if (!(error instanceof InvoiceAmountError)) throw error;
        issues.push(
          issue(
            "AMOUNT_OUT_OF_RANGE",
            `Línea ${position}: un importe calculado supera los 14 dígitos que admite el XSD.`,
            { line: position },
          ),
        );
      }
    });
    let totals: InvoiceTotals | null = null;
    if (draft.lines.length > 0 && lines.length === draft.lines.length) {
      try {
        totals = invoiceTotals(lines);
      } catch (error) {
        if (!(error instanceof InvoiceAmountError)) throw error;
        issues.push(
          issue(
            "AMOUNT_OUT_OF_RANGE",
            "Un total de la factura supera los 14 dígitos y 2 decimales que admite el XSD.",
          ),
        );
      }
    }
    return { lines, totals };
  });

  // 7. Formas de pago utilizables y que suman el importe total.
  const methods: EvaluatedPayment[] = [];
  draft.payments.forEach((payment, index) => {
    const position = index + 1;
    const availability = input.paymentMethods.get(payment.paymentMethod);
    const version = availability?.applicable ?? null;
    if (!availability?.usable || !version) {
      issues.push(
        issue(
          "PAYMENT_METHOD_NOT_USABLE",
          `Forma de pago ${position}: ${payment.paymentMethod} no está vigente en la fecha de emisión.`,
          { payment: position },
        ),
      );
      return;
    }
    methods.push({
      position,
      entryKey: payment.paymentMethod,
      code: availability.code,
      versionId: version.id,
      officialLabel: version.officialLabel,
      datasetVersion: version.datasetVersion,
      amount: payment.amount ?? "0",
    });
  });
  let payments: EvaluatedPayment[] | null = null;
  if (totals && draft.payments.length > 0) {
    const total = totals.total;
    const amounts = draft.payments.map((payment) => payment.amount);
    let matched: string[] | null = null;
    if (amounts.length === 1 && amounts[0] === null) {
      matched = [total];
    } else if (amounts.some((amount) => amount === null)) {
      issues.push(
        issue(
          "PAYMENTS_DO_NOT_MATCH_TOTAL",
          "Con varias formas de pago, cada una debe llevar su importe.",
        ),
      );
    } else {
      const given = amounts.filter((amount): amount is string => amount !== null);
      const sum = sumExact(given);
      if (compareDecimalStrings(sum, total) === 0) {
        matched = given.map((amount) => materializeMoney(amount, "total"));
      } else {
        issues.push(
          issue(
            "PAYMENTS_DO_NOT_MATCH_TOTAL",
            `Las formas de pago suman ${usd(materializeMoney(sum, "total"))} y el importe total es ${usd(total)}: la diferencia es ${usd(materializeMoney(subtractExact(total, sum), "total"))}.`,
          ),
        );
      }
    }
    if (matched && methods.length === draft.payments.length) {
      payments = methods.map((method, index) => ({ ...method, amount: matched[index]! }));
    }
  }

  // 8. Consumidor final: política vigente y monto máximo.
  if (buyer?.systemRecord === CONSUMER_FINAL) {
    const policy = input.consumerFinalPolicy;
    if (!policy) {
      issues.push(
        issue(
          "CONSUMER_FINAL_POLICY_MISSING",
          "No hay una política de consumidor final vigente en la fecha de emisión.",
        ),
      );
    } else if (totals && compareDecimalStrings(totals.total, policy.maxAmount) > 0) {
      issues.push(
        issue(
          "CONSUMER_FINAL_LIMIT_EXCEEDED",
          `El importe total ${usd(totals.total)} supera el monto máximo de ${usd(materializeMoney(policy.maxAmount, "total"))} para consumidor final: identifica al comprador.`,
        ),
      );
    }
  }

  // 9. Casos especiales: cada anexo activado por el emisor debe estar soportado.
  const specialCases: SpecialCaseRule[] = [];
  if (input.config) {
    for (const { annex, active } of issuerSpecialCases(input.config.profile)) {
      const entry = input.specialCases.find((candidate) => candidate.annex === annex) ?? null;
      const supported =
        entry !== null &&
        SUPPORTED_CATEGORIES.has(entry.category) &&
        SUPPORTED_SPECIAL_CASES.has(annex);
      specialCases.push({ annex, active, category: entry?.category ?? null, supported });
      if (active && !supported) {
        issues.push(
          issue(
            "SPECIAL_CASE_UNSUPPORTED",
            `El anexo ${annex}${entry ? ` (${entry.topic})` : ""} aplica a esta factura y su generación todavía no está soportada.`,
          ),
        );
      }
    }
  }

  // 10. Esquema registrado de la factura 1.1.0 con sus imports.
  if (!input.schemaAvailable) {
    issues.push(
      issue(
        "SCHEMA_NOT_AVAILABLE",
        "El esquema XSD de la factura 1.1.0 no está registrado o le falta un archivo.",
      ),
    );
  }

  return { issues, lines, totals, payments, specialCases };
}
