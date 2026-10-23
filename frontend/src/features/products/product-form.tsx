// Alta y corrección de un producto o servicio (add-parties-and-products, design D17), en su propia
// página (decisión del propietario, 2026-10-17: el formulario largo no cabe bien en un diálogo).
// Una sola columna centrada, sin secciones, como Terceros (decisión del propietario, 2026-10-22): el
// tipo a todo el ancho; el nombre y los códigos; el precio con el control de stock a su derecha; el
// IVA y el ICE en una fila; el IRBPNR de un bien; y la descripción interna en un área de texto con su
// cuenta. React Hook Form con el esquema del contrato:
// precio sin impuestos como texto decimal, IVA obligatorio e ICE e IRBPNR opcionales entre las
// entradas utilizables del catálogo fiscal. Pasar a servicio quita en la misma solicitud el IRBPNR y
// el control de stock. Al guardar, vuelve a la lista con el aviso.
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  createProductSchema,
  PRODUCT_DESCRIPTION_MAX_LENGTH,
  PRODUCT_KIND_LABELS,
  PRODUCT_KINDS,
  productTaxesSchema,
  type ProductData,
  type ProductKind,
  type ProductTaxSlot,
  type ProductView,
  type TaxReviewReason,
} from "@facturador/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Controller, useForm, useWatch, type Resolver } from "react-hook-form";
import { z } from "zod";
import { AsyncButton } from "@/components/async-button";
import { errorMessage } from "@/components/feedback";
import { fieldAria, FormField } from "@/components/form-dialog";
import { PageHeader } from "@/components/layout/page-header";
import { SegmentedControl } from "@/components/segmented-control";
import { useSession } from "@/components/session";
import { useBreadcrumbLabel } from "@/components/shell/breadcrumb-label";
import { EmptyState, ErrorState, Skeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api";
import { canSee } from "@/lib/permissions";
import { useStockItem } from "@/features/inventory/inventory-api";
import { useProduct, useSaveProduct, useTaxOptions, type TaxOption } from "./products-api";

const LIST = "/productos";
const TITLE_ID = "producto-titulo";
/** Una sola columna centrada en la página, como Terceros (decisión del propietario, 2026-10-22). */
const PAGE = "mx-auto flex w-full max-w-2xl flex-col gap-6";

type FormInput = {
  kind: ProductKind;
  mainCode: string;
  auxiliaryCode: string;
  name: string;
  description: string;
  unitPrice: string;
  stockTracked: boolean;
  taxes: { iva: string; ice: string; irbpnr: string };
};

// Un select vacío es "sin ICE" o "sin IRBPNR": se envía como null.
const formSchema = createProductSchema.extend({
  taxes: z.preprocess((value) => {
    const taxes = value as FormInput["taxes"];
    return { iva: taxes.iva || undefined, ice: taxes.ice || null, irbpnr: taxes.irbpnr || null };
  }, productTaxesSchema),
});

const KIND_OPTIONS = PRODUCT_KINDS.map((kind) => ({
  value: kind,
  label: PRODUCT_KIND_LABELS[kind],
}));
const SLOT_NOUNS: Record<ProductTaxSlot, string> = {
  iva: "La tarifa de IVA",
  ice: "El código de ICE",
  irbpnr: "El código de IRBPNR",
};
export const REASON_TEXT: Record<TaxReviewReason, string> = {
  NOT_IN_FORCE: "no tiene una versión vigente hoy",
  WITHDRAWN: "fue retirada del catálogo oficial",
  DISABLED: "no está habilitada para tu empresa",
  NO_CALCULATION_DATA: "todavía no tiene datos oficiales para calcular el impuesto",
};

const toForm = (product: ProductView | null): FormInput => {
  const tax = (slot: ProductTaxSlot) => product?.taxes.find((t) => t.slot === slot)?.entryKey ?? "";
  return {
    kind: product?.kind ?? "GOOD",
    mainCode: product?.mainCode ?? "",
    auxiliaryCode: product?.auxiliaryCode ?? "",
    name: product?.name ?? "",
    description: product?.description ?? "",
    unitPrice: product?.unitPrice ?? "",
    stockTracked: product?.stockTracked ?? false,
    taxes: { iva: tax("iva"), ice: tax("ice"), irbpnr: tax("irbpnr") },
  };
};

/** Opciones utilizables más la referencia actual del producto, aunque hoy no lo sea. */
function withCurrent(
  options: TaxOption[] | undefined,
  product: ProductView | null,
  slot: ProductTaxSlot,
): TaxOption[] {
  const list = options ?? [];
  const current = product?.taxes.find((t) => t.slot === slot);
  if (!current || list.some((o) => o.entryKey === current.entryKey)) return list;
  return [
    ...list,
    {
      entryKey: current.entryKey,
      label: `${current.officialLabel ?? current.entryKey} · código ${current.code} (no disponible hoy)`,
    },
  ];
}

function ProductForm({ initial }: { initial: ProductView | null }) {
  // La versión que se corrige es la que se abrió: una recarga posterior no la reemplaza, así un
  // cambio de otro usuario sigue llegando como conflicto.
  const [product] = useState(initial);
  const { me } = useSession();
  const router = useRouter();
  const kindLabel = useId();
  const [error, setError] = useState<string>();
  const iva = useTaxOptions("iva-rate", true);
  const ice = useTaxOptions("ice-rate", true);
  const irbpnr = useTaxOptions("irbpnr-rate", true);
  const form = useForm<FormInput, unknown, ProductData>({
    resolver: zodResolver(formSchema) as unknown as Resolver<FormInput, unknown, ProductData>,
    defaultValues: toForm(product),
  });
  const { errors } = form.formState;
  const kind = useWatch({ control: form.control, name: "kind" });
  const description = useWatch({ control: form.control, name: "description" }) ?? "";
  const descriptionHint = `No aparece en los comprobantes · ${description.length}/${PRODUCT_DESCRIPTION_MAX_LENGTH}`;
  // add-minimal-inventory, design D11: con el inventario inicializado, la marca la cambia el
  // inventario. Mientras se consulta, la marca tampoco se puede cambiar.
  const inventory = useStockItem(
    product?.id ?? "",
    product !== null && product.kind === "GOOD" && canSee(me.role, "inventory.read"),
  );
  const stockManaged =
    inventory.isPending && inventory.fetchStatus === "fetching"
      ? "checking"
      : inventory.data?.state === "TRACKED_INITIALIZED" ||
          inventory.data?.state === "DISABLED_INITIALIZED"
        ? "inventory"
        : null;

  const save = useSaveProduct({
    onSuccess: () => router.push(LIST),
    onError: (cause) => {
      if (cause instanceof ApiError && cause.code === "PRODUCT_MAIN_CODE_TAKEN") {
        form.setError("mainCode", { message: cause.message }, { shouldFocus: true });
        return true;
      }
      if (cause instanceof ApiError && (cause.status === 400 || cause.status === 409)) {
        setError(errorMessage(cause));
        return true;
      }
      return false;
    },
  });
  const review =
    product && product.taxConfiguration.status !== "READY" ? product.taxConfiguration : null;

  return (
    <form
      noValidate
      aria-labelledby={TITLE_ID}
      onSubmit={form.handleSubmit((input) => {
        setError(undefined);
        save.mutate(
          product
            ? { id: product.id, input: { ...input, expectedVersion: product.version } }
            : { input },
        );
      })}
      className="flex flex-col gap-5"
    >
      {review && (
        <div
          role="note"
          className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm"
        >
          <p className="font-medium">
            {review.status === "REVIEW_REQUIRED"
              ? "Revisa los impuestos"
              : "Faltan datos para calcular un impuesto"}
          </p>
          <ul className="list-disc pl-4">
            {review.reasons.map((reason) => (
              <li key={reason.slot}>
                {SLOT_NOUNS[reason.slot]} {reason.code} {REASON_TEXT[reason.reason]}.
              </li>
            ))}
          </ul>
          {canSee(me.role, "fiscalCatalogs.manage") && (
            <Link href="/configuracion/catalogos-fiscales" className="text-primary underline">
              Ir a Catálogos fiscales
            </Link>
          )}
        </div>
      )}
      <div className="flex flex-col gap-1">
        <span id={kindLabel} className="text-sm font-medium">
          Tipo
        </span>
        <Controller
          control={form.control}
          name="kind"
          render={({ field }) => (
            <SegmentedControl<ProductKind>
              fullWidth
              aria-labelledby={kindLabel}
              options={KIND_OPTIONS}
              value={field.value}
              onChange={(next) => {
                field.onChange(next);
                if (next === "SERVICE") {
                  form.setValue("taxes.irbpnr", "");
                  form.setValue("stockTracked", false);
                }
              }}
            />
          )}
        />
      </div>
      <FormField id="product-name" label="Nombre" error={errors.name?.message}>
        <Input
          {...fieldAria("product-name", errors.name?.message)}
          {...form.register("name")}
          autoComplete="off"
        />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          id="product-main-code"
          label="Código principal (opcional)"
          error={errors.mainCode?.message}
        >
          <Input
            {...fieldAria("product-main-code", errors.mainCode?.message)}
            {...form.register("mainCode")}
            autoComplete="off"
            spellCheck={false}
          />
        </FormField>
        <FormField
          id="product-aux-code"
          label="Código auxiliar (opcional)"
          error={errors.auxiliaryCode?.message}
        >
          <Input
            {...fieldAria("product-aux-code", errors.auxiliaryCode?.message)}
            {...form.register("auxiliaryCode")}
            autoComplete="off"
            spellCheck={false}
          />
        </FormField>
      </div>

      {/* El precio y, a su derecha, el control de stock de un bien (decisión del propietario,
          2026-10-22). */}
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <FormField
          id="product-price"
          label="Precio unitario sin impuestos"
          hint="Con punto decimal y hasta 6 decimales, por ejemplo 8.75."
          error={errors.unitPrice?.message}
        >
          <Input
            {...fieldAria("product-price", errors.unitPrice?.message, "hint")}
            {...form.register("unitPrice")}
            inputMode="decimal"
            autoComplete="off"
          />
        </FormField>
        {/* Alineado con el campo del precio, debajo de su etiqueta. */}
        <div className="flex flex-col gap-1 sm:pt-6">
          {kind !== "GOOD" ? (
            <p className="flex min-h-10 items-center text-sm text-foreground-muted">
              Un servicio no lleva IRBPNR ni control de stock.
            </p>
          ) : stockManaged && product ? (
            // Sin registrar: la marca conserva su valor y no se envía cambiada.
            <>
              <label className="flex min-h-10 items-center gap-2 text-sm text-foreground-muted">
                <input
                  type="checkbox"
                  className="size-5 accent-primary"
                  checked={product.stockTracked}
                  disabled
                  readOnly
                  aria-describedby="product-stock-managed"
                />
                Controlar stock de este bien
              </label>
              {stockManaged === "inventory" && (
                <p id="product-stock-managed" className="text-xs text-foreground-muted">
                  El control se gestiona en Inventario.{" "}
                  <Link
                    href={`/inventario/${encodeURIComponent(product.id)}`}
                    className="text-primary underline"
                  >
                    Ir al inventario del producto
                  </Link>
                </p>
              )}
            </>
          ) : (
            <label className="flex min-h-10 items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-5 accent-primary"
                {...form.register("stockTracked")}
              />
              Controlar stock de este bien
            </label>
          )}
        </div>
      </div>

      {/* El IVA y el ICE en una fila (decisión del propietario, 2026-10-22). */}
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <FormField
          id="product-iva"
          label="Tarifa de IVA"
          error={errors.taxes?.iva?.message ?? errors.taxes?.message}
        >
          <Select
            id="product-iva"
            {...form.register("taxes.iva")}
            aria-invalid={errors.taxes ? true : undefined}
          >
            <option value="">Elige una tarifa</option>
            {withCurrent(iva.data, product, "iva").map((option) => (
              <option key={option.entryKey} value={option.entryKey}>
                {option.label}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField
          id="product-ice"
          label="ICE (opcional)"
          hint="Solo los códigos que tu empresa habilitó en Catálogos fiscales."
        >
          <Select id="product-ice" {...form.register("taxes.ice")}>
            <option value="">Sin ICE</option>
            {withCurrent(ice.data, product, "ice").map((option) => (
              <option key={option.entryKey} value={option.entryKey}>
                {option.label}
              </option>
            ))}
          </Select>
        </FormField>
      </div>
      {kind === "GOOD" && (
        <FormField id="product-irbpnr" label="IRBPNR (opcional)">
          <Select id="product-irbpnr" {...form.register("taxes.irbpnr")}>
            <option value="">Sin IRBPNR</option>
            {withCurrent(irbpnr.data, product, "irbpnr").map((option) => (
              <option key={option.entryKey} value={option.entryKey}>
                {option.label}
              </option>
            ))}
          </Select>
        </FormField>
      )}

      <FormField
        id="product-description"
        label="Descripción interna (opcional)"
        hint={descriptionHint}
        error={errors.description?.message}
      >
        <Textarea
          maxLength={PRODUCT_DESCRIPTION_MAX_LENGTH}
          {...fieldAria("product-description", errors.description?.message, "hint")}
          {...form.register("description")}
        />
      </FormField>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm"
        >
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2 border-t border-border pt-6">
        <Button variant="ghost" asChild>
          <Link href={LIST}>Cancelar</Link>
        </Button>
        <AsyncButton type="submit" pending={save.isPending}>
          {product ? "Guardar cambios" : "Registrar producto"}
        </AsyncButton>
      </div>
    </form>
  );
}

/** Encabezado de la página, también en sus estados de carga, error y sin permiso. */
function Header({ editing, description }: { editing: boolean; description?: string }) {
  return (
    <PageHeader
      title={editing ? "Corregir producto" : "Nuevo producto"}
      titleId={TITLE_ID}
      description={description ?? "Lo que vendes, con su precio sin impuestos y sus impuestos."}
    />
  );
}

/** La página del formulario: sin `productId`, un alta; con él, la corrección de ese producto. */
export function ProductFormScreen({ productId }: { productId?: string }) {
  const { me } = useSession();
  const allowed = canSee(me.role, "products.manage");
  const editing = productId !== undefined;
  const query = useProduct(productId ?? "", allowed && editing);
  useBreadcrumbLabel(query.data?.name);

  if (!allowed) {
    return (
      <section aria-labelledby={TITLE_ID} className={PAGE}>
        <Header editing={editing} />
        <EmptyState
          kind="no-permission"
          title="No tienes permiso para registrar productos"
          description="Pide a un administrador que revise tu rol."
        />
      </section>
    );
  }
  if (!editing) {
    return (
      <section aria-labelledby={TITLE_ID} className={PAGE}>
        <Header editing={false} />
        <ProductForm initial={null} />
      </section>
    );
  }
  if (query.isPending) return <ProductFormSkeleton />;
  if (query.isError) {
    const missing = query.error instanceof ApiError && query.error.status === 404;
    return (
      <section aria-labelledby={TITLE_ID} className={PAGE}>
        <Header editing />
        {missing ? (
          <EmptyState
            kind="empty"
            title="El producto no existe"
            description="Búscalo en la lista de productos."
            action={
              <Button variant="outline" asChild>
                <Link href={LIST}>Ir a Productos</Link>
              </Button>
            }
          />
        ) : (
          <ErrorState
            message="No pudimos cargar el producto."
            onRetry={() => void query.refetch()}
          />
        )}
      </section>
    );
  }
  return (
    <section aria-labelledby={TITLE_ID} className={PAGE}>
      <Header editing description={query.data.name} />
      <ProductForm key={query.data.id} initial={query.data} />
    </section>
  );
}

export function ProductFormSkeleton() {
  return (
    <section aria-busy="true" className={PAGE}>
      <Skeleton className="h-10 w-64" />
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    </section>
  );
}
