// Formulario del borrador de liquidación de compra (add-purchase-settlements, design D24): sus
// valores, la validación de lo que el usuario escribió y la conversión al contrato. El borrador se
// guarda incompleto: lo que falta lo informa la vista previa del servidor junto a su línea o su pago.
// Nunca se envían importes ni datos derivados (subtotales, IVA, totales): los calcula el servidor. El
// producto solo propone el código y el nombre; el precio es siempre el de esta compra (design D6), y
// ninguna forma de pago, plazo ni unidad de tiempo viene precargada (design D9).
import {
  DECIMAL_SPECS,
  PURCHASE_SETTLEMENT_TEXT_MAX,
  decimalString,
  invoiceAmountSchema,
  type PurchaseSettlementDraftView,
  type UpdatePurchaseSettlementDraftInput,
} from "@facturador/contracts";
import { z } from "zod";

export type LineValues = {
  /** Presentación: con un producto del catálogo como sugerencia, o una línea libre. */
  productId: string;
  /** Presentación: el nombre del producto elegido. */
  productName: string;
  mainCode: string;
  auxiliaryCode: string;
  description: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  ivaRate: string;
};
export type PaymentValues = {
  paymentMethod: string;
  total: string;
  term: string;
  timeUnit: string;
};
export type SupplierValues = {
  id: string;
  legalName: string;
  identification: string;
};
export type FormValues = {
  emissionPointId: string;
  supplier: SupplierValues | null;
  supplierAddress: string;
  lines: LineValues[];
  payments: PaymentValues[];
};

export const blankLine = (): LineValues => ({
  productId: "",
  productName: "",
  mainCode: "",
  auxiliaryCode: "",
  description: "",
  unit: "",
  quantity: "",
  unitPrice: "",
  discount: "",
  ivaRate: "",
});
/** Un pago vacío: ni la forma de pago, ni el plazo, ni la unidad de tiempo tienen valor propuesto. */
export const blankPayment = (): PaymentValues => ({
  paymentMethod: "",
  total: "",
  term: "",
  timeUnit: "",
});

const NO_LINE_BREAK = /^[^\r\n]*$/;
const quantity = decimalString(DECIMAL_SPECS.cantidad);
const unitPrice = decimalString(DECIMAL_SPECS.precioUnitario);
const term = decimalString(DECIMAL_SPECS.plazo);
const { address, code, description, unit, timeUnit } = PURCHASE_SETTLEMENT_TEXT_MAX;

/** Solo se valida lo escrito; un campo vacío lo informa la vista previa del servidor. */
// Objetos abiertos: el resolver devuelve los valores validados, y los campos que no se validan
// (el proveedor elegido, el producto, los códigos de catálogo) deben llegar intactos.
export const formSchema = z
  .looseObject({
    supplierAddress: z.string(),
    lines: z.array(
      z.looseObject({
        mainCode: z.string(),
        auxiliaryCode: z.string(),
        description: z.string(),
        unit: z.string(),
        quantity: z.string(),
        unitPrice: z.string(),
        discount: z.string(),
      }),
    ),
    payments: z.array(z.looseObject({ total: z.string(), term: z.string(), timeUnit: z.string() })),
  })
  .superRefine((values, ctx) => {
    const text = (path: (string | number)[], value: string, max: number, label: string) => {
      if (value.trim().length > max) {
        ctx.addIssue({
          code: "custom",
          path,
          message: `${label} admite como máximo ${max} caracteres.`,
        });
      } else if (!NO_LINE_BREAK.test(value)) {
        ctx.addIssue({ code: "custom", path, message: `${label} no admite saltos de línea.` });
      }
    };
    const decimal = (path: (string | number)[], value: string, schema: z.ZodType) => {
      const trimmed = value.trim();
      if (trimmed === "") return;
      const problem = schema.safeParse(trimmed).error?.issues[0]?.message;
      if (problem) ctx.addIssue({ code: "custom", path, message: problem });
    };
    text(["supplierAddress"], values.supplierAddress, address, "La dirección del proveedor");
    values.lines.forEach((line, index) => {
      const at = (field: string) => ["lines", index, field];
      text(at("mainCode"), line.mainCode, code, "El código principal");
      text(at("auxiliaryCode"), line.auxiliaryCode, code, "El código auxiliar");
      text(at("description"), line.description, description, "La descripción");
      text(at("unit"), line.unit, unit, "La unidad de medida");
      decimal(at("quantity"), line.quantity, quantity);
      decimal(at("unitPrice"), line.unitPrice, unitPrice);
      decimal(at("discount"), line.discount, invoiceAmountSchema);
    });
    values.payments.forEach((payment, index) => {
      const at = (field: string) => ["payments", index, field];
      decimal(at("total"), payment.total, invoiceAmountSchema);
      decimal(at("term"), payment.term, term);
      text(at("timeUnit"), payment.timeUnit, timeUnit, "La unidad de tiempo");
    });
  });

export const toForm = (draft: PurchaseSettlementDraftView): FormValues => ({
  emissionPointId: draft.emissionPoint?.id ?? "",
  supplier: draft.supplier
    ? {
        id: draft.supplier.id,
        legalName: draft.supplier.legalName,
        identification: draft.supplier.identification,
      }
    : null,
  supplierAddress: draft.supplierAddress ?? "",
  lines:
    draft.lines.length > 0
      ? draft.lines.map((line) => ({
          productId: line.productId ?? "",
          productName: line.productName ?? "",
          mainCode: line.mainCode ?? "",
          auxiliaryCode: line.auxiliaryCode ?? "",
          description: line.description ?? "",
          unit: line.unit ?? "",
          quantity: line.quantity ?? "",
          unitPrice: line.unitPrice ?? "",
          // Un descuento cero se muestra vacío: el usuario escribe solo el que existe.
          discount: line.discount === "0" || line.discount === "0.00" ? "" : line.discount,
          ivaRate: line.ivaRate ?? "",
        }))
      : [blankLine()],
  payments:
    draft.payments.length > 0
      ? draft.payments.map((payment) => ({
          paymentMethod: payment.paymentMethod ?? "",
          total: payment.total ?? "",
          term: payment.term ?? "",
          timeUnit: payment.timeUnit ?? "",
        }))
      : [blankPayment()],
});

const orNull = (text: string) => text.trim() || null;

export const toInput = (
  values: FormValues,
): Omit<UpdatePurchaseSettlementDraftInput, "expectedVersion"> => ({
  emissionPointId: values.emissionPointId || null,
  supplierPartyId: values.supplier?.id ?? null,
  supplierAddress: orNull(values.supplierAddress),
  lines: values.lines.map((line) => ({
    productId: line.productId || null,
    mainCode: orNull(line.mainCode),
    auxiliaryCode: orNull(line.auxiliaryCode),
    description: orNull(line.description),
    unit: orNull(line.unit),
    quantity: orNull(line.quantity),
    unitPrice: orNull(line.unitPrice),
    // Sin descuento escrito, el servidor lo materializa en 0.00.
    discount: orNull(line.discount),
    ivaRate: line.ivaRate || null,
  })),
  payments: values.payments.map((payment) => ({
    paymentMethod: payment.paymentMethod || null,
    total: orNull(payment.total),
    term: orNull(payment.term),
    timeUnit: orNull(payment.timeUnit),
  })),
});
