// Evaluación de un comprobante de retención antes de reservar (add-withholding-receipts, design D3
// a D6, D8, D9, D12, D15 y D25): una función pura de los datos ya leídos. Devuelve todos los
// problemas en el orden de D15 (sujeto y parte relacionada, período, límites de recursos, documentos
// sustento con sus impuestos y pagos, retenciones, cálculo y contribuyente especial), con la posición
// del documento y, dentro de él, la del impuesto, el pago o la retención. La vista previa del borrador
// muestra todos; la emisión rechaza con el primero. No lee base de datos, catálogos ni reloj: las
// entradas llegan resueltas por `catalogs` con la fecha de emisión, y los códigos de porcentaje de los
// impuestos del documento con la fecha de ese documento.
import {
  DECIMAL_SPECS,
  FISCAL_PERIOD_PATTERN,
  SUPPORT_AUTHORIZATION_PATTERN,
  SUPPORT_CODE_PATTERN,
  SUPPORT_NUMBER_PATTERN,
  WITHHOLDING_SUBJECT_RULE_SOURCE,
  canonicalDecimal,
  decimalSpecViolation,
  type ScopeClassification,
  type WithholdingErrorCode,
  type WithholdingIssue,
  type WithholdingLimits,
} from "@facturador/contracts";
import {
  WithholdingAmountError,
  calculateWithholdingAmounts,
  isWithholdingBase,
  isWithholdingPercentage,
  type WithholdingAmount,
  type WithholdingAmounts,
} from "./amounts.ts";
import type { DraftSupport, DraftSupportTax, WithholdingDraftContent } from "./draft.ts";

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
  scopeClassification: ScopeClassification | null;
  allowedSupportCodes: readonly string[] | null;
  sourceRef: string;
}>;

/** Disponibilidad de una entrada para la empresa en la fecha de emisión (design D11 y D12). */
export type CatalogOption = Readonly<{
  entryKey: string;
  /** Versión aplicable en la fecha, o null si no hay. */
  applicable: CatalogVersion | null;
  /** Clasificación de la versión aplicable o, sin ella, de la última publicada. */
  scopeClassification: ScopeClassification | null;
  enabled: boolean;
  /** Soportada, vigente y habilitada. */
  usable: boolean;
}>;

/** Clave de un código de porcentaje resuelto en la fecha de su documento sustento. */
export const supportTaxRateKey = (tax: string, entryKey: string, date: string) =>
  `${tax}|${entryKey}|${date}`;

/** Catálogo del código de porcentaje de cada impuesto del documento sustento (design D6). */
export const SUPPORT_TAX_RATE_CATALOGS = {
  "2": "iva-rate",
  "3": "ice-rate",
  "5": "irbpnr-rate",
} as const;

/**
 * Los códigos de porcentaje que la evaluación necesita resueltos, cada uno con la fecha de su
 * documento sustento: quien llama los resuelve con `catalogs` y los entrega en `supportTaxRates`.
 */
export function supportTaxRateQueries(supports: readonly DraftSupport[]): {
  key: string;
  catalogType: (typeof SUPPORT_TAX_RATE_CATALOGS)[keyof typeof SUPPORT_TAX_RATE_CATALOGS];
  entryKey: string;
  date: string;
}[] {
  const queries = new Map<string, ReturnType<typeof supportTaxRateQueries>[number]>();
  for (const support of supports) {
    if (support.issueDate === null || !isRealDate(support.issueDate)) continue;
    for (const tax of support.taxes) {
      if (tax.tax === null || tax.rateEntryKey === null) continue;
      const catalogType =
        SUPPORT_TAX_RATE_CATALOGS[tax.tax as keyof typeof SUPPORT_TAX_RATE_CATALOGS];
      if (!catalogType) continue;
      const key = supportTaxRateKey(tax.tax, tax.rateEntryKey, support.issueDate);
      queries.set(key, { key, catalogType, entryKey: tax.rateEntryKey, date: support.issueDate });
    }
  }
  return [...queries.values()];
}

export type WithholdingCatalogs = Readonly<{
  /** Impuestos a retener (tabla 19), por código. */
  withholdingTaxes: ReadonlyMap<string, CatalogOption>;
  /** Conceptos de la renta, por `entryKey`. */
  incomeConcepts: ReadonlyMap<string, CatalogOption>;
  /** Códigos de retención del IVA, por `entryKey`. */
  ivaCodes: ReadonlyMap<string, CatalogOption>;
  /** Tipos de documento sustento, por código. */
  documentTypes: ReadonlyMap<string, CatalogOption>;
  /** Códigos de sustento, por código. */
  supportCodes: ReadonlyMap<string, CatalogOption>;
  /** Formas de pago, por `entryKey`, con la habilitación de la empresa (el pago lo hace ella). */
  paymentMethods: ReadonlyMap<string, CatalogOption>;
  /** Impuestos del documento (`tax`: 2, 3 y 5) vigentes en la fecha de emisión, para su denominación. */
  supportTaxes: ReadonlyMap<string, CatalogVersion>;
  /**
   * Códigos de porcentaje de los impuestos del documento resueltos en la fecha de cada documento,
   * sin habilitación de la empresa (`supportTaxRateKey`); null si no hay versión en esa fecha.
   */
  supportTaxRates: ReadonlyMap<string, CatalogVersion | null>;
}>;

/** El tercero elegido, leído por `(company_id, id)` (design D3). */
export type WithheldSubject = Readonly<{
  id: string;
  status: string;
  identificationType: string;
  identification: string;
  legalName: string;
  roles: readonly string[];
  consumerFinal: boolean;
}>;

export type WithholdingEvaluationInput = Readonly<{
  /** Fecha de emisión: la de hoy en la vista previa y la de la reserva al emitir (design D12). */
  issueDate: string;
  draft: Omit<WithholdingDraftContent, "emissionPointId">;
  /** El tercero del borrador, o null si el borrador lo tiene y no existe en la empresa. */
  subject: WithheldSubject | null;
  catalogs: WithholdingCatalogs;
  /** Límites efectivos de recursos (design D25). */
  limits: WithholdingLimits;
  /** Número de contribuyente especial de la configuración vigente, si lo tiene. */
  specialTaxpayerNumber: string | null;
  /** Problemas de la preparación de la empresa, del punto, de la firma y del esquema. */
  readiness?: readonly WithholdingIssue[];
}>;

export type ResolvedSupportTax = Readonly<{
  position: number;
  tax: "2" | "3" | "5";
  /** La entrada del catálogo `tax` vigente en la fecha de emisión. */
  taxEntry: CatalogVersion;
  /** El código de porcentaje vigente en la fecha del documento. */
  rate: CatalogVersion;
  /** La tarifa: del catálogo para el IVA, declarada para ICE e IRBPNR (forma canónica). */
  tariff: string;
  tariffBasis: "CATALOG" | "USER_DECLARED";
  base: string;
  amount: string;
}>;

export type ResolvedSupportPayment = Readonly<{
  position: number;
  entry: CatalogVersion;
  total: string;
}>;

export type ResolvedWithholdingItem = Readonly<{
  support: number;
  position: number;
  tax: "1" | "2";
  /** La entrada de `withholding-tax`. */
  taxEntry: CatalogVersion;
  /** La entrada de `withholding-income-concept` o de `withholding-iva-code`. */
  entry: CatalogVersion;
  base: string;
}>;

export type ResolvedSupport = Readonly<{
  position: number;
  documentType: CatalogVersion;
  supportCode: CatalogVersion;
  number: string;
  issueDate: string;
  authorizationNumber: string | null;
  totalWithoutTaxes: string;
  importTotal: string;
  taxes: readonly ResolvedSupportTax[];
  payments: readonly ResolvedSupportPayment[];
  withholdings: readonly ResolvedWithholdingItem[];
}>;

export type WithholdingEvaluation = Readonly<{
  issues: readonly WithholdingIssue[];
  /** Mes de la fecha de emisión (`MM/AAAA`). */
  issueMonth: string;
  /** El período elegido es válido y distinto del mes de emisión: un aviso que no bloquea. */
  periodDiffersFromIssueMonth: boolean;
  /** Las retenciones que pueden calcularse, aunque otras no: las muestra la vista previa. */
  computed: readonly (WithholdingAmount & { item: ResolvedWithholdingItem })[];
  /** Los documentos completos y válidos; la emisión solo los usa si no hay ningún problema. */
  supports: readonly ResolvedSupport[];
  /** El resultado del cálculo único de todas las retenciones, o `null` si alguna no se calcula. */
  amounts: WithholdingAmounts | null;
}>;

type Position = Partial<Pick<WithholdingIssue, "support" | "tax" | "payment" | "withholding">>;

const issue = (
  code: WithholdingErrorCode,
  message: string,
  position: Position = {},
): WithholdingIssue => ({
  code,
  message,
  support: position.support ?? null,
  tax: position.tax ?? null,
  payment: position.payment ?? null,
  withholding: position.withholding ?? null,
});

/** RUC, cédula y pasaporte: los tipos de identificación de un sujeto retenido del MVP (design D3). */
export const WITHHELD_IDENTIFICATION_TYPES = ["04", "05", "06"] as const;
const SUPPORTED_IDENTIFICATIONS: ReadonlySet<string> = new Set(WITHHELD_IDENTIFICATION_TYPES);
const SUPPORT_TAX_CODES = new Set(["2", "3", "5"]);
const TAX_LABELS: Record<string, string> = { "2": "IVA", "3": "ICE", "5": "IRBPNR" };

/** `AAAA-MM-DD` que es una fecha real. */
export function isRealDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

/** Mes `MM/AAAA` de una fecha `AAAA-MM-DD`. */
export const monthOf = (date: string) => `${date.slice(5, 7)}/${date.slice(0, 4)}`;

/** `AAAA-MM` de un período `MM/AAAA`, comparable como texto. */
const periodKey = (period: string) => `${period.slice(3)}-${period.slice(0, 2)}`;

const isMoney = (value: string) => decimalSpecViolation(value, DECIMAL_SPECS.importe) === null;

function subjectIssues(input: WithholdingEvaluationInput): WithholdingIssue[] {
  const { draft, subject } = input;
  const issues: WithholdingIssue[] = [];
  if (draft.partyId === null) {
    issues.push(issue("WITHHOLDING_DRAFT_INCOMPLETE", "Elige el proveedor al que se le retiene."));
  } else if (subject === null) {
    issues.push(issue("WITHHOLDING_SUBJECT_NOT_FOUND", "El proveedor no existe en tu empresa."));
  } else if (subject.status !== "ACTIVE") {
    issues.push(
      issue(
        "WITHHOLDING_SUBJECT_INACTIVE",
        `El proveedor ${subject.legalName} está inactivo: actívalo en Terceros o elige otro.`,
      ),
    );
  } else if (subject.consumerFinal || subject.identificationType === "07") {
    issues.push(
      issue(
        "WITHHOLDING_SUBJECT_CONSUMER_FINAL",
        `El sujeto retenido debe estar identificado: el consumidor final no recibe un comprobante de retención (${WITHHOLDING_SUBJECT_RULE_SOURCE}).`,
      ),
    );
  } else if (!SUPPORTED_IDENTIFICATIONS.has(subject.identificationType)) {
    issues.push(
      issue(
        "WITHHOLDING_SUBJECT_FOREIGN_OUT_OF_SCOPE",
        "Las retenciones a sujetos con identificación del exterior están fuera del alcance del sistema: el proveedor debe tener RUC, cédula o pasaporte.",
      ),
    );
  } else if (!subject.roles.includes("SUPPLIER")) {
    issues.push(
      issue(
        "WITHHOLDING_SUBJECT_NOT_SUPPLIER",
        `${subject.legalName} no tiene el rol de proveedor: agrégalo en Terceros.`,
      ),
    );
  }
  if (draft.relatedParty === null) {
    issues.push(
      issue(
        "WITHHOLDING_RELATED_PARTY_REQUIRED",
        "Declara si el proveedor es parte relacionada de tu empresa: SI o NO.",
      ),
    );
  }
  return issues;
}

function periodIssues(
  fiscalPeriod: string | null,
  issueDate: string,
): { issues: WithholdingIssue[]; differs: boolean } {
  if (fiscalPeriod === null) {
    return {
      issues: [issue("WITHHOLDING_DRAFT_INCOMPLETE", "Indica el período fiscal de la retención.")],
      differs: false,
    };
  }
  if (!FISCAL_PERIOD_PATTERN.test(fiscalPeriod)) {
    return {
      issues: [
        issue(
          "WITHHOLDING_FISCAL_PERIOD_INVALID",
          "El período fiscal debe tener la forma MM/AAAA.",
        ),
      ],
      differs: false,
    };
  }
  if (periodKey(fiscalPeriod) > issueDate.slice(0, 7)) {
    return {
      issues: [
        issue(
          "WITHHOLDING_FISCAL_PERIOD_IN_FUTURE",
          `El período fiscal ${fiscalPeriod} es posterior al mes de emisión (${monthOf(issueDate)}).`,
        ),
      ],
      differs: false,
    };
  }
  return { issues: [], differs: fiscalPeriod !== monthOf(issueDate) };
}

function limitIssues(input: WithholdingEvaluationInput): WithholdingIssue[] {
  const { draft, limits } = input;
  const issues: WithholdingIssue[] = [];
  const defense = "Es una defensa de recursos del sistema, no un límite del SRI.";
  if (draft.supports.length > limits.supports) {
    issues.push(
      issue(
        "WITHHOLDING_RESOURCE_LIMIT",
        `El sistema admite como máximo ${limits.supports} documentos sustento por comprobante. ${defense}`,
      ),
    );
  }
  draft.supports.forEach((support, index) => {
    const position = { support: index + 1 };
    for (const [list, max, noun] of [
      [support.withholdings, limits.itemsPerSupport, "retenciones"],
      [support.taxes, limits.taxesPerSupport, "impuestos declarados"],
      [support.payments, limits.paymentsPerSupport, "formas de pago"],
    ] as const) {
      if (list.length > max) {
        issues.push(
          issue(
            "WITHHOLDING_RESOURCE_LIMIT",
            `El sistema admite como máximo ${max} ${noun} por documento sustento. ${defense}`,
            position,
          ),
        );
      }
    }
  });
  return issues;
}

function supportTaxIssues(
  tax: DraftSupportTax,
  position: { support: number; tax: number },
  supportDate: string | null,
  catalogs: WithholdingCatalogs,
): { issues: WithholdingIssue[]; resolved: ResolvedSupportTax | null } {
  const issues: WithholdingIssue[] = [];
  const taxCode = tax.tax;
  if (taxCode === null) {
    issues.push(issue("WITHHOLDING_DRAFT_INCOMPLETE", "Elige el impuesto declarado.", position));
  } else if (!SUPPORT_TAX_CODES.has(taxCode)) {
    issues.push(
      issue(
        "WITHHOLDING_SUPPORT_TAX_INVALID",
        "El impuesto del documento sustento debe ser IVA, ICE o IRBPNR.",
        position,
      ),
    );
  }
  let rate: CatalogVersion | null = null;
  if (tax.rateEntryKey === null) {
    issues.push(issue("WITHHOLDING_DRAFT_INCOMPLETE", "Elige el código de porcentaje.", position));
  } else if (taxCode !== null && SUPPORT_TAX_CODES.has(taxCode) && supportDate !== null) {
    rate =
      catalogs.supportTaxRates.get(supportTaxRateKey(taxCode, tax.rateEntryKey, supportDate)) ??
      null;
    if (rate === null) {
      issues.push(
        issue(
          "WITHHOLDING_SUPPORT_TAX_INVALID",
          `El código de porcentaje ${tax.rateEntryKey} de ${TAX_LABELS[taxCode]} no está vigente en la fecha del documento sustento.`,
          position,
        ),
      );
    }
  }
  let tariff: string | null = null;
  if (taxCode === "2") {
    if (tax.rate !== null) {
      issues.push(
        issue(
          "WITHHOLDING_SUPPORT_TAX_INVALID",
          "La tarifa del IVA sale del catálogo: no se declara.",
          position,
        ),
      );
    } else if (rate) {
      if (rate.rateKind === "PERCENTAGE" && rate.percentage !== null) tariff = rate.percentage;
      else if (rate.rateKind === "NOT_SUBJECT" || rate.rateKind === "EXEMPT") tariff = "0";
      else {
        issues.push(
          issue(
            "WITHHOLDING_SUPPORT_TAX_INVALID",
            `El IVA ${rate.officialLabel} no tiene una tarifa en el catálogo: no se puede declarar en el documento sustento.`,
            position,
          ),
        );
      }
    }
  } else if (taxCode === "3" || taxCode === "5") {
    if (tax.rate === null) {
      issues.push(
        issue(
          "WITHHOLDING_DRAFT_INCOMPLETE",
          `Indica la tarifa de ${TAX_LABELS[taxCode]} del documento sustento.`,
          position,
        ),
      );
    } else if (!isWithholdingPercentage(tax.rate)) {
      issues.push(
        issue(
          "WITHHOLDING_SUPPORT_TAX_INVALID",
          "La tarifa admite hasta 3 dígitos y 2 decimales, sin negativos.",
          position,
        ),
      );
    } else {
      tariff = canonicalDecimal(tax.rate);
    }
  }
  for (const [value, label] of [
    [tax.base, "la base imponible"],
    [tax.amount, "el valor del impuesto"],
  ] as const) {
    if (value === null) {
      issues.push(issue("WITHHOLDING_DRAFT_INCOMPLETE", `Indica ${label}.`, position));
    } else if (!isMoney(value)) {
      issues.push(
        issue(
          "WITHHOLDING_SUPPORT_TAX_INVALID",
          `${label[0]!.toUpperCase()}${label.slice(1)} debe ser un importe de hasta 14 dígitos y 2 decimales, sin negativos.`,
          position,
        ),
      );
    }
  }
  const taxEntry = taxCode === null ? undefined : catalogs.supportTaxes.get(taxCode);
  if (issues.length > 0 || rate === null || tariff === null || !taxEntry) {
    return { issues, resolved: null };
  }
  return {
    issues,
    resolved: {
      position: position.tax,
      tax: taxCode as ResolvedSupportTax["tax"],
      taxEntry,
      rate,
      tariff,
      tariffBasis: taxCode === "2" ? "CATALOG" : "USER_DECLARED",
      base: tax.base!,
      amount: tax.amount!,
    },
  };
}

function withholdingItemIssues(
  item: DraftSupport["withholdings"][number],
  position: { support: number; withholding: number },
  catalogs: WithholdingCatalogs,
): { issues: WithholdingIssue[]; resolved: ResolvedWithholdingItem | null } {
  const issues: WithholdingIssue[] = [];
  let taxEntry: CatalogVersion | null = null;
  let entry: CatalogVersion | null = null;
  if (item.tax === null) {
    issues.push(
      issue(
        "WITHHOLDING_DRAFT_INCOMPLETE",
        "Elige el impuesto que se retiene: renta o IVA.",
        position,
      ),
    );
  } else {
    const tax = catalogs.withholdingTaxes.get(item.tax);
    if (!tax?.usable || !tax.applicable || (item.tax !== "1" && item.tax !== "2")) {
      issues.push(
        issue(
          "WITHHOLDING_TAX_NOT_SUPPORTED",
          "El sistema retiene solo el impuesto a la renta y el IVA: el ISD y los demás impuestos están fuera del alcance actual.",
          position,
        ),
      );
    } else {
      taxEntry = tax.applicable;
    }
  }
  if (item.entryKey === null) {
    issues.push(
      issue(
        "WITHHOLDING_DRAFT_INCOMPLETE",
        item.tax === "2"
          ? "Elige el código de retención del IVA."
          : "Elige el concepto de retención.",
        position,
      ),
    );
  } else if (taxEntry) {
    const income = item.tax === "1";
    const option = (income ? catalogs.incomeConcepts : catalogs.ivaCodes).get(item.entryKey);
    const noun = income ? "concepto de renta" : "código de retención del IVA";
    if (!option) {
      issues.push(
        issue(
          "WITHHOLDING_ENTRY_NOT_USABLE",
          `El ${noun} ${item.entryKey} no existe en el catálogo.`,
          position,
        ),
      );
    } else if (
      option.scopeClassification !== null &&
      !option.scopeClassification.startsWith("SUPPORTED")
    ) {
      const code = option.applicable?.code ?? item.entryKey;
      issues.push(
        income
          ? issue(
              "WITHHOLDING_CONCEPT_NOT_SUPPORTED",
              outOfScopeConceptMessage(code, option),
              position,
            )
          : issue(
              "WITHHOLDING_IVA_CODE_NOT_SUPPORTED",
              `El código de retención del IVA ${code} no se emite como retención en el alcance actual: la fuente no define su representación en el comprobante.`,
              position,
            ),
      );
    } else if (!option.applicable) {
      issues.push(
        issue(
          "WITHHOLDING_ENTRY_NOT_USABLE",
          `El ${noun} ${item.entryKey} no está vigente en la fecha de emisión.`,
          position,
        ),
      );
    } else if (!option.usable) {
      issues.push(
        issue(
          "WITHHOLDING_ENTRY_NOT_USABLE",
          `El ${noun} ${option.applicable.code} está deshabilitado para tu empresa.`,
          position,
        ),
      );
    } else if (option.applicable.percentage === null) {
      issues.push(
        issue(
          "WITHHOLDING_ENTRY_NOT_USABLE",
          `El ${noun} ${option.applicable.code} no tiene un porcentaje numérico en el catálogo.`,
          position,
        ),
      );
    } else {
      entry = option.applicable;
    }
  }
  if (item.base === null) {
    issues.push(issue("WITHHOLDING_DRAFT_INCOMPLETE", "Indica la base de la retención.", position));
  } else if (!isWithholdingBase(item.base)) {
    issues.push(
      issue(
        "WITHHOLDING_BASE_INVALID",
        "La base de la retención debe ser mayor que cero, con hasta 14 dígitos y 2 decimales.",
        position,
      ),
    );
  }
  if (issues.length > 0 || !taxEntry || !entry) return { issues, resolved: null };
  return {
    issues,
    resolved: {
      support: position.support,
      position: position.withholding,
      tax: item.tax as ResolvedWithholdingItem["tax"],
      taxEntry,
      entry,
      base: item.base!,
    },
  };
}

/** Conceptos de distribución de dividendos: la fuente los nombra así en su denominación. */
const DIVIDENDS = /dividendo/i;

/**
 * Mensaje de un concepto de renta fuera de alcance con su razón: los dividendos y los pagos al
 * exterior se nombran como tales, y los demás con la razón de su clasificación.
 */
function outOfScopeConceptMessage(code: string, option: CatalogOption): string {
  const label = option.applicable?.officialLabel ?? "";
  if (option.scopeClassification === "OUT_OF_SCOPE_NON_RESIDENT") {
    return `El concepto de renta ${code} es un pago a no residentes: los pagos al exterior están fuera del alcance actual.`;
  }
  if (DIVIDENDS.test(label)) {
    return `El concepto de renta ${code} corresponde a dividendos: los dividendos están fuera del alcance actual.`;
  }
  const reason = CLASSIFICATION_REASONS[option.scopeClassification!] ?? option.scopeClassification;
  return `El concepto de renta ${code} está fuera del alcance actual: ${reason}.`;
}

/** Razón de cada clasificación fuera de alcance, para los mensajes y la interfaz. */
export const CLASSIFICATION_REASONS: Partial<Record<ScopeClassification, string>> = {
  OUT_OF_SCOPE_NON_RESIDENT: "pago a no residentes",
  OUT_OF_SCOPE_VARIABLE: "la fuente publica un porcentaje variable o textual",
  OUT_OF_SCOPE_SPECIAL_STRUCTURE: "exige una estructura especial excluida",
  OUT_OF_SCOPE_AMBIGUOUS_REPRESENTATION:
    "la fuente no establece la representación exacta de su código; pendiente de evidencia",
  OUT_OF_SCOPE_PENDING_EVIDENCE: "pendiente de evidencia",
  OUT_OF_SCOPE_MVP: "fuera del alcance del MVP",
  OUT_OF_SCOPE_EXPIRED: "vigencia cerrada",
};

function supportIssues(
  support: DraftSupport,
  position: number,
  input: WithholdingEvaluationInput,
): {
  issues: WithholdingIssue[];
  resolved: ResolvedSupport | null;
  items: ResolvedWithholdingItem[];
} {
  const { catalogs, issueDate } = input;
  const at = { support: position };
  const issues: WithholdingIssue[] = [];
  // Tipo de documento del MVP y código de sustento compatible, vigentes en la fecha de emisión.
  let documentType: CatalogVersion | null = null;
  if (support.documentType === null) {
    issues.push(issue("WITHHOLDING_DRAFT_INCOMPLETE", "Elige el tipo del documento sustento.", at));
  } else {
    const option = catalogs.documentTypes.get(support.documentType);
    if (!option?.usable || !option.applicable) {
      issues.push(
        issue(
          "WITHHOLDING_SUPPORT_TYPE_NOT_SUPPORTED",
          "El documento sustento debe ser una factura (01), una nota de venta (02) o una liquidación de compra (03).",
          at,
        ),
      );
    } else {
      documentType = option.applicable;
    }
  }
  let supportCode: CatalogVersion | null = null;
  if (support.supportCode === null) {
    issues.push(issue("WITHHOLDING_DRAFT_INCOMPLETE", "Elige el código de sustento.", at));
  } else if (!SUPPORT_CODE_PATTERN.test(support.supportCode)) {
    issues.push(
      issue("WITHHOLDING_SUPPORT_INVALID", "El código de sustento debe tener dos dígitos.", at),
    );
  } else if (documentType) {
    const option = catalogs.supportCodes.get(support.supportCode);
    const allowed = documentType.allowedSupportCodes ?? [];
    if (!option?.usable || !option.applicable || !allowed.includes(support.supportCode)) {
      // Los sustentos que el Catálogo ATS admite para el tipo y que se pueden usar hoy.
      const admitted = allowed.filter((code) => {
        const candidate = catalogs.supportCodes.get(code);
        return candidate?.usable === true && candidate.applicable !== null;
      });
      issues.push(
        issue(
          "WITHHOLDING_SUPPORT_CODE_INCOMPATIBLE",
          `El código de sustento ${support.supportCode} no se puede usar con ${documentType.officialLabel.toLowerCase()}. Sustentos admitidos: ${admitted.join(", ") || "ninguno vigente"}.`,
          at,
        ),
      );
    } else {
      supportCode = option.applicable;
    }
  }
  if (support.number === null) {
    issues.push(
      issue("WITHHOLDING_DRAFT_INCOMPLETE", "Indica el número del documento sustento.", at),
    );
  } else if (!SUPPORT_NUMBER_PATTERN.test(support.number)) {
    issues.push(
      issue(
        "WITHHOLDING_SUPPORT_INVALID",
        "El número del documento sustento debe tener 15 dígitos.",
        at,
      ),
    );
  }
  let supportDate: string | null = null;
  if (support.issueDate === null) {
    issues.push(
      issue("WITHHOLDING_DRAFT_INCOMPLETE", "Indica la fecha del documento sustento.", at),
    );
  } else if (!isRealDate(support.issueDate)) {
    issues.push(
      issue("WITHHOLDING_SUPPORT_INVALID", "La fecha del documento sustento no es válida.", at),
    );
  } else if (support.issueDate > issueDate) {
    issues.push(
      issue(
        "WITHHOLDING_SUPPORT_DATE_AFTER_ISSUE",
        "La fecha del documento sustento es posterior a la fecha de emisión de la retención: la retención se emite al pagar un comprobante ya presentado.",
        at,
      ),
    );
  } else {
    supportDate = support.issueDate;
  }
  if (
    support.authorizationNumber !== null &&
    !SUPPORT_AUTHORIZATION_PATTERN.test(support.authorizationNumber)
  ) {
    issues.push(
      issue(
        "WITHHOLDING_SUPPORT_INVALID",
        "La autorización del documento sustento debe tener 10, 37 o 49 dígitos.",
        at,
      ),
    );
  }
  for (const [value, label] of [
    [support.totalWithoutTaxes, "el total sin impuestos"],
    [support.importTotal, "el importe total"],
  ] as const) {
    if (value === null) {
      issues.push(
        issue("WITHHOLDING_DRAFT_INCOMPLETE", `Indica ${label} del documento sustento.`, at),
      );
    } else if (!isMoney(value)) {
      issues.push(
        issue(
          "WITHHOLDING_SUPPORT_INVALID",
          `${label[0]!.toUpperCase()}${label.slice(1)} debe ser un importe de hasta 14 dígitos y 2 decimales, sin negativos.`,
          at,
        ),
      );
    }
  }
  // Impuestos declarados (el XSD exige al menos uno), con su código vigente en la fecha del documento.
  if (support.taxes.length === 0) {
    issues.push(
      issue(
        "WITHHOLDING_DRAFT_INCOMPLETE",
        "Agrega al menos un impuesto declarado del documento sustento.",
        at,
      ),
    );
  }
  const taxes: ResolvedSupportTax[] = [];
  support.taxes.forEach((tax, index) => {
    const result = supportTaxIssues(
      tax,
      { support: position, tax: index + 1 },
      supportDate,
      catalogs,
    );
    issues.push(...result.issues);
    if (result.resolved) taxes.push(result.resolved);
  });
  // Formas de pago (el XSD exige al menos una), utilizables para la empresa en la fecha de emisión.
  if (support.payments.length === 0) {
    issues.push(
      issue(
        "WITHHOLDING_DRAFT_INCOMPLETE",
        "Agrega al menos una forma de pago del documento sustento.",
        at,
      ),
    );
  }
  const payments: ResolvedSupportPayment[] = [];
  support.payments.forEach((payment, index) => {
    const paymentAt = { support: position, payment: index + 1 };
    const before = issues.length;
    let entry: CatalogVersion | null = null;
    if (payment.paymentMethod === null) {
      issues.push(issue("WITHHOLDING_DRAFT_INCOMPLETE", "Elige la forma de pago.", paymentAt));
    } else {
      const option = catalogs.paymentMethods.get(payment.paymentMethod);
      if (!option?.usable || !option.applicable) {
        issues.push(
          issue(
            "WITHHOLDING_SUPPORT_PAYMENT_NOT_USABLE",
            `La forma de pago ${payment.paymentMethod} no está vigente o no está habilitada para tu empresa en la fecha de emisión.`,
            paymentAt,
          ),
        );
      } else {
        entry = option.applicable;
      }
    }
    if (payment.total === null) {
      issues.push(
        issue("WITHHOLDING_DRAFT_INCOMPLETE", "Indica el total de la forma de pago.", paymentAt),
      );
    } else if (!isMoney(payment.total)) {
      issues.push(
        issue(
          "WITHHOLDING_SUPPORT_INVALID",
          "El total de la forma de pago debe ser un importe de hasta 14 dígitos y 2 decimales, sin negativos.",
          paymentAt,
        ),
      );
    }
    if (issues.length === before && entry) {
      payments.push({ position: index + 1, entry, total: payment.total! });
    }
  });
  // Retenciones (el XSD exige al menos una por documento).
  if (support.withholdings.length === 0) {
    issues.push(
      issue(
        "WITHHOLDING_ITEMS_REQUIRED",
        `El documento sustento ${position} no tiene retenciones: agrega al menos una.`,
        at,
      ),
    );
  }
  const items: ResolvedWithholdingItem[] = [];
  support.withholdings.forEach((item, index) => {
    const result = withholdingItemIssues(
      item,
      { support: position, withholding: index + 1 },
      catalogs,
    );
    issues.push(...result.issues);
    if (result.resolved) items.push(result.resolved);
  });
  if (issues.length > 0 || !documentType || !supportCode || supportDate === null) {
    return { issues, resolved: null, items };
  }
  return {
    issues,
    items,
    resolved: {
      position,
      documentType,
      supportCode,
      number: support.number!,
      issueDate: supportDate,
      authorizationNumber: support.authorizationNumber,
      totalWithoutTaxes: support.totalWithoutTaxes!,
      importTotal: support.importTotal!,
      taxes,
      payments,
      withholdings: items,
    },
  };
}

function specialTaxpayerIssue(number: string | null): WithholdingIssue | null {
  if (number === null || /^[A-Za-z0-9]{3,5}$/.test(number)) return null;
  return issue(
    "WITHHOLDING_SPECIAL_TAXPAYER_INCOMPATIBLE",
    `El número de contribuyente especial de tu empresa tiene ${number.length} caracteres, y el comprobante de retención 2.0.0 admite de 3 a 5: corrígelo en la configuración tributaria antes de emitir.`,
  );
}

export function evaluateWithholdingReceipt(
  input: WithholdingEvaluationInput,
): WithholdingEvaluation {
  const { draft, issueDate } = input;
  const issues: WithholdingIssue[] = [];
  // 4. Sujeto retenido y parte relacionada.
  issues.push(...subjectIssues(input));
  // 5. Período fiscal.
  const period = periodIssues(draft.fiscalPeriod, issueDate);
  issues.push(...period.issues);
  // 6. Límites de recursos.
  issues.push(...limitIssues(input));
  // 7 y 8. Documentos sustento, con sus impuestos y pagos, y sus retenciones.
  if (draft.supports.length === 0) {
    issues.push(
      issue(
        "WITHHOLDING_SUPPORTS_REQUIRED",
        "Agrega al menos un documento sustento con sus retenciones.",
      ),
    );
  }
  const supports: ResolvedSupport[] = [];
  const items: ResolvedWithholdingItem[] = [];
  let itemCount = 0;
  draft.supports.forEach((support, index) => {
    const result = supportIssues(support, index + 1, input);
    issues.push(...result.issues);
    items.push(...result.items);
    itemCount += support.withholdings.length;
    if (result.resolved) supports.push(result.resolved);
  });
  // 9. Cálculo único: cada retención válida se calcula; el total solo si todas lo son.
  const computed: (WithholdingAmount & { item: ResolvedWithholdingItem })[] = [];
  let amounts: WithholdingAmounts | null = null;
  try {
    const result = calculateWithholdingAmounts({
      items: items.map((item) => ({
        support: item.support,
        position: item.position,
        base: item.base,
        percentage: item.entry.percentage!,
      })),
    });
    result.items.forEach((amount, index) => computed.push({ ...amount, item: items[index]! }));
    if (items.length === itemCount && itemCount > 0) amounts = result;
  } catch (error) {
    // La base y el porcentaje ya se validaron: solo un valor fuera del dominio llega aquí.
    if (!(error instanceof WithholdingAmountError) || error.code !== "AMOUNT_OUT_OF_RANGE") {
      throw error;
    }
    issues.push(
      issue(
        "WITHHOLDING_AMOUNT_OUT_OF_RANGE",
        "La retención excede los dígitos que admite el comprobante.",
        { support: error.support ?? undefined, withholding: error.position ?? undefined },
      ),
    );
  }
  // 10. Contribuyente especial compatible con la retención, y la preparación de la empresa.
  const special = specialTaxpayerIssue(input.specialTaxpayerNumber);
  if (special) issues.push(special);
  issues.push(...(input.readiness ?? []));
  return {
    issues,
    issueMonth: monthOf(issueDate),
    periodDiffersFromIssueMonth: period.differs,
    computed,
    supports,
    amounts,
  };
}
