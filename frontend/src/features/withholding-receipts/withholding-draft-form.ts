// Formulario del borrador de retención (add-withholding-receipts, design D24): sus valores, la
// validación de lo que el usuario escribió y la conversión al contrato. El borrador se guarda
// incompleto: lo que falta lo informa la vista previa del servidor junto a su documento y su
// retención. El frontend nunca calcula porcentajes ni valores retenidos.
import {
  FISCAL_PERIOD_PATTERN,
  SUPPORT_AUTHORIZATION_PATTERN,
  invoiceAmountSchema,
  withholdingBaseSchema,
  type SupportDocumentType,
  type SupportTaxCode,
  type UpdateWithholdingDraftInput,
  type WithholdingDraftView,
  type WithholdingOptionsView,
  type WithholdingTaxCode,
} from "@facturador/contracts";
import { z } from "zod";
import { periodParts, supportNumberDigits } from "./withholding-format";

export type TaxValues = {
  tax: SupportTaxCode | "";
  rateEntryKey: string;
  /** Solo ICE e IRBPNR: la tarifa del IVA sale del catálogo. */
  rate: string;
  base: string;
  amount: string;
};
export type PaymentValues = { paymentMethod: string; total: string };
export type ItemValues = { tax: WithholdingTaxCode | ""; entryKey: string; base: string };
export type SupportValues = {
  documentType: SupportDocumentType | "";
  supportCode: string;
  /** Los 15 dígitos, sin guiones: la máscara es presentación. */
  number: string;
  issueDate: string;
  authorizationNumber: string;
  totalWithoutTaxes: string;
  importTotal: string;
  taxes: TaxValues[];
  payments: PaymentValues[];
  withholdings: ItemValues[];
};
export type FormValues = {
  partyId: string;
  /** Sin selección inicial: la parte relacionada se declara, no se infiere. */
  relatedParty: "SI" | "NO" | "";
  month: string;
  year: string;
  emissionPointId: string;
  supports: SupportValues[];
};

export const blankTax = (): TaxValues => ({
  tax: "",
  rateEntryKey: "",
  rate: "",
  base: "",
  amount: "",
});
export const blankPayment = (): PaymentValues => ({ paymentMethod: "", total: "" });
export const blankItem = (): ItemValues => ({ tax: "", entryKey: "", base: "" });
export const blankSupport = (): SupportValues => ({
  documentType: "",
  supportCode: "",
  number: "",
  issueDate: "",
  authorizationNumber: "",
  totalWithoutTaxes: "",
  importTotal: "",
  taxes: [blankTax()],
  payments: [blankPayment()],
  withholdings: [blankItem()],
});

const firstMessage = (schema: z.ZodType, value: string) =>
  schema.safeParse(value).error?.issues[0]?.message ?? null;

/** Solo se valida lo escrito; un campo vacío lo informa la vista previa del servidor. */
export const formSchema = z
  .object({
    partyId: z.string(),
    relatedParty: z.string(),
    month: z.string(),
    year: z.string(),
    emissionPointId: z.string(),
    supports: z.array(
      z.object({
        documentType: z.string(),
        supportCode: z.string(),
        number: z.string(),
        issueDate: z.string(),
        authorizationNumber: z.string(),
        totalWithoutTaxes: z.string(),
        importTotal: z.string(),
        taxes: z.array(
          z.object({
            tax: z.string(),
            rateEntryKey: z.string(),
            rate: z.string(),
            base: z.string(),
            amount: z.string(),
          }),
        ),
        payments: z.array(z.object({ paymentMethod: z.string(), total: z.string() })),
        withholdings: z.array(
          z.object({ tax: z.string(), entryKey: z.string(), base: z.string() }),
        ),
      }),
    ),
  })
  .superRefine((values, ctx) => {
    const check = (path: (string | number)[], schema: z.ZodType, text: string) => {
      const value = text.trim();
      const problem = value === "" ? null : firstMessage(schema, value);
      if (problem) ctx.addIssue({ code: "custom", path, message: problem });
    };
    values.supports.forEach((support, s) => {
      const at = (...rest: (string | number)[]) => ["supports", s, ...rest];
      if (support.number !== "" && support.number.length !== 15) {
        ctx.addIssue({
          code: "custom",
          path: at("number"),
          message: "El número tiene 15 dígitos: establecimiento, punto y secuencial.",
        });
      }
      const authorization = support.authorizationNumber.trim();
      if (authorization !== "" && !SUPPORT_AUTHORIZATION_PATTERN.test(authorization)) {
        ctx.addIssue({
          code: "custom",
          path: at("authorizationNumber"),
          message: "La autorización tiene 10, 37 o 49 dígitos.",
        });
      }
      check(at("totalWithoutTaxes"), invoiceAmountSchema, support.totalWithoutTaxes);
      check(at("importTotal"), invoiceAmountSchema, support.importTotal);
      support.taxes.forEach((tax, t) => {
        check(at("taxes", t, "base"), invoiceAmountSchema, tax.base);
        check(at("taxes", t, "amount"), invoiceAmountSchema, tax.amount);
        if (tax.tax !== "2") check(at("taxes", t, "rate"), invoiceAmountSchema, tax.rate);
      });
      support.payments.forEach((payment, p) =>
        check(at("payments", p, "total"), invoiceAmountSchema, payment.total),
      );
      support.withholdings.forEach((item, i) =>
        check(at("withholdings", i, "base"), withholdingBaseSchema, item.base),
      );
    });
  });

export const toForm = (draft: WithholdingDraftView): FormValues => {
  const { month, year } = periodParts(draft.fiscalPeriod);
  return {
    partyId: draft.party?.id ?? "",
    relatedParty: draft.relatedParty ?? "",
    month,
    year,
    emissionPointId: draft.emissionPoint?.id ?? "",
    supports:
      draft.supports.length > 0
        ? draft.supports.map((support) => ({
            documentType: support.documentType ?? "",
            supportCode: support.supportCode ?? "",
            number: support.number ?? "",
            issueDate: support.issueDate ?? "",
            authorizationNumber: support.authorizationNumber ?? "",
            totalWithoutTaxes: support.totalWithoutTaxes ?? "",
            importTotal: support.importTotal ?? "",
            taxes: support.taxes.map((tax) => ({
              tax: tax.tax ?? "",
              rateEntryKey: tax.rateEntryKey ?? "",
              rate: tax.rate ?? "",
              base: tax.base ?? "",
              amount: tax.amount ?? "",
            })),
            payments: support.payments.map((payment) => ({
              paymentMethod: payment.paymentMethod ?? "",
              total: payment.total ?? "",
            })),
            withholdings: support.withholdings.map((item) => ({
              tax: item.tax ?? "",
              entryKey: item.entryKey ?? "",
              base: item.base ?? "",
            })),
          }))
        : [blankSupport()],
  };
};

const orNull = (text: string) => text.trim() || null;

export const toInput = (
  values: FormValues,
): Omit<UpdateWithholdingDraftInput, "expectedVersion"> => {
  const period = `${values.month}/${values.year}`;
  return {
    partyId: values.partyId || null,
    relatedParty: values.relatedParty || null,
    fiscalPeriod: FISCAL_PERIOD_PATTERN.test(period) ? period : null,
    emissionPointId: values.emissionPointId || null,
    supports: values.supports.map((support) => ({
      documentType: support.documentType || null,
      supportCode: support.supportCode || null,
      number: orNull(supportNumberDigits(support.number)),
      issueDate: support.issueDate || null,
      authorizationNumber: orNull(support.authorizationNumber),
      totalWithoutTaxes: orNull(support.totalWithoutTaxes),
      importTotal: orNull(support.importTotal),
      taxes: support.taxes.map((tax) => ({
        tax: tax.tax || null,
        rateEntryKey: tax.rateEntryKey || null,
        rate: tax.tax === "2" ? null : orNull(tax.rate),
        base: orNull(tax.base),
        amount: orNull(tax.amount),
      })),
      payments: support.payments.map((payment) => ({
        paymentMethod: payment.paymentMethod || null,
        total: orNull(payment.total),
      })),
      withholdings: support.withholdings.map((item) => ({
        tax: item.tax || null,
        entryKey: item.entryKey || null,
        base: orNull(item.base),
      })),
    })),
  };
};

type SupportTaxRate = WithholdingOptionsView["supportTaxes"][number]["rates"][number];

/**
 * Códigos de porcentaje de un impuesto del documento vigentes en su fecha (design D6 y D12): sin
 * fecha, los vigentes en la fecha de la evaluación. Una entrada con varias versiones aparece una vez.
 */
export function ratesOn(
  options: WithholdingOptionsView,
  tax: SupportTaxCode,
  date: string,
): SupportTaxRate[] {
  const on = date || options.evaluatedOn;
  const rates = options.supportTaxes.find((candidate) => candidate.tax === tax)?.rates ?? [];
  const seen = new Set<string>();
  return rates.filter((rate) => {
    const valid = rate.effectiveFrom <= on && (rate.effectiveTo === null || on <= rate.effectiveTo);
    if (!valid || seen.has(rate.entryKey)) return false;
    seen.add(rate.entryKey);
    return true;
  });
}
