// Un documento sustento del borrador de retención (add-withholding-receipts, design D24, pasos 4 a 7):
// el tipo, el sustento filtrado por el tipo, el número con su máscara, la fecha y la autorización;
// los totales, los impuestos y los pagos declarados; y las retenciones con el impuesto, el concepto
// de renta (combobox con búsqueda) o el código de IVA, y la base. El porcentaje y el valor retenido
// nunca se editan: son los de la vista previa del servidor del borrador guardado.
"use client";

import type {
  SupportDocumentType,
  SupportTaxCode,
  WithholdingDraftView,
  WithholdingIssue,
  WithholdingOptionsView,
  WithholdingTaxCode,
} from "@facturador/contracts";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import { useId, useRef, useState, type ReactNode } from "react";
import { useFieldArray, useWatch, type UseFormReturn } from "react-hook-form";
import { AddRowButton } from "@/components/add-row-button";
import { RowActionButton } from "@/components/data-table/table-controls";
import { DatePickerField } from "@/components/date-picker-field";
import { EntityPickerDialog, type EntityPickerQuery } from "@/components/entity-picker-dialog";
import { LabelWithHint } from "@/components/field-hint";
import { fieldAria, FormField } from "@/components/form-dialog";
import { formatMoney } from "@/components/money";
import { SegmentedControl } from "@/components/segmented-control";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { formatPercentage } from "@/lib/decimal";
import {
  blankItem,
  blankPayment,
  blankTax,
  ratesOn,
  type FormValues,
} from "./withholding-draft-form";
import { conceptLabel, formatSupportNumber, supportNumberDigits } from "./withholding-format";

/** Nombres cortos del control segmentado; la denominación oficial completa va en el detalle. */
const DOCUMENT_TYPE_SHORT: Record<SupportDocumentType, string> = {
  "01": "Factura",
  "02": "Nota de venta",
  "03": "Liquidación de compra",
};
const ICE: SupportTaxCode = "3";
const IVA_SUPPORT: SupportTaxCode = "2";
const INCOME: WithholdingTaxCode = "1";

export function IssueList({ issues }: { issues: readonly WithholdingIssue[] }) {
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

/**
 * Combobox con búsqueda sobre opciones ya cargadas (conceptos de renta, tarifas de ICE): el selector
 * del proyecto con la búsqueda por código o denominación hecha en el cliente.
 */
function OptionPicker<T extends { entryKey: string; code: string; label: string }>({
  label,
  title,
  options,
  value,
  describe,
  invalid,
  onChange,
}: {
  label: string;
  title: string;
  options: readonly T[];
  value: string;
  describe: (option: T) => string;
  invalid?: boolean;
  onChange: (entryKey: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const labelId = useId();
  const chosen = options.find((option) => option.entryKey === value);
  const fetchPage = ({ search, page, pageSize }: EntityPickerQuery) => {
    const needle = search.toLocaleLowerCase("es");
    const matches = options.filter(
      (option) =>
        option.code.toLocaleLowerCase("es").includes(needle) ||
        option.label.toLocaleLowerCase("es").includes(needle),
    );
    return Promise.resolve({
      items: matches.slice((page - 1) * pageSize, page * pageSize),
      total: matches.length,
    });
  };
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span id={labelId} className="text-sm font-medium">
        {label}
      </span>
      <Button
        variant="outline"
        aria-labelledby={labelId}
        aria-describedby={`${labelId}-value`}
        aria-invalid={invalid || undefined}
        className="h-auto min-h-10 justify-between text-left font-normal whitespace-normal max-md:min-h-11"
        onClick={() => setOpen(true)}
      >
        <span id={`${labelId}-value`} className="min-w-0 break-words">
          {chosen ? describe(chosen) : value ? `Código ${value} (no disponible)` : "Elegir"}
        </span>
        <ChevronDown aria-hidden="true" className="size-4 shrink-0" />
      </Button>
      <EntityPickerDialog<T>
        open={open}
        onOpenChange={setOpen}
        title={title}
        searchLabel="Buscar por código o denominación"
        searchPlaceholder="Código o denominación"
        queryKey={["withholding-option-picker", title, options.length]}
        fetchPage={fetchPage}
        getKey={(option) => option.entryKey}
        getLabel={describe}
        renderItem={(option) => <span className="break-words">{describe(option)}</span>}
        onSelect={(option) => onChange(option.entryKey)}
        emptyTitle="No hay opciones que coincidan"
        emptyDescription="Prueba con otro código o con otra palabra de la denominación."
      />
    </div>
  );
}

function SubList({
  title,
  hint,
  children,
}: {
  title: string;
  /** La nota de la lista, en el tooltip de su título (decisión del propietario, 2026-10-22). */
  hint?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <LabelWithHint label={title} hint={hint}>
        <h4 id={id} className="text-sm font-semibold">
          {title}
        </h4>
      </LabelWithHint>
      {children}
    </section>
  );
}

export function SupportCard({
  form,
  index,
  options,
  preview,
  issues,
  fresh,
  canRemove,
  onRemove,
}: {
  form: UseFormReturn<FormValues>;
  index: number;
  options: WithholdingOptionsView;
  preview: WithholdingDraftView["preview"];
  /** Los problemas de este documento (posición `index + 1`), si la vista previa está al día. */
  issues: readonly WithholdingIssue[];
  fresh: boolean;
  canRemove: boolean;
  onRemove: () => void;
}) {
  const position = index + 1;
  const base = `supports.${index}` as const;
  const { errors } = form.formState;
  const supportErrors = errors.supports?.[index];
  const taxes = useFieldArray({ control: form.control, name: `${base}.taxes` });
  const payments = useFieldArray({ control: form.control, name: `${base}.payments` });
  const items = useFieldArray({ control: form.control, name: `${base}.withholdings` });
  const support = useWatch({ control: form.control, name: base });
  const addTaxRef = useRef<HTMLButtonElement>(null);
  const addPaymentRef = useRef<HTMLButtonElement>(null);
  const addItemRef = useRef<HTMLButtonElement>(null);
  const typeLabelId = useId();
  const set = (name: Parameters<typeof form.setValue>[0], value: string) =>
    form.setValue(name, value, { shouldDirty: true });

  const own = issues.filter(
    (issue) => issue.tax === null && issue.payment === null && issue.withholding === null,
  );
  const taxIssues = (t: number) => issues.filter((issue) => issue.tax === t);
  const paymentIssues = (p: number) => issues.filter((issue) => issue.payment === p);
  const itemIssues = (i: number) => issues.filter((issue) => issue.withholding === i);
  const calculated = (i: number) =>
    preview.supports
      .find((candidate) => candidate.position === position)
      ?.withholdings.find((item) => item.position === i);
  const documentType = options.documentTypes.find((type) => type.code === support.documentType);
  const supportCodes = documentType?.supportCodes ?? [];
  const { limits } = options;

  return (
    <li
      aria-label={`Documento sustento ${position}`}
      aria-invalid={issues.length > 0 || undefined}
      className="flex flex-col gap-3 rounded-md border border-border bg-surface px-3 py-2 aria-invalid:border-danger"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium">Documento sustento {position}</h3>
        {canRemove && (
          <RowActionButton
            icon={Trash2}
            tone="danger"
            label={`Quitar el documento sustento ${position}`}
            onClick={onRemove}
          />
        )}
      </div>

      <div className="flex flex-col gap-1">
        <span id={typeLabelId} className="text-sm font-medium">
          Tipo de documento
        </span>
        <SegmentedControl
          fullWidth
          aria-labelledby={typeLabelId}
          options={options.documentTypes.map((type) => ({
            value: type.code,
            label: DOCUMENT_TYPE_SHORT[type.code],
          }))}
          value={support.documentType || undefined}
          onChange={(next) => {
            set(`${base}.documentType`, next);
            // Un sustento que el tipo nuevo no admite se vuelve a elegir.
            const allowed = options.documentTypes.find((type) => type.code === next)?.supportCodes;
            if (!allowed?.some((code) => code.code === support.supportCode)) {
              set(`${base}.supportCode`, "");
            }
          }}
        />
      </div>
      <FormField
        id={`sustento-${index}`}
        label="Sustento tributario"
        hint={documentType ? undefined : "Elige primero el tipo de documento."}
      >
        <Select
          {...fieldAria(
            `sustento-${index}`,
            undefined,
            documentType ? undefined : "Elige primero el tipo de documento.",
          )}
          disabled={!documentType}
          value={support.supportCode}
          onChange={(event) => set(`${base}.supportCode`, event.target.value)}
        >
          <option value="">Elige el sustento</option>
          {supportCodes.map((code) => (
            <option key={code.code} value={code.code}>
              {code.code} · {code.label}
            </option>
          ))}
          {support.supportCode &&
            !supportCodes.some((code) => code.code === support.supportCode) && (
              <option value={support.supportCode}>
                Sustento {support.supportCode} (no disponible para el tipo)
              </option>
            )}
        </Select>
      </FormField>
      <div className="grid gap-2 sm:grid-cols-2">
        <FormField
          id={`numero-${index}`}
          label="Número"
          hint="Establecimiento, punto y secuencial: 001-001-000000001."
          error={supportErrors?.number?.message}
        >
          <Input
            inputMode="numeric"
            autoComplete="off"
            placeholder="001-001-000000001"
            {...fieldAria(
              `numero-${index}`,
              supportErrors?.number?.message,
              "Establecimiento, punto y secuencial: 001-001-000000001.",
            )}
            name={`${base}.number`}
            value={formatSupportNumber(support.number)}
            onChange={(event) => set(`${base}.number`, supportNumberDigits(event.target.value))}
          />
        </FormField>
        <DatePickerField
          label="Fecha de emisión del documento"
          value={support.issueDate}
          max={options.evaluatedOn}
          onChange={(next) => set(`${base}.issueDate`, next)}
        />
      </div>
      <FormField
        id={`autorizacion-${index}`}
        label="Autorización (opcional)"
        hint="10, 37 o 49 dígitos, si el documento la tiene."
        error={supportErrors?.authorizationNumber?.message}
      >
        <Input
          inputMode="numeric"
          autoComplete="off"
          {...fieldAria(
            `autorizacion-${index}`,
            supportErrors?.authorizationNumber?.message,
            "10, 37 o 49 dígitos, si el documento la tiene.",
          )}
          {...form.register(`${base}.authorizationNumber`)}
        />
      </FormField>
      <div className="grid gap-2 sm:grid-cols-2">
        <FormField
          id={`sin-impuestos-${index}`}
          label="Total sin impuestos"
          error={supportErrors?.totalWithoutTaxes?.message}
        >
          <Input
            inputMode="decimal"
            {...fieldAria(`sin-impuestos-${index}`, supportErrors?.totalWithoutTaxes?.message)}
            {...form.register(`${base}.totalWithoutTaxes`)}
          />
        </FormField>
        <FormField
          id={`importe-total-${index}`}
          label="Importe total"
          error={supportErrors?.importTotal?.message}
        >
          <Input
            inputMode="decimal"
            {...fieldAria(`importe-total-${index}`, supportErrors?.importTotal?.message)}
            {...form.register(`${base}.importTotal`)}
          />
        </FormField>
      </div>

      <SubList
        title="Impuestos del documento"
        hint="Transcribe los impuestos del documento. El código de porcentaje es el vigente en su fecha; el sistema no recalcula la base ni el valor."
      >
        <ol className="flex flex-col gap-2">
          {taxes.fields.map((field, t) => {
            const taxPosition = t + 1;
            const current = support.taxes[t];
            const taxErrors = supportErrors?.taxes?.[t];
            const problems = fresh ? taxIssues(taxPosition) : [];
            const labelId = `impuesto-${field.id}`;
            const rates = current?.tax ? ratesOn(options, current.tax, support.issueDate) : [];
            const chosenRate = rates.find((rate) => rate.entryKey === current?.rateEntryKey);
            return (
              <li
                key={field.id}
                aria-label={`Impuesto ${taxPosition} del documento ${position}`}
                aria-invalid={problems.length > 0 || undefined}
                className="flex flex-col gap-2 rounded-md border border-border px-2 py-2 aria-invalid:border-danger"
              >
                {/* El impuesto a todo el ancho, con IVA elegido en uno nuevo (decisión del
                    propietario, 2026-10-22); quitar, en rojo, a su derecha. */}
                <div className="flex items-end gap-2">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span id={labelId} className="text-sm font-medium">
                      Impuesto
                    </span>
                    <SegmentedControl
                      fullWidth
                      aria-labelledby={labelId}
                      options={options.supportTaxes.map((tax) => ({
                        value: tax.tax,
                        label: tax.label,
                      }))}
                      value={current?.tax || undefined}
                      onChange={(next) => {
                        set(`${base}.taxes.${t}.tax`, next);
                        set(`${base}.taxes.${t}.rateEntryKey`, "");
                        if (next === IVA_SUPPORT) set(`${base}.taxes.${t}.rate`, "");
                      }}
                    />
                  </div>
                  {taxes.fields.length > 1 && (
                    <RowActionButton
                      icon={Trash2}
                      tone="danger"
                      label={`Quitar el impuesto ${taxPosition} del documento ${position}`}
                      onClick={() => {
                        taxes.remove(t);
                        addTaxRef.current?.focus();
                      }}
                    />
                  )}
                </div>
                {current?.tax === ICE ? (
                  <OptionPicker
                    label="Código de porcentaje"
                    title="Elegir el código de ICE"
                    options={rates}
                    value={current.rateEntryKey}
                    describe={(rate) => `${rate.code} · ${rate.label}`}
                    onChange={(next) => set(`${base}.taxes.${t}.rateEntryKey`, next)}
                  />
                ) : (
                  <FormField id={`tarifa-${field.id}`} label="Código de porcentaje">
                    <Select
                      {...fieldAria(`tarifa-${field.id}`, undefined)}
                      disabled={!current?.tax}
                      value={current?.rateEntryKey ?? ""}
                      onChange={(event) =>
                        set(`${base}.taxes.${t}.rateEntryKey`, event.target.value)
                      }
                    >
                      <option value="">
                        {current?.tax ? "Elige el código" : "Elige primero el impuesto"}
                      </option>
                      {rates.map((rate) => (
                        <option key={rate.entryKey} value={rate.entryKey}>
                          {rate.code} · {rate.label}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                )}
                <div className="grid gap-2 sm:grid-cols-3">
                  {current?.tax && current.tax !== IVA_SUPPORT ? (
                    <FormField
                      id={`tarifa-declarada-${field.id}`}
                      label="Tarifa"
                      hint="La del documento."
                      error={taxErrors?.rate?.message}
                    >
                      <Input
                        inputMode="decimal"
                        {...fieldAria(
                          `tarifa-declarada-${field.id}`,
                          taxErrors?.rate?.message,
                          "La del documento.",
                        )}
                        {...form.register(`${base}.taxes.${t}.rate`)}
                      />
                    </FormField>
                  ) : (
                    <div className="flex flex-col gap-1 text-sm">
                      <span className="font-medium">Tarifa</span>
                      <span className="flex min-h-8 items-center text-foreground-muted tabular-nums">
                        {chosenRate?.percentage
                          ? `${formatPercentage(chosenRate.percentage)} (catálogo)`
                          : "Del catálogo"}
                      </span>
                    </div>
                  )}
                  <FormField
                    id={`base-impuesto-${field.id}`}
                    label="Base imponible"
                    error={taxErrors?.base?.message}
                  >
                    <Input
                      inputMode="decimal"
                      {...fieldAria(`base-impuesto-${field.id}`, taxErrors?.base?.message)}
                      {...form.register(`${base}.taxes.${t}.base`)}
                    />
                  </FormField>
                  <FormField
                    id={`valor-impuesto-${field.id}`}
                    label="Valor"
                    error={taxErrors?.amount?.message}
                  >
                    <Input
                      inputMode="decimal"
                      {...fieldAria(`valor-impuesto-${field.id}`, taxErrors?.amount?.message)}
                      {...form.register(`${base}.taxes.${t}.amount`)}
                    />
                  </FormField>
                </div>
                <IssueList issues={problems} />
              </li>
            );
          })}
        </ol>
        <AddRowButton
          ref={addTaxRef}
          disabled={taxes.fields.length >= limits.taxesPerSupport}
          onClick={() =>
            taxes.append(blankTax(), {
              focusName: `${base}.taxes.${taxes.fields.length}.base`,
            })
          }
        >
          <Plus aria-hidden="true" data-icon="inline-start" />
          Agregar impuesto
        </AddRowButton>
      </SubList>

      <SubList title="Formas de pago">
        <ol className="flex flex-col gap-2">
          {payments.fields.map((field, p) => {
            const paymentPosition = p + 1;
            const current = support.payments[p];
            const problems = fresh ? paymentIssues(paymentPosition) : [];
            const methods = options.paymentMethods;
            return (
              <li
                key={field.id}
                aria-label={`Forma de pago ${paymentPosition} del documento ${position}`}
                aria-invalid={problems.length > 0 || undefined}
                className="flex flex-col gap-2 rounded-md border border-border px-2 py-2 aria-invalid:border-danger"
              >
                <div className="grid items-end gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_auto]">
                  <FormField id={`pago-${field.id}`} label="Forma de pago">
                    <Select
                      {...fieldAria(`pago-${field.id}`, undefined)}
                      value={current?.paymentMethod ?? ""}
                      onChange={(event) =>
                        set(`${base}.payments.${p}.paymentMethod`, event.target.value)
                      }
                    >
                      <option value="">Elige la forma de pago</option>
                      {methods.map((method) => (
                        <option key={method.entryKey} value={method.entryKey}>
                          {method.label} ({method.code})
                        </option>
                      ))}
                      {current?.paymentMethod &&
                        !methods.some((method) => method.entryKey === current.paymentMethod) && (
                          <option value={current.paymentMethod}>
                            Forma de pago {current.paymentMethod} (no disponible)
                          </option>
                        )}
                    </Select>
                  </FormField>
                  <FormField
                    id={`total-pago-${field.id}`}
                    label="Total"
                    error={supportErrors?.payments?.[p]?.total?.message}
                  >
                    <Input
                      inputMode="decimal"
                      {...fieldAria(
                        `total-pago-${field.id}`,
                        supportErrors?.payments?.[p]?.total?.message,
                      )}
                      {...form.register(`${base}.payments.${p}.total`)}
                    />
                  </FormField>
                  {payments.fields.length > 1 && (
                    <RowActionButton
                      icon={Trash2}
                      tone="danger"
                      label={`Quitar la forma de pago ${paymentPosition} del documento ${position}`}
                      onClick={() => {
                        payments.remove(p);
                        addPaymentRef.current?.focus();
                      }}
                    />
                  )}
                </div>
                <IssueList issues={problems} />
              </li>
            );
          })}
        </ol>
        <AddRowButton
          ref={addPaymentRef}
          disabled={payments.fields.length >= limits.paymentsPerSupport}
          onClick={() =>
            payments.append(blankPayment(), {
              focusName: `${base}.payments.${payments.fields.length}.total`,
            })
          }
        >
          <Plus aria-hidden="true" data-icon="inline-start" />
          Agregar forma de pago
        </AddRowButton>
      </SubList>

      <SubList title="Retenciones">
        <ol className="flex flex-col gap-2">
          {items.fields.map((field, i) => {
            const itemPosition = i + 1;
            const current = support.withholdings[i];
            const itemErrors = supportErrors?.withholdings?.[i];
            const problems = fresh ? itemIssues(itemPosition) : [];
            const labelId = `retencion-${field.id}`;
            const result = fresh ? calculated(itemPosition) : undefined;
            const ivaCode = options.ivaCodes.find((code) => code.entryKey === current?.entryKey);
            return (
              <li
                key={field.id}
                aria-label={`Retención ${itemPosition} del documento ${position}`}
                aria-invalid={problems.length > 0 || undefined}
                className="flex flex-col gap-2 rounded-md border border-border px-2 py-2 aria-invalid:border-danger"
              >
                {/* El impuesto a retener a todo el ancho, con Renta elegida en una nueva (decisión
                    del propietario, 2026-10-22). */}
                <div className="flex items-end gap-2">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span id={labelId} className="text-sm font-medium">
                      Impuesto a retener
                    </span>
                    <SegmentedControl
                      fullWidth
                      aria-labelledby={labelId}
                      options={options.withholdingTaxes.map((tax) => ({
                        value: tax.code,
                        label: tax.code === INCOME ? "Renta" : "IVA",
                      }))}
                      value={current?.tax || undefined}
                      onChange={(next) => {
                        set(`${base}.withholdings.${i}.tax`, next);
                        set(`${base}.withholdings.${i}.entryKey`, "");
                      }}
                    />
                  </div>
                  {items.fields.length > 1 && (
                    <RowActionButton
                      icon={Trash2}
                      tone="danger"
                      label={`Quitar la retención ${itemPosition} del documento ${position}`}
                      onClick={() => {
                        items.remove(i);
                        addItemRef.current?.focus();
                      }}
                    />
                  )}
                </div>
                {/* El concepto (o el código del IVA) y la base en una fila, mitad y mitad (decisión
                    del propietario, 2026-10-22); el cálculo del servidor, debajo. */}
                <div className="grid items-start gap-2 sm:grid-cols-2">
                  {current?.tax === INCOME ? (
                    <OptionPicker
                      label="Concepto de renta"
                      title="Elegir el concepto de renta"
                      options={options.incomeConcepts}
                      value={current.entryKey}
                      describe={conceptLabel}
                      invalid={problems.length > 0}
                      onChange={(next) => set(`${base}.withholdings.${i}.entryKey`, next)}
                    />
                  ) : (
                    <FormField
                      id={`codigo-iva-${field.id}`}
                      label="Código de retención del IVA"
                      hint={ivaCode?.percentage === "0" ? ivaCode.sourceRef : undefined}
                    >
                      <Select
                        {...fieldAria(
                          `codigo-iva-${field.id}`,
                          undefined,
                          ivaCode?.percentage === "0" ? ivaCode.sourceRef : undefined,
                        )}
                        disabled={!current?.tax}
                        value={current?.entryKey ?? ""}
                        onChange={(event) =>
                          set(`${base}.withholdings.${i}.entryKey`, event.target.value)
                        }
                      >
                        <option value="">
                          {current?.tax ? "Elige el código" : "Elige primero el impuesto"}
                        </option>
                        {options.ivaCodes.map((code) => (
                          <option key={code.entryKey} value={code.entryKey}>
                            {code.code} · {code.label}
                          </option>
                        ))}
                        {current?.tax &&
                          current.entryKey &&
                          !options.ivaCodes.some((code) => code.entryKey === current.entryKey) && (
                            <option value={current.entryKey}>
                              Código {current.entryKey} (no disponible)
                            </option>
                          )}
                      </Select>
                    </FormField>
                  )}
                  <FormField
                    id={`base-retencion-${field.id}`}
                    label="Base imponible"
                    error={itemErrors?.base?.message}
                  >
                    <Input
                      inputMode="decimal"
                      {...fieldAria(`base-retencion-${field.id}`, itemErrors?.base?.message)}
                      {...form.register(`${base}.withholdings.${i}.base`)}
                    />
                  </FormField>
                </div>
                <p
                  aria-label={`Cálculo de la retención ${itemPosition} del documento ${position}`}
                  className="flex min-h-8 items-center text-sm tabular-nums"
                >
                  {result
                    ? `${formatPercentage(result.percentage)} · valor retenido ${formatMoney(result.amount)}`
                    : fresh
                      ? "El porcentaje y el valor aparecen cuando la retención se puede calcular."
                      : "Guarda el borrador para ver el porcentaje y el valor."}
                </p>
                <IssueList issues={problems} />
              </li>
            );
          })}
        </ol>
        <AddRowButton
          ref={addItemRef}
          disabled={items.fields.length >= limits.itemsPerSupport}
          onClick={() =>
            items.append(blankItem(), {
              focusName: `${base}.withholdings.${items.fields.length}.base`,
            })
          }
        >
          <Plus aria-hidden="true" data-icon="inline-start" />
          Agregar retención
        </AddRowButton>
      </SubList>
      <IssueList issues={fresh ? own : []} />
    </li>
  );
}
