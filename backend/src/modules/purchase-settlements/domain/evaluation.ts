// Evaluación de una liquidación de compra antes de reservar (add-purchase-settlements, design D3 a D9,
// D12 y D22): una función pura de los datos ya leídos. Devuelve todos los problemas en el orden de
// D12 (preparación, proveedor, dirección, límites, líneas con su IVA, cálculo y pagos), con el campo y
// la posición de la línea o del pago. La vista previa del borrador muestra todos; la emisión rechaza
// con el primero. No lee base de datos, catálogos ni reloj: el proveedor y los productos llegan leídos
// por `(company_id, id)`, y las tarifas de IVA y las formas de pago, resueltas por `catalogs` con la
// fecha de emisión. Las declaraciones de procedencia no son parte de la evaluación: las confirma quien
// emite (design D3).
import {
  DECIMAL_SPECS,
  PURCHASE_SETTLEMENT_IDENTIFICATION_TYPES,
  canonicalDecimal,
  compareDecimalStrings,
  decimalSpecViolation,
  type PurchaseSettlementErrorCode,
  type PurchaseSettlementIssue,
  type PurchaseSettlementLimits,
} from "@facturador/contracts";
import { roundHalfUp, subtractExact, sumExact } from "../../../platform/decimal/fiscal-decimal.ts";
import { DocumentAmountError, materializeMoney } from "../../fiscal/domain/document-amounts.ts";
import {
  calculatePurchaseSettlementAmounts,
  purchaseSettlementLineAmounts,
  type PurchaseSettlementAmounts,
  type PurchaseSettlementLineAmounts,
} from "./amounts.ts";
import type { DraftLine, PurchaseSettlementDraftContent } from "./draft.ts";

/** Una versión de una entrada de catálogo tal como la resolvió `catalogs` en una fecha. */
export type CatalogVersion = Readonly<{
  catalogType: string;
  entryKey: string;
  code: string;
  officialLabel: string;
  versionId: string;
  datasetVersion: number;
  percentage: string | null;
  rateKind: string | null;
}>;

/** Disponibilidad de una entrada para la empresa en la fecha de emisión. */
export type CatalogOption = Readonly<{
  entryKey: string;
  /** Versión aplicable en la fecha, o null si no hay. */
  applicable: CatalogVersion | null;
  /** Soportada, vigente y habilitada. */
  usable: boolean;
}>;

/** El tercero elegido como proveedor, leído por `(company_id, id)` (design D4). */
export type PurchaseSupplier = Readonly<{
  id: string;
  status: string;
  identificationType: string;
  identification: string;
  legalName: string;
  address: string | null;
  roles: readonly string[];
  consumerFinal: boolean;
}>;

/** El producto de una línea, leído por `(company_id, id)`: solo sugiere su código y su nombre. */
export type PurchaseProduct = Readonly<{
  id: string;
  status: string;
  name: string;
  mainCode: string | null;
  auxiliaryCode: string | null;
}>;

export type PurchaseSettlementCatalogs = Readonly<{
  /** Tarifas de IVA (`iva-rate`) por `entryKey`, con la habilitación de la empresa. */
  ivaRates: ReadonlyMap<string, CatalogOption>;
  /** Formas de pago (`payment-method`) por `entryKey`, con la habilitación de la empresa. */
  paymentMethods: ReadonlyMap<string, CatalogOption>;
}>;

export type PurchaseSettlementEvaluationInput = Readonly<{
  /** Fecha de emisión: la de hoy en la vista previa y la de la reserva al emitir (design D12). */
  issueDate: string;
  draft: Omit<PurchaseSettlementDraftContent, "emissionPointId">;
  /** El tercero del borrador, o null si el borrador lo tiene y no existe en la empresa. */
  supplier: PurchaseSupplier | null;
  /** Los productos de las líneas por id; null si no existe en la empresa. */
  products: ReadonlyMap<string, PurchaseProduct | null>;
  catalogs: PurchaseSettlementCatalogs;
  /** Límites efectivos de recursos (design D22). */
  limits: PurchaseSettlementLimits;
  /** Problemas de la preparación de la empresa, del punto, de la firma y del esquema. */
  readiness?: readonly PurchaseSettlementIssue[];
}>;

/** El IVA congelado de una línea: la entrada vigente del catálogo y su tarifa de cálculo. */
export type ResolvedIva = Readonly<{
  entry: CatalogVersion;
  rateKind: string;
  percentage: string;
}>;

export type ResolvedLine = Readonly<{
  position: number;
  productId: string | null;
  mainCode: string | null;
  auxiliaryCode: string | null;
  description: string;
  unit: string | null;
  /** Forma canónica, sin redondeo. */
  quantity: string;
  unitPrice: string;
  discount: string;
  iva: ResolvedIva;
}>;

export type ResolvedPayment = Readonly<{
  position: number;
  entry: CatalogVersion;
  total: string;
  term: string;
  timeUnit: string;
}>;

export type PurchaseSettlementEvaluation = Readonly<{
  issues: readonly PurchaseSettlementIssue[];
  /** El proveedor válido, o null. */
  supplier: PurchaseSupplier | null;
  address: string | null;
  /** Las líneas completas y válidas; la emisión solo las usa si no hay ningún problema. */
  lines: readonly ResolvedLine[];
  /** Importes de cada línea que pudo calcularse, aunque otras no: los muestra la vista previa. */
  computed: readonly PurchaseSettlementLineAmounts[];
  /** El resultado del cálculo único, o `null` si alguna línea no se calcula. */
  amounts: PurchaseSettlementAmounts | null;
  payments: readonly ResolvedPayment[];
  /** La suma exacta de los pagos con total, materializada, o null si ninguno lo tiene. */
  paymentsTotal: string | null;
}>;

type Where = Partial<Pick<PurchaseSettlementIssue, "field" | "line" | "payment">>;

const issue = (
  code: PurchaseSettlementErrorCode,
  message: string,
  where: Where = {},
): PurchaseSettlementIssue => ({
  code,
  message,
  field: where.field ?? null,
  line: where.line ?? null,
  payment: where.payment ?? null,
});

const ALLOWED_IDENTIFICATIONS: ReadonlySet<string> = new Set(
  PURCHASE_SETTLEMENT_IDENTIFICATION_TYPES,
);

/** Tarifa de cálculo: la publicada, o 0 para no objeto y exento, que no publican porcentaje. */
const ZERO_RATE_KINDS: ReadonlySet<string> = new Set(["NOT_SUBJECT", "EXEMPT"]);
export function ivaCalculationPercentage(version: CatalogVersion): string | null {
  if (version.percentage !== null) return version.percentage;
  return version.rateKind !== null && ZERO_RATE_KINDS.has(version.rateKind) ? "0" : null;
}

// Caracteres de XML 1.0: un texto con otro carácter no se podría escribir en el XML.
// eslint-disable-next-line no-control-regex
const XML_INVALID = /[^\u0009\u000A\u000D -퟿-�\u{10000}-\u{10FFFF}]/u;
const xmlSafe = (text: string) => !XML_INVALID.test(text);

const usd = (amount: string) => `USD ${amount}`;

function supplierIssues(input: PurchaseSettlementEvaluationInput): PurchaseSettlementIssue[] {
  const { draft, supplier } = input;
  const field = "supplierPartyId";
  if (draft.supplierPartyId === null) {
    return [
      issue("PURCHASE_SETTLEMENT_SUPPLIER_REQUIRED", "Elige el proveedor de la compra.", { field }),
    ];
  }
  if (supplier === null) {
    return [
      issue("PURCHASE_SETTLEMENT_SUPPLIER_NOT_FOUND", "El proveedor no existe en tu empresa.", {
        field,
      }),
    ];
  }
  if (supplier.status !== "ACTIVE") {
    return [
      issue(
        "PURCHASE_SETTLEMENT_SUPPLIER_INACTIVE",
        `El proveedor ${supplier.legalName} está inactivo: actívalo en Clientes y proveedores o elige otro.`,
        { field },
      ),
    ];
  }
  if (supplier.consumerFinal || supplier.identificationType === "07") {
    return [
      issue(
        "PURCHASE_SETTLEMENT_SUPPLIER_CONSUMER_FINAL",
        "La liquidación de compra no admite al consumidor final: el proveedor debe estar identificado.",
        { field },
      ),
    ];
  }
  if (!ALLOWED_IDENTIFICATIONS.has(supplier.identificationType)) {
    const reason =
      supplier.identificationType === "04"
        ? "tiene RUC, y la liquidación de compra del sistema solo documenta compras a personas sin RUC activo (caso c) del art. 13)"
        : "tiene una identificación del exterior, fuera del alcance actual";
    return [
      issue(
        "PURCHASE_SETTLEMENT_SUPPLIER_IDENTIFICATION_NOT_ALLOWED",
        `El proveedor ${supplier.legalName} ${reason}. Es una restricción del sistema para el caso c), no una regla para toda liquidación: el proveedor debe identificarse con cédula o pasaporte.`,
        { field },
      ),
    ];
  }
  if (!supplier.roles.includes("SUPPLIER")) {
    return [
      issue(
        "PURCHASE_SETTLEMENT_SUPPLIER_ROLE_REQUIRED",
        `${supplier.legalName} no tiene el rol de proveedor: márcalo como proveedor en Clientes y proveedores. La liquidación no asigna roles.`,
        { field },
      ),
    ];
  }
  return [];
}

function addressIssues(input: PurchaseSettlementEvaluationInput): PurchaseSettlementIssue[] {
  const address = input.draft.supplierAddress;
  const field = "supplierAddress";
  if (address === null) {
    return [
      issue("PURCHASE_SETTLEMENT_ADDRESS_REQUIRED", "Escribe la dirección del proveedor.", {
        field,
      }),
    ];
  }
  if (!xmlSafe(address)) {
    return [
      issue(
        "PURCHASE_SETTLEMENT_ADDRESS_REQUIRED",
        "La dirección del proveedor tiene caracteres que no se pueden escribir en el comprobante.",
        { field },
      ),
    ];
  }
  return [];
}

function limitIssues(input: PurchaseSettlementEvaluationInput): PurchaseSettlementIssue[] {
  const { draft, limits } = input;
  const issues: PurchaseSettlementIssue[] = [];
  if (draft.lines.length > limits.lines) {
    issues.push(
      issue(
        "PURCHASE_SETTLEMENT_RESOURCE_LIMIT",
        `La liquidación admite como máximo ${limits.lines} líneas. Es una defensa de recursos del sistema, no un límite del SRI.`,
        { field: "lines" },
      ),
    );
  }
  if (draft.payments.length > limits.payments) {
    issues.push(
      issue(
        "PURCHASE_SETTLEMENT_RESOURCE_LIMIT",
        `La liquidación admite como máximo ${limits.payments} pagos. Es una defensa de recursos del sistema, no un límite del SRI.`,
        { field: "payments" },
      ),
    );
  }
  return issues;
}

type LineCheck = { issues: PurchaseSettlementIssue[]; line: ResolvedLine | null };

/** Una línea: producto opcional, textos, cantidad, precio e IVA vigente (design D6 y D7). */
function checkLine(
  input: PurchaseSettlementEvaluationInput,
  line: DraftLine,
  position: number,
): LineCheck {
  const issues: PurchaseSettlementIssue[] = [];
  const at = (field: string) => ({ field, line: position });
  const label = `Línea ${position}`;
  if (line.productId !== null) {
    const product = input.products.get(line.productId) ?? null;
    if (product === null) {
      issues.push(
        issue(
          "PURCHASE_SETTLEMENT_PRODUCT_NOT_FOUND",
          `${label}: el producto no existe.`,
          at("productId"),
        ),
      );
    } else if (product.status !== "ACTIVE") {
      issues.push(
        issue(
          "PURCHASE_SETTLEMENT_PRODUCT_INACTIVE",
          `${label}: el producto ${product.name} está desactivado. Actívalo o escribe la línea sin producto.`,
          at("productId"),
        ),
      );
    }
  }
  if (line.description === null) {
    issues.push(
      issue(
        "PURCHASE_SETTLEMENT_DESCRIPTION_INVALID",
        `${label}: escribe la descripción.`,
        at("description"),
      ),
    );
  } else if (!xmlSafe(line.description)) {
    issues.push(
      issue(
        "PURCHASE_SETTLEMENT_DESCRIPTION_INVALID",
        `${label}: la descripción tiene caracteres que no se pueden escribir en el comprobante.`,
        at("description"),
      ),
    );
  }
  for (const [field, name] of [
    ["mainCode", "el código principal"],
    ["auxiliaryCode", "el código auxiliar"],
    ["unit", "la unidad de medida"],
  ] as const) {
    const text = line[field];
    if (text !== null && !xmlSafe(text)) {
      issues.push(
        issue(
          "PURCHASE_SETTLEMENT_CODE_INVALID",
          `${label}: ${name} tiene caracteres que no se pueden escribir en el comprobante.`,
          at(field),
        ),
      );
    }
  }
  if (line.quantity === null || compareDecimalStrings(line.quantity, "0") <= 0) {
    issues.push(
      issue(
        "PURCHASE_SETTLEMENT_QUANTITY_INVALID",
        `${label}: la cantidad debe ser mayor que cero.`,
        at("quantity"),
      ),
    );
  }
  if (line.unitPrice === null) {
    issues.push(
      issue(
        "PURCHASE_SETTLEMENT_PRICE_INVALID",
        `${label}: escribe el precio unitario de esta compra.`,
        at("unitPrice"),
      ),
    );
  }
  let iva: ResolvedIva | null = null;
  if (line.ivaRate === null) {
    issues.push(
      issue(
        "PURCHASE_SETTLEMENT_IVA_RATE_REQUIRED",
        `${label}: elige la tarifa de IVA.`,
        at("ivaRate"),
      ),
    );
  } else {
    const option = input.catalogs.ivaRates.get(line.ivaRate);
    const version = option?.applicable ?? null;
    const percentage = version ? ivaCalculationPercentage(version) : null;
    if (!option?.usable || !version) {
      issues.push(
        issue(
          "PURCHASE_SETTLEMENT_IVA_RATE_NOT_EFFECTIVE",
          `${label}: la tarifa de IVA ${line.ivaRate} no está vigente en la fecha de emisión o no está habilitada.`,
          at("ivaRate"),
        ),
      );
    } else if (percentage === null || version.rateKind === null) {
      issues.push(
        issue(
          "PURCHASE_SETTLEMENT_IVA_RATE_NOT_EFFECTIVE",
          `${label}: la tarifa ${version.officialLabel} no tiene un porcentaje de cálculo; elige otra.`,
          at("ivaRate"),
        ),
      );
    } else {
      iva = { entry: version, rateKind: version.rateKind, percentage };
    }
  }
  if (issues.length > 0 || line.description === null || line.quantity === null) {
    return { issues, line: null };
  }
  if (line.unitPrice === null || iva === null) return { issues, line: null };
  return {
    issues,
    line: {
      position,
      productId: line.productId,
      mainCode: line.mainCode,
      auxiliaryCode: line.auxiliaryCode,
      description: line.description,
      unit: line.unit,
      quantity: canonicalDecimal(line.quantity),
      unitPrice: canonicalDecimal(line.unitPrice),
      discount: line.discount,
      iva,
    },
  };
}

function amountIssue(error: DocumentAmountError, position: number, discount: string) {
  return error.code === "DISCOUNT_EXCEEDS_SUBTOTAL"
    ? issue(
        "PURCHASE_SETTLEMENT_DISCOUNT_EXCEEDS_SUBTOTAL",
        `Línea ${position}: el descuento ${discount} supera la cantidad por el precio unitario.`,
        { field: "discount", line: position },
      )
    : issue(
        "PURCHASE_SETTLEMENT_AMOUNT_OUT_OF_RANGE",
        `Línea ${position}: un importe calculado supera los 14 dígitos que admite el XSD.`,
        { line: position },
      );
}

type PaymentCheck = { issues: PurchaseSettlementIssue[]; payments: ResolvedPayment[] };

/** Pagos (design D9): forma de pago del catálogo, total, plazo y unidad de tiempo, todos escritos. */
function checkPayments(input: PurchaseSettlementEvaluationInput): PaymentCheck {
  const issues: PurchaseSettlementIssue[] = [];
  const payments: ResolvedPayment[] = [];
  input.draft.payments.forEach((payment, index) => {
    const position = index + 1;
    const label = `Pago ${position}`;
    const at = (field: string) => ({ field, payment: position });
    let entry: CatalogVersion | null = null;
    if (payment.paymentMethod === null) {
      issues.push(
        issue(
          "PURCHASE_SETTLEMENT_PAYMENT_METHOD_INVALID",
          `${label}: elige la forma de pago.`,
          at("paymentMethod"),
        ),
      );
    } else {
      const option = input.catalogs.paymentMethods.get(payment.paymentMethod);
      if (!option?.usable || !option.applicable) {
        issues.push(
          issue(
            "PURCHASE_SETTLEMENT_PAYMENT_METHOD_INVALID",
            `${label}: la forma de pago ${payment.paymentMethod} no está vigente en la fecha de emisión o no está habilitada.`,
            at("paymentMethod"),
          ),
        );
      } else {
        entry = option.applicable;
      }
    }
    if (payment.total === null) {
      issues.push(
        issue(
          "PURCHASE_SETTLEMENT_PAYMENT_TOTAL_REQUIRED",
          `${label}: escribe el total del pago.`,
          at("total"),
        ),
      );
    }
    if (payment.term === null) {
      issues.push(
        issue(
          "PURCHASE_SETTLEMENT_PAYMENT_TERM_REQUIRED",
          `${label}: escribe el plazo del pago.`,
          at("term"),
        ),
      );
    }
    if (payment.timeUnit === null) {
      issues.push(
        issue(
          "PURCHASE_SETTLEMENT_PAYMENT_TERM_REQUIRED",
          `${label}: escribe la unidad de tiempo del plazo, por ejemplo días o meses.`,
          at("timeUnit"),
        ),
      );
    } else if (!xmlSafe(payment.timeUnit)) {
      issues.push(
        issue(
          "PURCHASE_SETTLEMENT_PAYMENT_TERM_REQUIRED",
          `${label}: la unidad de tiempo tiene caracteres que no se pueden escribir en el comprobante.`,
          at("timeUnit"),
        ),
      );
    }
    if (
      entry !== null &&
      payment.total !== null &&
      payment.term !== null &&
      payment.timeUnit !== null &&
      xmlSafe(payment.timeUnit)
    ) {
      try {
        payments.push({
          position,
          entry,
          total: materializeMoney(payment.total, "total"),
          term: canonicalDecimal(payment.term),
          timeUnit: payment.timeUnit,
        });
      } catch (error) {
        if (!(error instanceof DocumentAmountError)) throw error;
        issues.push(
          issue(
            "PURCHASE_SETTLEMENT_AMOUNT_OUT_OF_RANGE",
            `${label}: el total no cabe en los 14 dígitos y 2 decimales que admite el XSD.`,
            at("total"),
          ),
        );
      }
    }
  });
  return { issues, payments };
}

export function evaluatePurchaseSettlement(
  input: PurchaseSettlementEvaluationInput,
): PurchaseSettlementEvaluation {
  const { draft } = input;
  const issues: PurchaseSettlementIssue[] = [...(input.readiness ?? [])];

  // 1. Proveedor (design D4) y su dirección (design D5).
  const supplierProblems = supplierIssues(input);
  issues.push(...supplierProblems);
  issues.push(...addressIssues(input));

  // 2. Límites de recursos (design D22) y contenido mínimo.
  issues.push(...limitIssues(input));
  if (draft.lines.length === 0) {
    issues.push(
      issue("PURCHASE_SETTLEMENT_LINES_REQUIRED", "Agrega al menos una línea a la liquidación.", {
        field: "lines",
      }),
    );
  }
  if (draft.payments.length === 0) {
    issues.push(
      issue("PURCHASE_SETTLEMENT_PAYMENTS_REQUIRED", "Agrega al menos un pago a la liquidación.", {
        field: "payments",
      }),
    );
  }

  // 3. Líneas con su IVA vigente, y el importe de cada una que pueda calcularse (design D6 a D8).
  const lines: ResolvedLine[] = [];
  const computed: PurchaseSettlementLineAmounts[] = [];
  draft.lines.forEach((draftLine, index) => {
    const position = index + 1;
    const checked = checkLine(input, draftLine, position);
    issues.push(...checked.issues);
    if (!checked.line) return;
    try {
      computed.push(
        purchaseSettlementLineAmounts({
          position,
          quantity: checked.line.quantity,
          unitPrice: checked.line.unitPrice,
          discount: checked.line.discount,
          rate: { rateCode: checked.line.iva.entry.code, percentage: checked.line.iva.percentage },
        }),
      );
      lines.push(checked.line);
    } catch (error) {
      if (!(error instanceof DocumentAmountError)) throw error;
      issues.push(amountIssue(error, position, draftLine.discount));
    }
  });

  // 4. El cálculo único de toda la liquidación, solo con todas sus líneas válidas.
  let amounts: PurchaseSettlementAmounts | null = null;
  if (draft.lines.length > 0 && lines.length === draft.lines.length) {
    try {
      amounts = calculatePurchaseSettlementAmounts(
        lines.map((line) => ({
          position: line.position,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discount: line.discount,
          rate: { rateCode: line.iva.entry.code, percentage: line.iva.percentage },
        })),
      );
    } catch (error) {
      if (!(error instanceof DocumentAmountError)) throw error;
      issues.push(
        issue(
          "PURCHASE_SETTLEMENT_AMOUNT_OUT_OF_RANGE",
          "Un total de la liquidación supera los 14 dígitos y 2 decimales que admite el XSD.",
        ),
      );
    }
  }

  // 5. Pagos y su suma exacta frente al importe total, sin tolerancia (design D9).
  const paid = checkPayments(input);
  issues.push(...paid.issues);
  const given = draft.payments
    .map((payment) => payment.total)
    .filter((total): total is string => total !== null);
  const sum = given.length > 0 ? sumExact(given) : null;
  const paymentsTotal =
    sum !== null && decimalSpecViolation(roundHalfUp(sum, 2), DECIMAL_SPECS.importe) === null
      ? roundHalfUp(sum, 2)
      : null;
  if (
    amounts !== null &&
    sum !== null &&
    draft.payments.length > 0 &&
    given.length === draft.payments.length &&
    compareDecimalStrings(sum, amounts.totals.total) !== 0
  ) {
    const difference = subtractExact(amounts.totals.total, sum);
    const missing = compareDecimalStrings(difference, "0") > 0;
    const amount = roundHalfUp(missing ? difference : subtractExact(sum, amounts.totals.total), 2);
    issues.push(
      issue(
        "PURCHASE_SETTLEMENT_PAYMENTS_MISMATCH",
        `Los pagos suman ${usd(roundHalfUp(sum, 2))} y el importe total es ${usd(amounts.totals.total)}: ${missing ? "faltan" : "sobran"} ${usd(amount)}.`,
        { field: "payments" },
      ),
    );
  }

  return {
    issues,
    supplier: supplierProblems.length === 0 ? input.supplier : null,
    address: draft.supplierAddress,
    lines,
    computed,
    amounts,
    payments: paid.payments,
    paymentsTotal,
  };
}
