// Diálogos del inventario (add-minimal-inventory, design D7 y D13): inicializar con el saldo contado,
// registrar una entrada y ajustar con motivo obligatorio. Formularios con React Hook Form y los
// esquemas del contrato. La clave de idempotencia de una entrada o un ajuste la genera quien abre el
// diálogo y se repite en los reintentos: un doble envío o un reintento tras un fallo de red no
// registra dos movimientos.
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  STOCK_TEXT_MAX_LENGTH,
  initializeStockSchema,
  stockAdjustmentSchema,
  stockEntrySchema,
  type InitializeStockInput,
  type StockEntryInput,
} from "@facturador/contracts";
import { useEffect, useId, useRef, useState } from "react";
import { Controller, useForm, type Resolver } from "react-hook-form";
import { errorMessage } from "@/components/feedback";
import { fieldAria, FormDialog, FormField } from "@/components/form-dialog";
import { SegmentedControl } from "@/components/segmented-control";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api";
import { formatDecimal } from "@/lib/decimal";
import { useInitializeStock, useRecordAdjustment, useRecordEntry } from "./inventory-api";

/** Producto del diálogo y, en las entradas y los ajustes, la clave generada al abrirlo. */
export type MovementTarget = { productId: string; name: string; balance: string | null };

type QuantityForm = { quantity: string; note: string };

const REUSED_KEY =
  "Ya registraste un movimiento desde este diálogo con otros datos. Revisa el kárdex; para registrar otro, cierra y vuelve a abrir el diálogo.";

/** Los rechazos de negocio se explican en el diálogo y conservan lo escrito. */
function dialogError(cause: unknown): string | null {
  if (!(cause instanceof ApiError)) return null;
  if (cause.code === "IDEMPOTENCY_KEY_REUSED") return REUSED_KEY;
  if (cause.status === 400 || cause.status === 404 || cause.status === 409) {
    return errorMessage(cause);
  }
  return null;
}

/**
 * Un solo envío a la vez: la validación es asíncrona, así que un doble clic llega antes de que la
 * mutación figure como pendiente. La marca se libera al terminar, con éxito o con error.
 */
function useSingleFlight() {
  const busy = useRef(false);
  return (send: (settled: () => void) => void) => {
    if (busy.current) return;
    busy.current = true;
    send(() => {
      busy.current = false;
    });
  };
}

function useQuantityForm(open: boolean, schema: Parameters<typeof zodResolver>[0]) {
  const form = useForm<QuantityForm, unknown, StockEntryInput>({
    resolver: zodResolver(schema) as unknown as Resolver<QuantityForm, unknown, StockEntryInput>,
    defaultValues: { quantity: "", note: "" },
  });
  useEffect(() => {
    if (open) form.reset({ quantity: "", note: "" });
  }, [open, form]);
  return form;
}

function NoteField({ form }: { form: ReturnType<typeof useQuantityForm> }) {
  const error = form.formState.errors.note?.message;
  return (
    <FormField id="stock-note" label="Nota (opcional)" error={error}>
      <Input
        {...fieldAria("stock-note", error)}
        {...form.register("note")}
        maxLength={STOCK_TEXT_MAX_LENGTH}
        autoComplete="off"
      />
    </FormField>
  );
}

/** Al registrar, `onDone` corre antes de cerrar; `onCloseAutoFocus` decide el foco al cerrar. */
type DialogCallbacks = {
  onClose: () => void;
  onDone: () => void;
  onCloseAutoFocus: (event: Event) => void;
};

export function InitializeStockDialog({
  target,
  onClose,
  onDone,
  onCloseAutoFocus,
}: { target: MovementTarget | null } & DialogCallbacks) {
  const [error, setError] = useState<string>();
  const once = useSingleFlight();
  const form = useQuantityForm(target !== null, initializeStockSchema);
  const quantityError = form.formState.errors.quantity?.message;
  const close = () => {
    setError(undefined);
    onClose();
  };
  const initialize = useInitializeStock({
    onSuccess: () => {
      onDone();
      close();
    },
    onError: (cause) => {
      const message = dialogError(cause);
      if (message) setError(message);
      return message !== null;
    },
  });
  const hint = "La cantidad contada hoy; puede ser cero. Se registra una sola vez.";
  return (
    <FormDialog
      open={target !== null}
      onOpenChange={(next) => (next ? undefined : close())}
      onCloseAutoFocus={onCloseAutoFocus}
      title="Inicializar inventario"
      {...(target ? { description: target.name } : {})}
      submitLabel="Inicializar"
      pending={initialize.isPending || form.formState.isSubmitting}
      error={error}
      onSubmit={form.handleSubmit((input) => {
        if (!target) return;
        setError(undefined);
        once((settled) =>
          initialize.mutate(
            { productId: target.productId, input: input as InitializeStockInput },
            { onSettled: settled },
          ),
        );
      })}
    >
      <FormField id="stock-quantity" label="Saldo inicial" hint={hint} error={quantityError}>
        <Input
          {...fieldAria("stock-quantity", quantityError, hint)}
          {...form.register("quantity")}
          inputMode="decimal"
          autoComplete="off"
          className="max-w-80"
        />
      </FormField>
      <NoteField form={form} />
    </FormDialog>
  );
}

export function StockEntryDialog({
  target,
  idempotencyKey,
  onClose,
  onDone,
  onCloseAutoFocus,
}: { target: MovementTarget | null; idempotencyKey: string } & DialogCallbacks) {
  const [error, setError] = useState<string>();
  const once = useSingleFlight();
  const form = useQuantityForm(target !== null, stockEntrySchema);
  const quantityError = form.formState.errors.quantity?.message;
  const close = () => {
    setError(undefined);
    onClose();
  };
  const record = useRecordEntry({
    onSuccess: () => {
      onDone();
      close();
    },
    onError: (cause) => {
      const message = dialogError(cause);
      if (message) setError(message);
      return message !== null;
    },
  });
  const hint = "Las unidades que ingresaron, mayor que cero.";
  return (
    <FormDialog
      open={target !== null}
      onOpenChange={(next) => (next ? undefined : close())}
      onCloseAutoFocus={onCloseAutoFocus}
      title="Registrar entrada"
      {...(target
        ? {
            description:
              target.balance === null
                ? target.name
                : `${target.name} · saldo actual ${formatDecimal(target.balance)}`,
          }
        : {})}
      submitLabel="Registrar entrada"
      pending={record.isPending || form.formState.isSubmitting}
      error={error}
      onSubmit={form.handleSubmit((input) => {
        // Ni el doble clic ni el envío implícito con Enter duplican una entrada pendiente.
        if (!target) return;
        setError(undefined);
        once((settled) =>
          record.mutate(
            { productId: target.productId, idempotencyKey, input },
            { onSettled: settled },
          ),
        );
      })}
    >
      <FormField id="stock-quantity" label="Cantidad" hint={hint} error={quantityError}>
        <Input
          {...fieldAria("stock-quantity", quantityError, hint)}
          {...form.register("quantity")}
          inputMode="decimal"
          autoComplete="off"
          className="max-w-80"
        />
      </FormField>
      <NoteField form={form} />
    </FormDialog>
  );
}

type Direction = "DECREASE" | "INCREASE";
const DIRECTIONS = [
  { value: "DECREASE" as const, label: "Disminuir" },
  { value: "INCREASE" as const, label: "Aumentar" },
];
type AdjustmentForm = { direction: Direction; quantity: string; reason: string };

export function StockAdjustmentDialog({
  target,
  idempotencyKey,
  onClose,
  onDone,
  onCloseAutoFocus,
}: { target: MovementTarget | null; idempotencyKey: string } & DialogCallbacks) {
  const directionLabel = useId();
  const [error, setError] = useState<string>();
  const once = useSingleFlight();
  const form = useForm<AdjustmentForm>({
    defaultValues: { direction: "DECREASE", quantity: "", reason: "" },
  });
  const { errors } = form.formState;
  useEffect(() => {
    if (target) form.reset({ direction: "DECREASE", quantity: "", reason: "" });
  }, [target, form]);
  const close = () => {
    setError(undefined);
    onClose();
  };
  const record = useRecordAdjustment({
    onSuccess: () => {
      onDone();
      close();
    },
    onError: (cause) => {
      const message = dialogError(cause);
      if (message) setError(message);
      return message !== null;
    },
  });
  const hint = "Las unidades que corriges, mayor que cero.";
  return (
    <FormDialog
      open={target !== null}
      onOpenChange={(next) => (next ? undefined : close())}
      onCloseAutoFocus={onCloseAutoFocus}
      title="Ajustar existencias"
      {...(target
        ? {
            description:
              target.balance === null
                ? target.name
                : `${target.name} · saldo actual ${formatDecimal(target.balance)}`,
          }
        : {})}
      submitLabel="Registrar ajuste"
      pending={record.isPending || form.formState.isSubmitting}
      error={error}
      onSubmit={form.handleSubmit((values) => {
        if (!target) return;
        setError(undefined);
        const quantity = values.quantity.trim();
        // El signo lo pone la dirección: la cantidad se escribe sin signo.
        const delta =
          values.direction === "DECREASE" && !quantity.startsWith("-") ? `-${quantity}` : quantity;
        const parsed = stockAdjustmentSchema.safeParse({ delta, reason: values.reason });
        if (!parsed.success) {
          let focused = false;
          for (const issue of parsed.error.issues) {
            const field = issue.path[0] === "reason" ? "reason" : "quantity";
            form.setError(field, { message: issue.message }, { shouldFocus: !focused });
            focused = true;
          }
          return;
        }
        const input = parsed.data;
        once((settled) =>
          record.mutate(
            { productId: target.productId, idempotencyKey, input },
            { onSettled: settled },
          ),
        );
      })}
    >
      <div className="flex flex-col gap-1">
        <span id={directionLabel} className="text-sm font-medium">
          Dirección
        </span>
        <Controller
          control={form.control}
          name="direction"
          render={({ field }) => (
            <SegmentedControl<Direction>
              aria-labelledby={directionLabel}
              options={DIRECTIONS}
              value={field.value}
              onChange={field.onChange}
            />
          )}
        />
      </div>
      <FormField id="stock-quantity" label="Cantidad" hint={hint} error={errors.quantity?.message}>
        <Input
          {...fieldAria("stock-quantity", errors.quantity?.message, hint)}
          {...form.register("quantity")}
          inputMode="decimal"
          autoComplete="off"
          className="max-w-80"
        />
      </FormField>
      <FormField
        id="stock-reason"
        label="Motivo"
        hint="Queda en el kárdex con tu nombre. Un ajuste equivocado se corrige con otro ajuste."
        error={errors.reason?.message}
      >
        <Input
          {...fieldAria(
            "stock-reason",
            errors.reason?.message,
            "Queda en el kárdex con tu nombre. Un ajuste equivocado se corrige con otro ajuste.",
          )}
          {...form.register("reason")}
          maxLength={STOCK_TEXT_MAX_LENGTH}
          autoComplete="off"
        />
      </FormField>
    </FormDialog>
  );
}
