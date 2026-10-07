// Un destinatario del borrador de guía (add-shipping-guides, design D25, pasos 3 a 5): la clase
// (tercero o establecimiento propio de destino, que excluye el origen), sus textos, su sustento
// (factura, con la carga de mercancías como sugerencia no autoritativa, o la excepción con su texto
// oficial; el establecimiento propio fija el traslado entre establecimientos) y su detalle (producto
// o línea libre, la descripción con su rótulo, ayuda, contador y vista previa, y la cantidad). Los
// datos derivados se muestran de solo lectura y nunca se envían.
"use client";

import {
  SHIPPING_EXCEPTION_POLICY,
  type PartyView,
  type ProductView,
  type ShippingEligibleInvoiceView,
  type ShippingExceptionCase,
  type ShippingGuideDraftView,
  type ShippingGuideIssue,
  type ShippingGuideOptionsView,
  type ShippingInvoiceGoodsView,
  type ShippingRecipientPartyView,
} from "@facturador/contracts";
import { ChevronDown, PackageOpen, Plus, Trash2, UserRound } from "lucide-react";
import { useId, useRef, useState, type ReactNode } from "react";
import { useFieldArray, useWatch, type UseFormReturn } from "react-hook-form";
import { RowActionButton } from "@/components/data-table/table-controls";
import { EntityPickerDialog } from "@/components/entity-picker-dialog";
import { fieldAria, FormField } from "@/components/form-dialog";
import { SegmentedControl } from "@/components/segmented-control";
import { SelectionCardGroup } from "@/components/selection-card-group";
import { ErrorState, Skeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { formatDecimal } from "@/lib/decimal";
import { formatIssueDate } from "@/features/invoices/invoice-format";
import { PartyDialog } from "@/features/parties/party-dialog";
import {
  CODE_MAX,
  DESCRIPTION_MAX,
  blankDetail,
  type DetailValues,
  type FormValues,
} from "./shipping-guide-draft-form";
import {
  SHIPPING_GUIDES_KEY,
  fetchShippingEligibleInvoices,
  fetchShippingGoods,
  fetchShippingRecipients,
  useInvoiceGoods,
} from "./shipping-guides-api";

/** Un destinatario creado desde la guía nace sin roles: la guía nunca los asigna (design D7). */
const NO_ROLES = [] as const;

export function IssueList({ issues }: { issues: readonly ShippingGuideIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className="flex flex-col gap-0.5 text-sm">
      {issues.map((issue, index) => (
        <li key={`${issue.code}-${index}`} className="text-danger">
          {issue.message}
        </li>
      ))}
    </ul>
  );
}

function SubList({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-1">
      <h4 id={id} className="text-sm font-semibold">
        {title}
      </h4>
      {children}
    </section>
  );
}

/** Dato derivado, de solo lectura: lo pone el servidor y no se envía. */
function ReadOnly({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span id={id} className="text-sm font-medium">
        {label}
      </span>
      <p
        aria-labelledby={id}
        className="min-h-4 rounded-md border border-border bg-surface-subtle px-1 py-0.5 text-sm break-words"
      >
        {value || "—"}
      </p>
      {hint && <p className="text-xs text-foreground-muted">{hint}</p>}
    </div>
  );
}

function PartyCard({ name, identification }: { name: string; identification: string }) {
  return (
    <div className="flex min-w-0 items-center gap-1 rounded-md border border-border bg-surface px-1.5 py-1">
      <UserRound aria-hidden="true" className="size-2 shrink-0 text-foreground-muted" />
      <span className="flex min-w-0 flex-col">
        <span className="font-medium break-words">{name}</span>
        <span className="text-sm text-foreground-muted tabular-nums">{identification}</span>
      </span>
    </div>
  );
}

/**
 * Las líneas de la factura como sugerencia no autoritativa (design D9): las `PRODUCT` marcadas, las
 * `FREE_LINE` sin marcar para agregarse como línea libre con sus datos históricos. El usuario
 * confirma las mercancías reales; nada se agrega sin su confirmación.
 */
function GoodsDialog({
  invoiceId,
  open,
  onOpenChange,
  onAdd,
}: {
  invoiceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (details: DetailValues[]) => void;
}) {
  const goods = useInvoiceGoods(open ? invoiceId : null);
  // Lo que el usuario cambió; sin cambios, la sugerencia: `PRODUCT` marcada, `FREE_LINE` sin marcar.
  const [changed, setChanged] = useState<Record<number, boolean>>({});
  const lines = goods.data?.lines ?? [];
  const isChecked = (line: ShippingInvoiceGoodsView["lines"][number]) =>
    changed[line.position] ?? line.suggestion === "PRODUCT";
  const close = (next: boolean) => {
    if (!next) setChanged({});
    onOpenChange(next);
  };
  const toDetail = (line: ShippingInvoiceGoodsView["lines"][number]): DetailValues =>
    line.suggestion === "PRODUCT" && line.productId
      ? {
          ...blankDetail(),
          mode: "PRODUCT",
          productId: line.productId,
          productName: line.description,
          productMainCode: line.mainCode ?? "",
          productAuxiliaryCode: line.auxiliaryCode ?? "",
          description: line.description,
          quantity: line.quantity,
        }
      : {
          ...blankDetail(),
          mode: "FREE",
          mainCode: line.mainCode ?? "",
          auxiliaryCode: line.auxiliaryCode ?? "",
          description: line.description,
          quantity: line.quantity,
        };
  const selected = lines.filter(isChecked);
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-xl">
        <div className="flex flex-col gap-1.5 p-3">
          <DialogTitle className="text-lg font-semibold">
            Cargar mercancías de la factura
          </DialogTitle>
          <DialogDescription className="text-sm text-foreground-muted">
            Es una sugerencia: confirma las mercancías que realmente se trasladan y edítalas después
            si hace falta. Las líneas que ya no son un bien activo del catálogo se ofrecen sin
            marcar, para agregarse como línea libre con los datos de la factura.
          </DialogDescription>
          {goods.isPending ? (
            <Skeleton className="h-16 w-full" />
          ) : goods.isError ? (
            <ErrorState
              message="No pudimos cargar las líneas de la factura."
              onRetry={() => void goods.refetch()}
            />
          ) : (
            <ul className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
              {lines.map((line) => {
                const free = line.suggestion === "FREE_LINE";
                return (
                  <li key={line.position}>
                    <label className="flex min-h-5.5 items-start gap-1 rounded-md border border-border px-1 py-0.5 text-sm">
                      <input
                        type="checkbox"
                        className="mt-0.5 size-2.5 shrink-0 accent-primary"
                        checked={isChecked(line)}
                        onChange={(event) =>
                          setChanged((current) => ({
                            ...current,
                            [line.position]: event.target.checked,
                          }))
                        }
                      />
                      <span className="flex min-w-0 flex-col">
                        <span className="break-words">
                          {free ? "Agregar como línea libre: " : ""}
                          {line.description}
                        </span>
                        <span className="text-xs text-foreground-muted tabular-nums">
                          Cantidad facturada {formatDecimal(line.quantity)}
                          {line.mainCode ? ` · Código ${line.mainCode}` : ""}
                          {line.auxiliaryCode ? ` · Auxiliar ${line.auxiliaryCode}` : ""}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="flex flex-wrap justify-end gap-1">
            <Button variant="outline" onClick={() => close(false)}>
              Cancelar
            </Button>
            <Button
              disabled={selected.length === 0}
              onClick={() => {
                onAdd(selected.map(toDetail));
                close(false);
              }}
            >
              Agregar {selected.length === 1 ? "1 mercancía" : `${selected.length} mercancías`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Un detalle: producto (bienes activos) o línea libre, descripción y cantidad. */
function DetailRow({
  form,
  recipientIndex,
  index,
  issues,
  previewDetail,
  canRemove,
  onRemove,
}: {
  form: UseFormReturn<FormValues>;
  recipientIndex: number;
  index: number;
  issues: readonly ShippingGuideIssue[];
  /** El detalle de la vista previa: los códigos del producto que resolvió el servidor. */
  previewDetail: { mainCode: string | null; auxiliaryCode: string | null } | undefined;
  canRemove: boolean;
  onRemove: () => void;
}) {
  const position = index + 1;
  const base = `recipients.${recipientIndex}.details.${index}` as const;
  const detail = useWatch({ control: form.control, name: base });
  const errors = form.formState.errors.recipients?.[recipientIndex]?.details?.[index];
  const [choosing, setChoosing] = useState(false);
  const modeLabelId = useId();
  const id = (name: string) => `${name}-${recipientIndex}-${index}`;
  const set = (name: Parameters<typeof form.setValue>[0], value: string) =>
    form.setValue(name, value, { shouldDirty: true });
  const description = detail.description;
  const descriptionHint = "Por ejemplo: 10 cajas de 12 botellas de 1 litro.";
  const chooseProduct = (product: ProductView) => {
    set(`${base}.productId`, product.id);
    set(`${base}.productName`, product.name);
    set(`${base}.productMainCode`, product.mainCode ?? "");
    set(`${base}.productAuxiliaryCode`, product.auxiliaryCode ?? "");
    // La descripción se propone con el nombre del producto; el usuario la completa.
    if (!detail.description.trim()) set(`${base}.description`, product.name);
  };
  const mainCode = previewDetail?.mainCode ?? detail.productMainCode;
  const auxiliaryCode = previewDetail?.auxiliaryCode ?? detail.productAuxiliaryCode;
  return (
    <li
      aria-label={`Detalle ${position} del destinatario ${recipientIndex + 1}`}
      aria-invalid={issues.length > 0 || undefined}
      className="flex flex-col gap-1 rounded-md border border-border px-1 py-1 aria-invalid:border-danger"
    >
      <div className="flex flex-wrap items-end justify-between gap-1">
        <div className="flex flex-col gap-0.5">
          <span id={modeLabelId} className="text-sm font-medium">
            Detalle {position}
          </span>
          <SegmentedControl
            aria-labelledby={modeLabelId}
            options={[
              { value: "PRODUCT", label: "Producto" },
              { value: "FREE", label: "Línea libre" },
            ]}
            value={detail.mode}
            onChange={(next) => {
              set(`${base}.mode`, next);
              if (next === "FREE") {
                set(`${base}.productId`, "");
                set(`${base}.productName`, "");
                set(`${base}.productMainCode`, "");
                set(`${base}.productAuxiliaryCode`, "");
              } else {
                set(`${base}.mainCode`, "");
                set(`${base}.auxiliaryCode`, "");
              }
            }}
          />
        </div>
        {canRemove && (
          <RowActionButton
            icon={Trash2}
            label={`Quitar el detalle ${position} del destinatario ${recipientIndex + 1}`}
            onClick={onRemove}
          />
        )}
      </div>
      {detail.mode === "PRODUCT" ? (
        <div className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_8rem_8rem]">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm font-medium">Producto</span>
            <Button
              variant="outline"
              className="h-auto min-h-4 justify-between text-left font-normal whitespace-normal"
              aria-label={
                detail.productId
                  ? `Cambiar el producto del detalle ${position}: ${detail.productName}`
                  : `Elegir el producto del detalle ${position}`
              }
              onClick={() => setChoosing(true)}
            >
              <span className="min-w-0 break-words">
                {detail.productId ? detail.productName || "Producto elegido" : "Elegir producto"}
              </span>
              <ChevronDown aria-hidden="true" className="size-2 shrink-0" />
            </Button>
          </div>
          <ReadOnly label="Código principal" value={mainCode} />
          <ReadOnly label="Código auxiliar" value={auxiliaryCode} />
          <EntityPickerDialog<ProductView>
            open={choosing}
            onOpenChange={setChoosing}
            title="Elegir producto"
            description="Bienes activos del catálogo: un servicio no se traslada."
            searchLabel="Buscar por código o nombre"
            searchPlaceholder="Código o nombre"
            queryKey={[...SHIPPING_GUIDES_KEY, "goods"]}
            fetchPage={fetchShippingGoods}
            getKey={(product) => product.id}
            getLabel={(product) =>
              product.mainCode ? `${product.name}, ${product.mainCode}` : product.name
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
            emptyTitle="No hay bienes que coincidan"
            emptyDescription="Registra el producto como bien en Productos, o usa una línea libre."
          />
        </div>
      ) : (
        <div className="grid gap-1 sm:grid-cols-2">
          <FormField
            id={id("codigo")}
            label="Código principal (opcional)"
            error={errors?.mainCode?.message}
          >
            <Input
              maxLength={CODE_MAX}
              {...fieldAria(id("codigo"), errors?.mainCode?.message)}
              {...form.register(`${base}.mainCode`)}
            />
          </FormField>
          <FormField
            id={id("auxiliar")}
            label="Código auxiliar (opcional)"
            error={errors?.auxiliaryCode?.message}
          >
            <Input
              maxLength={CODE_MAX}
              {...fieldAria(id("auxiliar"), errors?.auxiliaryCode?.message)}
              {...form.register(`${base}.auxiliaryCode`)}
            />
          </FormField>
        </div>
      )}
      <div className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <FormField
          id={id("descripcion")}
          label="Descripción (incluye unidad y características)"
          hint={descriptionHint}
          error={errors?.description?.message}
        >
          <Input
            maxLength={DESCRIPTION_MAX}
            {...fieldAria(id("descripcion"), errors?.description?.message, descriptionHint)}
            {...form.register(`${base}.description`)}
          />
        </FormField>
        <FormField id={id("cantidad")} label="Cantidad" error={errors?.quantity?.message}>
          <Input
            inputMode="decimal"
            autoComplete="off"
            {...fieldAria(id("cantidad"), errors?.quantity?.message)}
            {...form.register(`${base}.quantity`)}
          />
        </FormField>
      </div>
      <p className="flex flex-wrap justify-between gap-1 text-xs text-foreground-muted">
        <span className="min-w-0 break-words">
          {description.trim()
            ? `En el XML y el RIDE: «${description.trim()}»`
            : "La descripción identifica lo que se traslada, con su unidad."}
        </span>
        <span aria-live="polite" className="tabular-nums">
          {description.length}/{DESCRIPTION_MAX}
        </span>
      </p>
      <IssueList issues={issues} />
    </li>
  );
}

export function RecipientCard({
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
  options: ShippingGuideOptionsView;
  preview: ShippingGuideDraftView["preview"];
  /** Los problemas de este destinatario (posición `index + 1`), si la vista previa está al día. */
  issues: readonly ShippingGuideIssue[];
  fresh: boolean;
  canRemove: boolean;
  onRemove: () => void;
}) {
  const position = index + 1;
  const base = `recipients.${index}` as const;
  const recipient = useWatch({ control: form.control, name: base });
  const originId = useWatch({ control: form.control, name: "originEstablishmentId" });
  const departureMode = useWatch({ control: form.control, name: "departureMode" });
  const errors = form.formState.errors.recipients?.[index];
  const details = useFieldArray({ control: form.control, name: `${base}.details` });
  const addDetailRef = useRef<HTMLButtonElement>(null);
  const [choosingParty, setChoosingParty] = useState(false);
  const [creatingParty, setCreatingParty] = useState(false);
  const [choosingInvoice, setChoosingInvoice] = useState(false);
  const [loadingGoods, setLoadingGoods] = useState(false);
  const kindLabelId = useId();
  const supportLabelId = useId();
  const caseLabelId = useId();
  const id = (name: string) => `${name}-${index}`;
  const set = (name: Parameters<typeof form.setValue>[0], value: string) =>
    form.setValue(name, value, { shouldDirty: true });

  const own = issues.filter((issue) => issue.detail === null);
  const detailIssues = (d: number) => issues.filter((issue) => issue.detail === d);
  const previewRecipient = preview.recipients.find((item) => item.position === position);
  const origin = departureMode === "ESTABLISHMENT" ? originId : "";
  const destinations = options.establishments.filter(
    (establishment) => establishment.id !== origin,
  );
  const destination = options.establishments.find(
    (establishment) => establishment.id === recipient.destinationEstablishmentId,
  );
  const partyCases = SHIPPING_EXCEPTION_POLICY;
  const caseOptions = options.exceptionPolicy.cases
    .filter((item) => item.recipientKind === "PARTY")
    .map((item) => ({
      value: item.case,
      label: item.label,
      description: `Literal ${item.literal}: ${item.statement}`,
    }));
  const ownCase = partyCases.OWN_ESTABLISHMENT_TRANSFER;
  const { limits } = options;

  const chooseParty = (
    party: Pick<ShippingRecipientPartyView, "id" | "legalName" | "identification" | "address">,
  ) => {
    set(`${base}.partyId`, party.id);
    set(`${base}.partyName`, party.legalName);
    set(`${base}.partyIdentification`, party.identification);
    // La dirección se propone con la del tercero y se puede corregir.
    if (!recipient.address.trim() && party.address) set(`${base}.address`, party.address);
  };
  const chooseInvoice = (invoice: ShippingEligibleInvoiceView) => {
    set(`${base}.invoiceId`, invoice.id);
    set(`${base}.invoiceNumber`, invoice.documentNumber);
  };
  const addDetails = (added: DetailValues[]) => {
    // Un detalle vacío se reemplaza por las mercancías confirmadas.
    const empty = recipient.details.findIndex(
      (detail) => !detail.productId && !detail.description.trim() && !detail.quantity.trim(),
    );
    if (empty >= 0 && recipient.details.length === 1) details.remove(empty);
    details.append(added);
  };

  return (
    <li
      aria-label={`Destinatario ${position}`}
      aria-invalid={issues.length > 0 || undefined}
      className="flex flex-col gap-1.5 rounded-md border border-border bg-surface px-1.5 py-1 aria-invalid:border-danger"
    >
      <div className="flex items-center justify-between gap-1">
        <h3 className="font-medium">Destinatario {position}</h3>
        {canRemove && (
          <RowActionButton
            icon={Trash2}
            label={`Quitar el destinatario ${position}`}
            onClick={onRemove}
          />
        )}
      </div>

      <div className="flex flex-col gap-0.5">
        <span id={kindLabelId} className="text-sm font-medium">
          Destinatario
        </span>
        <SegmentedControl
          aria-labelledby={kindLabelId}
          options={[
            { value: "PARTY", label: "Tercero" },
            { value: "OWN_COMPANY", label: "Establecimiento propio" },
          ]}
          value={recipient.kind || undefined}
          onChange={(next) => {
            set(`${base}.kind`, next);
            if (next === "OWN_COMPANY") {
              set(`${base}.supportKind`, "DECLARED_EXCEPTION");
              set(`${base}.exceptionCase`, "OWN_ESTABLISHMENT_TRANSFER");
            } else if (recipient.exceptionCase === "OWN_ESTABLISHMENT_TRANSFER") {
              set(`${base}.supportKind`, "");
              set(`${base}.exceptionCase`, "");
            }
          }}
        />
      </div>

      {recipient.kind === "PARTY" && (
        <>
          {recipient.partyId ? (
            <PartyCard name={recipient.partyName} identification={recipient.partyIdentification} />
          ) : (
            <p className="text-sm text-foreground-muted">
              Elige el tercero que recibe la mercadería: RUC, cédula o pasaporte, con cualquier rol.
            </p>
          )}
          <Button variant="outline" className="self-start" onClick={() => setChoosingParty(true)}>
            {recipient.partyId ? "Cambiar destinatario" : "Elegir destinatario"}
          </Button>
          <EntityPickerDialog<ShippingRecipientPartyView>
            open={choosingParty}
            onOpenChange={setChoosingParty}
            title="Elegir destinatario"
            description="Terceros activos con RUC, cédula o pasaporte, con cualquier rol."
            searchLabel="Buscar por identificación o razón social"
            searchPlaceholder="Identificación o razón social"
            queryKey={[...SHIPPING_GUIDES_KEY, "recipients"]}
            fetchPage={fetchShippingRecipients}
            getKey={(party) => party.id}
            getLabel={(party) => `${party.legalName}, ${party.identification}`}
            renderItem={(party) => (
              <span className="flex min-w-0 flex-col">
                <span className="font-medium break-words">{party.legalName}</span>
                <span className="text-sm text-foreground-muted tabular-nums">
                  {party.identification}
                </span>
              </span>
            )}
            onSelect={chooseParty}
            quickOption={{
              label: "Nuevo destinatario",
              description: "Registrar un tercero sin roles.",
              onSelect: () => setCreatingParty(true),
            }}
            emptyTitle="No hay terceros que coincidan"
            emptyDescription="Registra el destinatario con RUC, cédula o pasaporte."
          />
          <PartyDialog
            open={creatingParty}
            party={null}
            initialRoles={NO_ROLES}
            onClose={() => setCreatingParty(false)}
            onShowExisting={() => {
              setCreatingParty(false);
              setChoosingParty(true);
            }}
            onSaved={(party: PartyView) => chooseParty(party)}
          />
          <FormField
            id={id("direccion")}
            label="Dirección de destino (punto de llegada)"
            error={errors?.address?.message}
          >
            <Input
              {...fieldAria(id("direccion"), errors?.address?.message)}
              {...form.register(`${base}.address`)}
            />
          </FormField>
        </>
      )}

      {recipient.kind === "OWN_COMPANY" && (
        <>
          <FormField
            id={id("destino")}
            label="Establecimiento de destino"
            hint={
              origin
                ? "Otro establecimiento de la empresa: no puede ser el de origen."
                : "Elige primero el establecimiento de origen en la partida."
            }
          >
            <Select
              {...fieldAria(
                id("destino"),
                undefined,
                origin
                  ? "Otro establecimiento de la empresa: no puede ser el de origen."
                  : "Elige primero el establecimiento de origen en la partida.",
              )}
              disabled={!origin}
              value={recipient.destinationEstablishmentId}
              onChange={(event) => set(`${base}.destinationEstablishmentId`, event.target.value)}
            >
              <option value="">Elige el establecimiento</option>
              {destinations.map((establishment) => (
                <option key={establishment.id} value={establishment.id}>
                  {establishment.code} · {establishment.address}
                </option>
              ))}
            </Select>
          </FormField>
          <div className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_10rem]">
            <ReadOnly
              label="Dirección de destino"
              value={destination?.address ?? ""}
              hint="La del establecimiento de destino."
            />
            <ReadOnly label="Código del establecimiento" value={destination?.code ?? ""} />
          </div>
        </>
      )}

      {recipient.kind !== "" && (
        <>
          <div className="grid gap-1 sm:grid-cols-2">
            <FormField
              id={id("motivo")}
              label="Motivo del traslado"
              error={errors?.motive?.message}
            >
              <Input
                {...fieldAria(id("motivo"), errors?.motive?.message)}
                {...form.register(`${base}.motive`)}
              />
            </FormField>
            <FormField id={id("ruta")} label="Ruta (opcional)" error={errors?.route?.message}>
              <Input
                {...fieldAria(id("ruta"), errors?.route?.message)}
                {...form.register(`${base}.route`)}
              />
            </FormField>
          </div>
          {recipient.kind === "PARTY" && (
            <FormField
              id={id("codigo-destino")}
              label="Código del establecimiento de destino (opcional)"
              hint="Tres dígitos, si el destinatario te lo indicó."
              error={errors?.destinationEstablishmentCode?.message}
            >
              <Input
                inputMode="numeric"
                maxLength={3}
                className="max-w-32"
                {...fieldAria(
                  id("codigo-destino"),
                  errors?.destinationEstablishmentCode?.message,
                  "Tres dígitos, si el destinatario te lo indicó.",
                )}
                {...form.register(`${base}.destinationEstablishmentCode`)}
              />
            </FormField>
          )}

          <SubList title="Sustento">
            {recipient.kind === "OWN_COMPANY" ? (
              <p className="rounded-md border border-border bg-surface-subtle px-1 py-0.5 text-sm">
                Sin factura: {ownCase.statement} (art. 30, numeral 8, literal {ownCase.literal}).
              </p>
            ) : (
              <>
                <div className="flex flex-col gap-0.5">
                  <span id={supportLabelId} className="text-sm font-medium">
                    Comprobante de venta
                  </span>
                  <SegmentedControl
                    aria-labelledby={supportLabelId}
                    options={[
                      { value: "INTERNAL_INVOICE", label: "Factura" },
                      { value: "DECLARED_EXCEPTION", label: "Sin factura" },
                    ]}
                    value={recipient.supportKind || undefined}
                    onChange={(next) => set(`${base}.supportKind`, next)}
                  />
                </div>
                {recipient.supportKind === "INTERNAL_INVOICE" && (
                  <>
                    {recipient.invoiceId ? (
                      <p className="text-sm">
                        Factura{" "}
                        <span className="font-medium tabular-nums">
                          {recipient.invoiceNumber || "elegida"}
                        </span>
                      </p>
                    ) : (
                      <p className="text-sm text-foreground-muted">
                        Una factura autorizada de la empresa, también a consumidor final.
                      </p>
                    )}
                    <div className="flex flex-wrap gap-1">
                      <Button variant="outline" onClick={() => setChoosingInvoice(true)}>
                        {recipient.invoiceId ? "Cambiar factura" : "Elegir factura"}
                      </Button>
                      {recipient.invoiceId && (
                        <Button variant="outline" onClick={() => setLoadingGoods(true)}>
                          <PackageOpen aria-hidden="true" />
                          Cargar mercancías de la factura
                        </Button>
                      )}
                    </div>
                    <EntityPickerDialog<ShippingEligibleInvoiceView>
                      open={choosingInvoice}
                      onOpenChange={setChoosingInvoice}
                      title="Elegir factura"
                      description="Facturas autorizadas de la empresa en el ambiente vigente."
                      searchLabel="Buscar por número o comprador"
                      searchPlaceholder="Número o comprador"
                      queryKey={[...SHIPPING_GUIDES_KEY, "eligible-invoices"]}
                      fetchPage={fetchShippingEligibleInvoices}
                      getKey={(invoice) => invoice.id}
                      getLabel={(invoice) => `${invoice.documentNumber}, ${invoice.buyerName}`}
                      renderItem={(invoice) => (
                        <span className="flex min-w-0 flex-col">
                          <span className="font-medium tabular-nums">{invoice.documentNumber}</span>
                          <span className="text-sm text-foreground-muted break-words">
                            {invoice.buyerName} · {formatIssueDate(invoice.issueDate)}
                          </span>
                        </span>
                      )}
                      onSelect={chooseInvoice}
                      emptyTitle="No hay facturas autorizadas que coincidan"
                      emptyDescription="Solo una factura autorizada puede sustentar la guía."
                    />
                    {recipient.invoiceId && (
                      <GoodsDialog
                        invoiceId={recipient.invoiceId}
                        open={loadingGoods}
                        onOpenChange={setLoadingGoods}
                        onAdd={addDetails}
                      />
                    )}
                  </>
                )}
                {recipient.supportKind === "DECLARED_EXCEPTION" && (
                  <div className="flex flex-col gap-0.5">
                    <span id={caseLabelId} className="text-sm font-medium">
                      Caso del art. 30, numeral 8, del Reglamento de Comprobantes
                    </span>
                    <SelectionCardGroup
                      aria-labelledby={caseLabelId}
                      options={caseOptions}
                      value={recipient.exceptionCase as ShippingExceptionCase}
                      onChange={(next) => set(`${base}.exceptionCase`, next)}
                    />
                    <p className="text-xs text-foreground-muted">
                      Al emitir confirmarás esta declaración. El sistema no puede comprobarla.
                    </p>
                  </div>
                )}
              </>
            )}
          </SubList>
        </>
      )}

      <SubList title="Detalle">
        <ol className="flex flex-col gap-1">
          {details.fields.map((field, d) => (
            <DetailRow
              key={field.id}
              form={form}
              recipientIndex={index}
              index={d}
              issues={fresh ? detailIssues(d + 1) : []}
              previewDetail={
                fresh
                  ? previewRecipient?.details.find((item) => item.position === d + 1)
                  : undefined
              }
              canRemove={details.fields.length > 1}
              onRemove={() => {
                details.remove(d);
                addDetailRef.current?.focus();
              }}
            />
          ))}
        </ol>
        <Button
          ref={addDetailRef}
          variant="outline"
          className="self-start"
          disabled={details.fields.length >= limits.detailsPerRecipient}
          onClick={() =>
            details.append(blankDetail(), {
              focusName: `${base}.details.${details.fields.length}.description`,
            })
          }
        >
          <Plus aria-hidden="true" />
          Agregar detalle
        </Button>
        {details.fields.length >= limits.detailsPerRecipient && (
          <p className="text-xs text-foreground-muted">
            Llegaste al máximo de {limits.detailsPerRecipient} detalles por destinatario, un límite
            del sistema (no del SRI).
          </p>
        )}
      </SubList>
      <IssueList issues={own} />
    </li>
  );
}
