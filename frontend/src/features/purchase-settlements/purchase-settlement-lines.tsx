// Líneas y pagos del borrador de liquidación de compra (add-purchase-settlements, design D24, pasos 3
// y 4). Una línea: un producto opcional que solo propone el código y el nombre (nunca el precio), o
// una línea libre; la descripción, la unidad, la cantidad, el precio de esta compra, el descuento y
// el IVA con su tarifa del catálogo; sus importes y sus problemas son los de la vista previa del
// servidor. Un pago: la forma de pago, el total, el plazo y la unidad de tiempo, sin valores
// propuestos.
"use client";

import {
  PURCHASE_SETTLEMENT_TEXT_MAX,
  type ProductView,
  type PurchaseSettlementDraftView,
  type PurchaseSettlementIssue,
  type PurchaseSettlementOptionsView,
} from "@facturador/contracts";
import { ChevronDown, PackageSearch, Trash2, X } from "lucide-react";
import { useState } from "react";
import { useWatch, type UseFormReturn } from "react-hook-form";
import { RowActionButton } from "@/components/data-table/table-controls";
import { EntityPickerDialog } from "@/components/entity-picker-dialog";
import { LabelWithHint } from "@/components/field-hint";
import { fieldAria, FormField } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SingleLineTextarea } from "@/components/single-line-textarea";
import { formatMoney } from "@/components/money";
import { formatPercentage } from "@/lib/decimal";
import { cn } from "@/lib/utils";
import type { FormValues } from "./purchase-settlement-draft-form";
import { PURCHASE_SETTLEMENTS_KEY, fetchPurchaseProducts } from "./purchase-settlements-api";

export function IssueList({ issues }: { issues: readonly PurchaseSettlementIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {issues.map((issue, index) => (
        <li key={`${issue.code}-${index}`} className="text-danger">
          {issue.message}
        </li>
      ))}
    </ul>
  );
}

type PreviewLine = PurchaseSettlementDraftView["preview"]["lines"][number];

/** Una línea: producto opcional o línea libre, sus textos, cantidad, precio, descuento e IVA. */
export function LineCard({
  form,
  index,
  options,
  previewLine,
  issues,
  canRemove,
  onRemove,
}: {
  form: UseFormReturn<FormValues>;
  index: number;
  options: PurchaseSettlementOptionsView;
  /** Los importes de la vista previa del borrador guardado, si la línea pudo calcularse. */
  previewLine: PreviewLine | undefined;
  issues: readonly PurchaseSettlementIssue[];
  canRemove: boolean;
  onRemove: () => void;
}) {
  const position = index + 1;
  const base = `lines.${index}` as const;
  const line = useWatch({ control: form.control, name: base });
  const errors = form.formState.errors.lines?.[index];
  const [choosing, setChoosing] = useState(false);
  const id = (name: string) => `${name}-${index}`;
  const set = (name: Parameters<typeof form.setValue>[0], value: string) =>
    form.setValue(name, value, { shouldDirty: true });
  /** El producto propone el código y el nombre; el precio es siempre el de esta compra. */
  const chooseProduct = (product: ProductView) => {
    set(`${base}.productId`, product.id);
    set(`${base}.productName`, product.name);
    set(`${base}.mainCode`, product.mainCode ?? "");
    set(`${base}.auxiliaryCode`, product.auxiliaryCode ?? "");
    set(`${base}.description`, product.name);
  };
  const clearProduct = () => {
    set(`${base}.productId`, "");
    set(`${base}.productName`, "");
  };
  const descriptionHint = "Lo que se compra, como figurará en el comprobante, en una sola línea.";
  const descriptionCount = `${(line.description ?? "").length}/${PURCHASE_SETTLEMENT_TEXT_MAX.description}`;
  const unitHint = "Opcional. Por ejemplo: kg, saco, jornal.";
  return (
    <li
      aria-label={`Línea ${position}`}
      aria-invalid={issues.length > 0 || undefined}
      className="flex flex-col gap-2 rounded-md border border-border bg-surface px-3 py-2 aria-invalid:border-danger"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Línea {position}</h3>
        {canRemove && (
          <RowActionButton
            icon={Trash2}
            tone="danger"
            label={`Quitar la línea ${position}`}
            onClick={onRemove}
          />
        )}
      </div>
      <LabelWithHint
        label="Producto"
        hint="El producto solo propone el código y la descripción; el precio es el de esta compra."
      >
        <span className="text-sm font-medium">
          Producto <span className="font-normal text-foreground-muted">(opcional)</span>
        </span>
      </LabelWithHint>
      {/* El producto y «Quitar producto» en tres cuartos y un cuarto; sin producto, la elección
          ocupa toda la fila (decisión del propietario, 2026-10-22). */}
      <div
        className={cn(
          "grid gap-2 text-sm",
          line.productId && "sm:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]",
        )}
      >
        <Button
          variant="outline"
          className="h-auto min-h-10 w-full justify-between text-left font-normal whitespace-normal"
          aria-label={
            line.productId
              ? `Cambiar el producto de la línea ${position}: ${line.productName}`
              : `Elegir un producto para la línea ${position} (opcional)`
          }
          onClick={() => setChoosing(true)}
        >
          <span className="flex min-w-0 items-center gap-2 break-words">
            <PackageSearch aria-hidden="true" className="size-4 shrink-0 text-foreground-muted" />
            {line.productId
              ? `Producto: ${line.productName || "elegido"}`
              : "Elegir producto (opcional)"}
          </span>
          <ChevronDown aria-hidden="true" className="size-4 shrink-0" />
        </Button>
        {line.productId && (
          <Button
            variant="outline"
            className="min-h-10 w-full text-danger hover:bg-danger/10 hover:text-danger"
            aria-label={`Quitar el producto de la línea ${position}`}
            onClick={clearProduct}
          >
            <X aria-hidden="true" />
            Quitar producto
          </Button>
        )}
      </div>
      <EntityPickerDialog<ProductView>
        open={choosing}
        onOpenChange={setChoosing}
        title="Elegir producto"
        description="Productos activos, bienes o servicios. Solo proponen el código y la descripción."
        searchLabel="Buscar por código o nombre"
        searchPlaceholder="Código o nombre"
        queryKey={[...PURCHASE_SETTLEMENTS_KEY, "products"]}
        fetchPage={fetchPurchaseProducts}
        getKey={(product) => product.id}
        getLabel={(product) =>
          product.mainCode ? `${product.name}, código ${product.mainCode}` : product.name
        }
        renderItem={(product) => (
          <span className="flex min-w-0 flex-col">
            <span className="font-medium break-words">{product.name}</span>
            {product.mainCode && (
              <span className="text-sm text-foreground-muted">{product.mainCode}</span>
            )}
          </span>
        )}
        onSelect={chooseProduct}
        emptyTitle="No hay productos que coincidan"
        emptyDescription="Escribe la línea sin producto: la liquidación no necesita uno."
      />
      <div className="grid gap-2 sm:grid-cols-2">
        <FormField id={id("codigo")} label="Código principal" error={errors?.mainCode?.message}>
          <Input
            autoComplete="off"
            {...fieldAria(id("codigo"), errors?.mainCode?.message)}
            {...form.register(`${base}.mainCode`)}
          />
        </FormField>
        <FormField
          id={id("auxiliar")}
          label="Código auxiliar"
          error={errors?.auxiliaryCode?.message}
        >
          <Input
            autoComplete="off"
            {...fieldAria(id("auxiliar"), errors?.auxiliaryCode?.message)}
            {...form.register(`${base}.auxiliaryCode`)}
          />
        </FormField>
      </div>
      <FormField
        id={id("descripcion")}
        label="Descripción"
        hint={descriptionHint}
        counter={descriptionCount}
        error={errors?.description?.message}
      >
        <SingleLineTextarea
          maxLength={PURCHASE_SETTLEMENT_TEXT_MAX.description}
          {...fieldAria(id("descripcion"), errors?.description?.message, descriptionHint)}
          {...form.register(`${base}.description`)}
        />
      </FormField>
      <div className="grid gap-2 sm:grid-cols-3">
        <FormField
          id={id("unidad")}
          label="Unidad de medida"
          hint={unitHint}
          error={errors?.unit?.message}
        >
          <Input
            autoComplete="off"
            {...fieldAria(id("unidad"), errors?.unit?.message, unitHint)}
            {...form.register(`${base}.unit`)}
          />
        </FormField>
        <FormField id={id("cantidad")} label="Cantidad" error={errors?.quantity?.message}>
          <Input
            inputMode="decimal"
            autoComplete="off"
            className="tabular-nums"
            {...fieldAria(id("cantidad"), errors?.quantity?.message)}
            {...form.register(`${base}.quantity`)}
          />
        </FormField>
        <FormField
          id={id("precio")}
          label="Precio unitario (USD)"
          error={errors?.unitPrice?.message}
        >
          <Input
            inputMode="decimal"
            autoComplete="off"
            className="tabular-nums"
            {...fieldAria(id("precio"), errors?.unitPrice?.message)}
            {...form.register(`${base}.unitPrice`)}
          />
        </FormField>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <FormField
          id={id("descuento")}
          label="Descuento (USD)"
          hint="Opcional; sin descuento queda en 0.00."
          error={errors?.discount?.message}
        >
          <Input
            inputMode="decimal"
            autoComplete="off"
            className="tabular-nums"
            {...fieldAria(
              id("descuento"),
              errors?.discount?.message,
              "Opcional; sin descuento queda en 0.00.",
            )}
            {...form.register(`${base}.discount`)}
          />
        </FormField>
        <FormField id={id("iva")} label="IVA">
          <Select
            {...fieldAria(id("iva"), undefined)}
            value={line.ivaRate}
            onChange={(event) => set(`${base}.ivaRate`, event.target.value)}
          >
            <option value="">Elige la tarifa</option>
            {options.ivaRates.map((rate) => (
              <option key={rate.entryKey} value={rate.entryKey}>
                {rate.label}
              </option>
            ))}
          </Select>
        </FormField>
      </div>
      {previewLine?.tax && (
        <p className="text-sm text-foreground-muted tabular-nums">
          Base imponible {formatMoney(previewLine.taxableBase)} · IVA{" "}
          {formatPercentage(previewLine.tax.percentage)} {formatMoney(previewLine.tax.amount)}
        </p>
      )}
      <IssueList issues={issues} />
    </li>
  );
}

/** Un pago: forma de pago, total, plazo y unidad de tiempo, todos escritos por el usuario. */
export function PaymentRow({
  form,
  index,
  options,
  issues,
  canRemove,
  onRemove,
}: {
  form: UseFormReturn<FormValues>;
  index: number;
  options: PurchaseSettlementOptionsView;
  issues: readonly PurchaseSettlementIssue[];
  canRemove: boolean;
  onRemove: () => void;
}) {
  const position = index + 1;
  const base = `payments.${index}` as const;
  const payment = useWatch({ control: form.control, name: base });
  const errors = form.formState.errors.payments?.[index];
  const id = (name: string) => `${name}-pago-${index}`;
  const timeUnitHint = "Por ejemplo: días o meses.";
  return (
    <li
      aria-label={`Pago ${position}`}
      aria-invalid={issues.length > 0 || undefined}
      className="flex flex-col gap-2 rounded-md border border-border bg-surface px-3 py-2 aria-invalid:border-danger"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Pago {position}</h3>
        {canRemove && (
          <RowActionButton
            icon={Trash2}
            tone="danger"
            label={`Quitar el pago ${position}`}
            onClick={onRemove}
          />
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <FormField id={id("forma")} label="Forma de pago">
          <Select
            {...fieldAria(id("forma"), undefined)}
            value={payment.paymentMethod}
            onChange={(event) =>
              form.setValue(`${base}.paymentMethod`, event.target.value, { shouldDirty: true })
            }
          >
            <option value="">Elige la forma de pago</option>
            {options.paymentMethods.map((method) => (
              <option key={method.entryKey} value={method.entryKey}>
                {method.code} · {method.label}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField id={id("total")} label="Total (USD)" error={errors?.total?.message}>
          <Input
            inputMode="decimal"
            autoComplete="off"
            className="tabular-nums"
            {...fieldAria(id("total"), errors?.total?.message)}
            {...form.register(`${base}.total`)}
          />
        </FormField>
        <FormField id={id("plazo")} label="Plazo" error={errors?.term?.message}>
          <Input
            inputMode="decimal"
            autoComplete="off"
            className="tabular-nums"
            {...fieldAria(id("plazo"), errors?.term?.message)}
            {...form.register(`${base}.term`)}
          />
        </FormField>
        <FormField
          id={id("unidad-tiempo")}
          label="Unidad de tiempo"
          hint={timeUnitHint}
          error={errors?.timeUnit?.message}
        >
          <Input
            autoComplete="off"
            {...fieldAria(id("unidad-tiempo"), errors?.timeUnit?.message, timeUnitHint)}
            {...form.register(`${base}.timeUnit`)}
          />
        </FormField>
      </div>
      <IssueList issues={issues} />
    </li>
  );
}
