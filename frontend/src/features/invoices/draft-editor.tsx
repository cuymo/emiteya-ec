// Editor de factura a página completa (add-invoice-emission, design D15): flujo complejo y de riesgo
// (frontend-checklist.md). Usuario: administrador u operador, a diario. Objetivo: crear una factura,
// comprobar que está bien y emitirla. Recorrido: comprador, productos, pago, total y emitir.
// El frontend no calcula impuestos ni totales: los pide al servidor mientras se escribe
// (`POST /invoices/drafts/preview`, la misma evaluación de la emisión), sin guardar el borrador. Solo
// suma los importes que el usuario reparte entre las formas de pago para decir cuánto falta.
// Composición (rediseño del editor pedido por el propietario, 2026-10-16):
// - `PageHeader` de editor con el título; las migas van en la barra superior;
// - `FormLayout` con las secciones a la izquierda y, en un carril fijo, el resumen con el total, lo
//   que falta para emitir y las acciones; apilado, una barra al pie con el total y las acciones;
// - «Emitir factura» es la acción principal y guarda el borrador si hace falta antes de confirmar;
//   «Guardar borrador» es secundaria y nunca es necesaria para ver los totales;
// - el estado del guardado es texto discreto («Sin guardar», «Guardado»), no una advertencia.
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  compareDecimalStrings,
  defaultEmissionPointViewSchema,
  invoiceAmountSchema,
  invoiceQuantitySchema,
  type CreateDraftInput,
  type DraftPreviewView,
  type DraftView,
  type InvoiceIssue,
  type PartyView,
  type StockWarning,
} from "@facturador/contracts";
import {
  CircleCheck,
  CircleDashed,
  CircleDot,
  Info,
  LoaderCircle,
  PackagePlus,
  Plus,
  Save,
  Send,
  Split,
  Trash2,
  TriangleAlert,
  UserRound,
  UserRoundPen,
  UserSearch,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Controller, useFieldArray, useForm, useWatch, type Resolver } from "react-hook-form";
import { z } from "zod";
import { AsyncButton } from "@/components/async-button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { RowActionButton } from "@/components/data-table/table-controls";
import { EntityPickerDialog } from "@/components/entity-picker-dialog";
import { errorMessage, toast, useMutationFeedback } from "@/components/feedback";
import { fieldAria, FormField } from "@/components/form-dialog";
import { FormLayout, StickyFormActions, StickySummaryPanel } from "@/components/layout/form-layout";
import { FormSection } from "@/components/layout/form-section";
import { PageHeader } from "@/components/layout/page-header";
import { formatMoney } from "@/components/money";
import { useSession } from "@/components/session";
import { EmptyState, ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, apiFetch } from "@/lib/api";
import { formatDecimal, formatPercentage } from "@/lib/decimal";
import { canSee } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { ENVIRONMENT_LABELS, useCompanyStatus } from "@/features/company/company-api";
import { EmissionEnvironmentNotice } from "@/features/company/emission-environment-notice";
import {
  DEFAULT_POINT_KEY,
  pointLabel,
  useEstablishments,
} from "@/features/establishments/establishments-api";
import { useCatalogEntries } from "@/features/fiscal-catalogs/catalogs-api";
import { identificationText, paymentMethodName } from "./invoice-format";
import { ProductPickerDialog } from "./product-picker-dialog";
import {
  DRAFTS_KEY,
  fetchConsumerFinal,
  fetchCustomers,
  fetchDraft,
  saveDraftRequest,
  useDraft,
  useDraftPreview,
  useEmitInvoice,
} from "./invoices-api";

type Buyer = {
  id: string;
  legalName: string;
  identificationType: string;
  identification: string;
  consumerFinal: boolean;
};

type FormValues = {
  emissionPointId: string;
  buyer: Buyer | null;
  lines: {
    productId: string;
    name: string;
    mainCode: string | null;
    unitPrice: string;
    quantity: string;
    discount: string;
  }[];
  payments: { paymentMethod: string; amount: string }[];
};

/** Acepta la coma decimal que se escribe en Ecuador: «1,5» es «1.5». */
const normalizeDecimal = (text: string) => text.trim().replace(",", ".");

const decimalInput = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (typeof value === "string" ? normalizeDecimal(value) : value), schema);

// Un descuento o un importe vacío es 0 o "sin importe": se envía así, sin redondear nada.
const formSchema = z.object({
  emissionPointId: z.string(),
  buyer: z
    .object({
      id: z.string(),
      legalName: z.string(),
      identificationType: z.string(),
      identification: z.string(),
      consumerFinal: z.boolean(),
    })
    .nullable(),
  lines: z.array(
    z.object({
      productId: z.string(),
      name: z.string(),
      mainCode: z.string().nullable(),
      unitPrice: z.string(),
      quantity: decimalInput(invoiceQuantitySchema),
      discount: decimalInput(z.union([z.literal(""), invoiceAmountSchema])),
    }),
  ),
  payments: z.array(
    z.object({
      paymentMethod: z.string().min(1, "Elige la forma de pago."),
      amount: decimalInput(z.union([z.literal(""), invoiceAmountSchema])),
    }),
  ),
});

const toForm = (draft: DraftView | null): FormValues => ({
  emissionPointId: draft?.emissionPoint?.id ?? "",
  buyer: draft?.buyer
    ? {
        id: draft.buyer.id,
        legalName: draft.buyer.legalName,
        identificationType: draft.buyer.identificationType,
        identification: draft.buyer.identification,
        consumerFinal: draft.buyer.systemRecord === "CONSUMER_FINAL",
      }
    : null,
  lines:
    draft?.lines.map((line) => ({
      productId: line.product.id,
      name: line.product.name,
      mainCode: line.product.mainCode,
      unitPrice: line.product.unitPrice,
      quantity: line.quantity,
      discount: line.discount === "0" ? "" : line.discount,
    })) ?? [],
  payments:
    draft && draft.payments.length > 0
      ? draft.payments.map((payment) => ({
          paymentMethod: payment.paymentMethod,
          amount: payment.amount ?? "",
        }))
      : [{ paymentMethod: "01", amount: "" }],
});

const toInput = (values: FormValues): CreateDraftInput => ({
  emissionPointId: values.emissionPointId || null,
  buyerPartyId: values.buyer?.id ?? null,
  lines: values.lines.map((line) => ({
    productId: line.productId,
    quantity: normalizeDecimal(line.quantity),
    discount: normalizeDecimal(line.discount) || "0",
  })),
  payments: values.payments.map((payment) => ({
    paymentMethod: payment.paymentMethod,
    amount: normalizeDecimal(payment.amount) || null,
  })),
});

const asBuyer = (party: PartyView): Buyer => ({
  id: party.id,
  legalName: party.legalName,
  identificationType: party.identificationType,
  identification: party.identification,
  consumerFinal: party.systemRecord === "CONSUMER_FINAL",
});

/**
 * Centavos de un importe escrito, para sumar lo repartido entre las formas de pago sin pasar por la
 * coma flotante. `null` si no es un importe con hasta dos decimales.
 */
function toCents(text: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(normalizeDecimal(text));
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

const fromCents = (cents: number) => {
  const abs = Math.abs(cents);
  return `${cents < 0 ? "-" : ""}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
};

/** Los problemas del servidor que señalan un dato de la cabecera, para mostrarlos junto a él. */
const isBuyerIssue = (issue: InvoiceIssue) => issue.code.startsWith("BUYER_");
const isPointIssue = (issue: InvoiceIssue) => issue.code.startsWith("EMISSION_POINT_");
/** Lo que falta lo dice la lista «Para emitir»; el pago que no cuadra, la sección de pagos. */
const isChecklistIssue = (issue: InvoiceIssue) => issue.code === "INVOICE_DRAFT_INCOMPLETE";
const isPaymentsIssue = (issue: InvoiceIssue) => issue.code === "PAYMENTS_DO_NOT_MATCH_TOTAL";

/** «SIN UTILIZACION DEL SISTEMA FINANCIERO» → «Sin utilizacion del sistema financiero». */
const sentenceCase = (text: string) =>
  text.charAt(0).toUpperCase() + text.slice(1).toLocaleLowerCase("es-EC");

function useDefaultPoint(enabled: boolean) {
  return useQuery({
    queryKey: DEFAULT_POINT_KEY,
    enabled,
    queryFn: ({ signal }) =>
      apiFetch("/me/default-emission-point", { schema: defaultEmissionPointViewSchema, signal }),
  });
}

/** El valor, cuando deja de cambiar durante `delay` ms. */
function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function IssueList({ issues }: { issues: readonly InvoiceIssue[] }) {
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
 * Aviso de existencias de un producto (add-minimal-inventory, design D9 y D13): orientativo, junto a
 * su última línea, sin bloquear la emisión ni garantizar disponibilidad.
 */
function StockWarningNote({ warning }: { warning: StockWarning }) {
  return (
    <p
      role="note"
      className="flex items-start gap-1 rounded-md border border-warning/40 bg-warning/10 px-2 py-1 text-sm"
    >
      <Info aria-hidden="true" className="mt-1 size-4 shrink-0 text-warning" />
      <span>
        {warning.code === "STOCK_BELOW_REQUESTED"
          ? `Aviso de existencias: pides ${formatDecimal(warning.requested)} y el saldo contabilizado es ${formatDecimal(warning.balance ?? "0")}.`
          : "Aviso de existencias: este producto todavía no tiene inventario inicializado."}{" "}
        Es orientativo y no impide emitir.
      </span>
    </p>
  );
}

/** Alerta de la operación con una acción de recuperación opcional. */
function OperationAlert({
  message,
  action,
  alertRef,
}: {
  message: string;
  action?: ReactNode;
  alertRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={alertRef}
      role="alert"
      tabIndex={-1}
      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm"
    >
      <p>{message}</p>
      {action}
    </div>
  );
}

/** Estado del guardado: texto neutro y discreto, nunca una advertencia. */
type SaveState = "unsaved" | "saving" | "saved";

function SaveStatus({ state }: { state: SaveState }) {
  const { label, icon: Icon } = {
    unsaved: { label: "Sin guardar", icon: CircleDot },
    saving: { label: "Guardando…", icon: LoaderCircle },
    saved: { label: "Guardado", icon: CircleCheck },
  }[state];
  return (
    <span
      role="status"
      data-slot="draft-state"
      className="flex items-center gap-1 text-xs text-foreground-muted"
    >
      <Icon
        aria-hidden="true"
        className={cn("size-3.5", state === "saving" && "motion-safe:animate-spin")}
      />
      {label}
    </span>
  );
}

/**
 * El comprador como una ficha, no como un campo: su nombre, su identificación con el tipo, y el botón
 * para elegirlo o cambiarlo. Sin comprador, una ficha vacía que invita a elegirlo, con «Elegir
 * comprador» en el azul primario (decisión del propietario, 2026-10-22). A su izquierda,
 * «Consumidor final» lo elige en un clic, salvo que ya sea el comprador.
 */
function BuyerCard({
  buyer,
  problem,
  onPick,
  onConsumerFinal,
  consumerPending,
}: {
  buyer: Buyer | null;
  problem: string | undefined;
  onPick: () => void;
  onConsumerFinal: () => void;
  consumerPending: boolean;
}) {
  const labelId = useId();
  const problemId = useId();
  return (
    <div className="flex flex-col gap-1">
      <span id={labelId} className="text-sm font-medium">
        Comprador
      </span>
      <div
        role="group"
        aria-labelledby={labelId}
        aria-describedby={problem ? problemId : undefined}
        aria-invalid={problem ? true : undefined}
        data-slot="buyer-card"
        className={cn(
          "flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 aria-invalid:border-danger",
          !buyer && "border-dashed",
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          {/* La persona del comprador, para reconocer la ficha de un vistazo. */}
          <span
            aria-hidden="true"
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-full",
              buyer ? "bg-primary/10 text-primary" : "bg-muted text-foreground-muted",
            )}
          >
            <UserRound className="size-5" />
          </span>
          {buyer ? (
            <div className="flex min-w-0 flex-col">
              <span className="truncate font-medium" title={buyer.legalName}>
                {buyer.legalName}
              </span>
              <span className="text-sm text-foreground-muted tabular-nums">
                {buyer.consumerFinal
                  ? `Consumidor final · ${buyer.identification}`
                  : identificationText(buyer.identificationType, buyer.identification)}
              </span>
            </div>
          ) : (
            <span className="text-sm text-foreground-muted">Aún no eliges a quién facturas.</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!buyer?.consumerFinal && (
            <AsyncButton
              variant="outline"
              size="default"
              pending={consumerPending}
              pendingLabel="Eligiendo al consumidor final"
              onClick={onConsumerFinal}
            >
              <UserRound aria-hidden="true" data-icon="inline-start" />
              Consumidor final
            </AsyncButton>
          )}
          <Button
            variant="primary"
            size="default"
            aria-label={buyer ? "Cambiar comprador" : "Elegir comprador"}
            onClick={onPick}
          >
            {buyer ? (
              <UserRoundPen aria-hidden="true" data-icon="inline-start" />
            ) : (
              <UserSearch aria-hidden="true" data-icon="inline-start" />
            )}
            {buyer ? "Cambiar" : "Elegir comprador"}
          </Button>
        </div>
      </div>
      {problem && (
        <p id={problemId} className="text-xs text-danger">
          {problem}
        </p>
      )}
    </div>
  );
}

/** El borrador guardado que el editor tiene a la vista: su identidad y su versión. */
type SavedDraft = Pick<DraftView, "id" | "version">;

function DraftEditor({ draft, canEmit }: { draft: DraftView | null; canEmit: boolean }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [operationError, setOperationError] = useState<{ message: string; code?: string }>();
  const alertRef = useRef<HTMLDivElement>(null);
  const [pickingBuyer, setPickingBuyer] = useState(false);
  const [pickingProduct, setPickingProduct] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [emitPending, setEmitPending] = useState(false);
  // El borrador guardado vive en el editor: guardar no vuelve a montarlo ni pierde el foco, y emitir
  // puede guardar antes sin cambiar de pantalla.
  const [saved, setSaved] = useState<SavedDraft | null>(
    draft ? { id: draft.id, version: draft.version } : null,
  );
  // La línea recién agregada recibe el foco en su cantidad al cerrarse el selector (design D13).
  const addedLine = useRef<number | null>(null);
  // Una clave por versión del borrador: un reintento de la misma emisión la repite y el servidor
  // devuelve o retoma la misma factura. Una versión nueva lleva una clave nueva.
  const idempotency = useRef<{ version: string; key: string } | null>(null);
  // Una confirmación repetida (doble clic) no envía una segunda emisión.
  const emitting = useRef(false);
  const establishments = useEstablishments();
  const paymentMethods = useCatalogEntries("payment-method", true);
  const status = useCompanyStatus();
  const defaultPoint = useDefaultPoint(draft === null);
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema) as unknown as Resolver<FormValues>,
    defaultValues: toForm(draft),
    mode: "onTouched",
  });
  const { errors, isDirty } = form.formState;
  const [consumerPending, setConsumerPending] = useState(false);
  /** El consumidor final del sistema como comprador: desde su botón o desde el selector. */
  const chooseConsumerFinal = () => {
    setConsumerPending(true);
    fetchConsumerFinal()
      .then((party) => {
        if (party)
          form.setValue("buyer", asBuyer(party), { shouldDirty: true, shouldValidate: true });
      })
      .catch(() => {
        toast.error("No pudimos elegir al consumidor final. Inténtalo de nuevo.", {
          id: "consumidor-final",
        });
      })
      .finally(() => setConsumerPending(false));
  };
  const lines = useFieldArray({ control: form.control, name: "lines" });
  const payments = useFieldArray({ control: form.control, name: "payments" });
  const values = useWatch({ control: form.control }) as FormValues;
  const buyer = values.buyer ?? null;
  const pointId = values.emissionPointId ?? "";
  // El establecimiento elegido mientras todavía no hay punto; con un punto, manda el suyo.
  const [establishmentChoice, setEstablishmentChoice] = useState("");

  // Un borrador nuevo empieza en el punto predeterminado del usuario, si tiene uno y sigue
  // disponible: uno desactivado no se preselecciona (taxpayer-setup). Es el punto de partida, no un
  // cambio del usuario: no marca el borrador con cambios sin guardar.
  useEffect(() => {
    const point = defaultPoint.data?.available ? defaultPoint.data.emissionPoint.id : undefined;
    if (point && !form.getValues("emissionPointId")) {
      form.reset(
        { ...(form.formState.defaultValues as FormValues), emissionPointId: point },
        { keepDirtyValues: true },
      );
    }
  }, [defaultPoint.data, form]);

  useEffect(() => {
    if (operationError) alertRef.current?.focus();
  }, [operationError]);

  // Con cambios sin guardar, cerrar o recargar la pestaña pide confirmación (design D16). Sin
  // cambios no se registra nada, y el aviso se retira en cuanto el borrador queda limpio.
  useEffect(() => {
    if (!isDirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isDirty]);

  // Vista previa del servidor mientras se escribe: el contenido válido, cuando deja de cambiar. Una
  // forma de pago todavía sin elegir no la detiene: la lista «Para emitir» ya dice que falta.
  const parsed = formSchema.safeParse(values);
  const previewValues = {
    ...values,
    payments: (values.payments ?? []).filter((payment) => payment.paymentMethod),
  };
  const previewParsed = formSchema.safeParse(previewValues);
  const inputKey = previewParsed.success ? JSON.stringify(toInput(previewValues)) : null;
  const previewKey = useDebounced(inputKey, 350);
  const preview = useDraftPreview(previewKey ? (JSON.parse(previewKey) as CreateDraftInput) : null);
  const previewData: DraftPreviewView | undefined = preview.data;
  // La vista previa es la del contenido que se ve: ni la anterior ni una pendiente de calcular.
  const fresh =
    previewData !== undefined &&
    !preview.isPlaceholderData &&
    !preview.isError &&
    previewKey === inputKey &&
    inputKey !== null;
  const updating = inputKey !== null && !fresh && !preview.isError;
  const previewInput = previewKey ? (JSON.parse(previewKey) as CreateDraftInput) : null;

  const fail = (error: unknown) => {
    setOperationError({
      message: errorMessage(error),
      ...(error instanceof ApiError ? { code: error.code } : {}),
    });
    return true;
  };

  /** Tras un guardado que el servidor confirma: la versión nueva, sin cambios y en su dirección. */
  const afterSave = (result: DraftView) => {
    setSaved({ id: result.id, version: result.version });
    form.reset(form.getValues());
    queryClient.setQueryData([...DRAFTS_KEY, "detail", result.id], result);
    const path = `/borradores/${result.id}`;
    if (window.location.pathname !== path) window.history.replaceState(null, "", path);
  };

  const persist = (current: SavedDraft | null) => {
    const input = toInput(form.getValues());
    return saveDraftRequest(
      current?.id ?? null,
      current ? { ...input, expectedVersion: current.version } : input,
    );
  };

  const save = useMutationFeedback({
    mutationFn: () => persist(saved),
    success: () => "Guardaste el borrador.",
    invalidate: [[...DRAFTS_KEY, "list"]],
    onSuccess: (result) => {
      setOperationError(undefined);
      afterSave(result);
    },
    onError: fail,
  });
  const emit = useEmitInvoice({ onSuccess: () => {}, onError: () => true });
  const saving = save.isPending;
  const busy = saving || emitPending;

  const onSave = form.handleSubmit(() => {
    setOperationError(undefined);
    save.mutate();
  });

  // Ctrl/⌘ + S guarda el borrador, como en cualquier editor.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "s" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        if (!busy) void onSave();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onSave, busy]);

  /** Emitir: guarda antes si hay cambios o no hay borrador, y emite esa versión. */
  const confirmEmit = async () => {
    if (emitting.current) return;
    emitting.current = true;
    setEmitPending(true);
    setOperationError(undefined);
    try {
      let target = saved;
      if (!target || form.formState.isDirty) {
        const result = await persist(target);
        afterSave(result);
        target = { id: result.id, version: result.version };
      }
      const version = `${target.id}:${target.version}`;
      if (idempotency.current?.version !== version) {
        idempotency.current = { version, key: crypto.randomUUID() };
      }
      const invoice = await emit.mutateAsync({
        draft: target,
        idempotencyKey: idempotency.current.key,
      });
      router.push(`/facturas/${invoice.id}`);
    } catch (error) {
      setConfirming(false);
      // Lo que cambió entre la vista previa y la emisión vuelve a calcularse.
      void queryClient.invalidateQueries({ queryKey: [...DRAFTS_KEY, "preview"] });
      fail(error);
    } finally {
      emitting.current = false;
      setEmitPending(false);
    }
  };

  const reload = async () => {
    if (!saved) return;
    setOperationError(undefined);
    try {
      const fresher = await fetchDraft(saved.id);
      setSaved({ id: fresher.id, version: fresher.version });
      form.reset(toForm(fresher));
      queryClient.setQueryData([...DRAFTS_KEY, "detail", fresher.id], fresher);
    } catch (error) {
      fail(error);
    }
  };

  // Establecimiento y punto en dos selectores dependientes (decisión del propietario,
  // 2026-10-17): el punto se elige entre los del establecimiento elegido. Solo se ofrecen los puntos
  // disponibles, más el guardado aunque haya dejado de estarlo.
  const establishmentChoices = (establishments.data ?? [])
    .map((establishment) => ({
      establishment,
      points: establishment.emissionPoints.filter(
        (point) => point.available || point.id === pointId,
      ),
    }))
    .filter(({ points }) => points.length > 0);
  const establishmentId =
    establishmentChoices.find(({ points }) => points.some((point) => point.id === pointId))
      ?.establishment.id ??
    (establishmentChoice ||
      (establishmentChoices.length === 1 ? establishmentChoices[0]!.establishment.id : ""));
  const chosen = establishmentChoices.find(
    ({ establishment }) => establishment.id === establishmentId,
  );
  const chooseEstablishment = (id: string) => {
    setEstablishmentChoice(id);
    const points = establishmentChoices.find(
      ({ establishment }) => establishment.id === id,
    )?.points;
    if (points?.some((point) => point.id === pointId)) return;
    // Con un solo punto disponible no hay nada que decidir: queda elegido.
    form.setValue("emissionPointId", points?.length === 1 ? points[0]!.id : "", {
      shouldDirty: true,
    });
  };
  const establishmentText = (establishment: { code: string; address: string }) =>
    `${establishment.code} · ${establishment.address}`;
  // Un solo punto en la empresa no es una decisión: se muestra como dato, sin selectores.
  const singlePoint =
    establishmentChoices.length === 1 &&
    establishmentChoices[0]!.points.length === 1 &&
    establishmentChoices[0]!.points[0]!.id === pointId
      ? {
          establishment: establishmentText(establishmentChoices[0]!.establishment),
          point: pointLabel(
            establishmentChoices[0]!.establishment,
            establishmentChoices[0]!.points[0]!,
          ),
        }
      : null;
  const methods = new Map(
    (paymentMethods.data?.entries ?? [])
      .filter((entry) => entry.usable)
      .map((entry) => {
        const official = (entry.applicable ?? entry.versions.at(-1)!).officialLabel;
        return [
          entry.entryKey,
          { code: entry.code, name: paymentMethodName(entry.code, official), official },
        ] as const;
      }),
  );

  const issues = fresh ? previewData.issues : [];
  const lineIssues = (position: number) => issues.filter((issue) => issue.line === position);
  const paymentIssues = (position: number) => issues.filter((issue) => issue.payment === position);
  const headerIssues = issues.filter((issue) => issue.line === null && issue.payment === null);
  const buyerProblem = headerIssues.find(isBuyerIssue)?.message;
  const pointProblem = headerIssues.find(isPointIssue)?.message;
  const paymentsProblem = headerIssues.find(isPaymentsIssue)?.message;
  const generalIssues = headerIssues.filter(
    (issue) =>
      !isBuyerIssue(issue) &&
      !isPointIssue(issue) &&
      !isChecklistIssue(issue) &&
      !isPaymentsIssue(issue),
  );
  const stockWarnings = fresh ? previewData.stockWarnings : [];
  const totals = previewData?.totals ?? null;
  const environment = status.data ? ENVIRONMENT_LABELS[status.data.environment] : null;

  // Lo repartido entre las formas de pago, contra el último total del servidor: el total depende de
  // las líneas, no del pago, así que sirve mientras se reparte.
  const split = payments.fields.length > 1;
  const assigned = (values.payments ?? []).reduce<number | null>((sum, payment) => {
    if (sum === null) return null;
    if (!payment.amount) return sum;
    const cents = toCents(payment.amount);
    return cents === null ? null : sum + cents;
  }, 0);
  const totalCents = totals ? toCents(totals.total) : null;
  const pending = split && assigned !== null && totalCents !== null ? totalCents - assigned : null;

  // Lo que falta para emitir, en palabras del usuario.
  const checks = [
    { key: "buyer", label: "Comprador", ok: buyer !== null },
    { key: "point", label: "Punto de emisión", ok: pointId !== "" },
    { key: "lines", label: "Productos", ok: lines.fields.length > 0 },
    {
      key: "payments",
      label: "Forma de pago",
      ok:
        payments.fields.length > 0 &&
        (values.payments ?? []).every((payment) => payment.paymentMethod) &&
        (!split || pending === 0),
    },
  ];
  const missing = checks.filter((check) => !check.ok);
  const ready = parsed.success && fresh && missing.length === 0 && issues.length === 0;
  const emitReasonId = useId();
  const emitReason = busy
    ? undefined
    : missing.length > 0
      ? `Para emitir falta: ${missing.map((check) => check.label.toLowerCase()).join(", ")}.`
      : !parsed.success
        ? "Corrige los datos marcados antes de emitir."
        : preview.isError
          ? "No pudimos calcular el total. Revisa tu conexión."
          : !fresh
            ? "Calculando el total…"
            : issues.length > 0
              ? "Resuelve lo que se indica en rojo antes de emitir."
              : undefined;
  const saveState: SaveState = saving ? "saving" : saved && !isDirty ? "saved" : "unsaved";

  const recovery =
    operationError?.code === "INVOICE_DRAFT_CHANGED" ? (
      <Button variant="outline" onClick={() => void reload()}>
        Recargar borrador
      </Button>
    ) : operationError?.code === "INVOICE_DRAFT_ALREADY_EMITTED" ? (
      <Button asChild variant="outline">
        <Link href="/facturas">Ver facturas</Link>
      </Button>
    ) : undefined;

  const removeLine = (index: number) => {
    const removed = form.getValues(`lines.${index}`);
    lines.remove(index);
    toast(`Quitaste «${removed.name}».`, {
      action: { label: "Deshacer", onClick: () => lines.insert(index, removed) },
    });
  };
  const removePayment = (index: number) => {
    const removed = form.getValues(`payments.${index}`);
    payments.remove(index);
    // Con una sola forma de pago, el importe vacío cubre el total.
    if (payments.fields.length === 2) form.setValue("payments.0.amount", "", { shouldDirty: true });
    toast("Quitaste una forma de pago.", {
      action: { label: "Deshacer", onClick: () => payments.insert(index, removed) },
    });
  };
  const addPayment = () => {
    // Si las formas de pago ya llevan su importe, la nueva propone lo que falta.
    const filled = split && (values.payments ?? []).every((payment) => payment.amount);
    const proposal = filled && pending !== null && pending > 0 ? fromCents(pending) : "";
    payments.append({ paymentMethod: "", amount: proposal });
  };

  const hasDiscount = totals !== null && compareDecimalStrings(totals.discount, "0") > 0;
  const totalsPanel =
    lines.fields.length === 0 ? (
      <p className="text-sm text-foreground-muted">
        El total aparecerá aquí cuando agregues el primer producto.
      </p>
    ) : totals ? (
      <div
        data-slot="draft-totals"
        aria-busy={updating || undefined}
        className={cn("flex flex-col gap-3 transition-opacity", updating && "opacity-60")}
      >
        <dl className="flex flex-col gap-1.5 text-sm tabular-nums">
          <div className="flex justify-between gap-4">
            <dt className="text-foreground-muted">Subtotal sin impuestos</dt>
            <dd>{formatMoney(totals.withoutTaxes)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-foreground-muted">Descuento</dt>
            {/* El descuento resta: en rojo y con su signo, solo cuando lo hay. */}
            <dd className={cn(hasDiscount && "font-medium text-danger")}>
              {hasDiscount ? `−${formatMoney(totals.discount)}` : formatMoney(totals.discount)}
            </dd>
          </div>
          {totals.taxes.map((tax) => (
            <div key={`${tax.taxCode}-${tax.rateCode}`} className="flex justify-between gap-4">
              <dt className="text-foreground-muted">IVA {formatPercentage(tax.percentage)}</dt>
              <dd>{formatMoney(tax.amount)}</dd>
            </div>
          ))}
        </dl>
        <div className="flex items-baseline justify-between gap-4 border-t pt-3">
          <span className="font-medium">Total</span>
          <span className="text-2xl font-semibold text-money tabular-nums">
            {formatMoney(totals.total)}
          </span>
        </div>
        {split && pending !== null && (
          <dl className="flex flex-col gap-1.5 text-sm tabular-nums">
            <div className="flex justify-between gap-4">
              <dt className="text-foreground-muted">Asignado al pago</dt>
              <dd>{assigned !== null ? formatMoney(fromCents(assigned)) : "—"}</dd>
            </div>
            <div
              className={cn(
                "flex justify-between gap-4",
                pending !== 0 && "font-medium",
                pending === 0 && "text-success",
                pending < 0 && "text-danger",
              )}
            >
              <dt className="flex items-center gap-1.5">
                {pending > 0 && (
                  <TriangleAlert aria-hidden="true" className="size-4 shrink-0 text-warning" />
                )}
                {pending < 0 ? "Asignado de más" : "Pendiente"}
              </dt>
              <dd>{formatMoney(fromCents(Math.abs(pending)))}</dd>
            </div>
          </dl>
        )}
      </div>
    ) : (
      <p className="text-sm text-foreground-muted">
        {updating
          ? "Calculando el total…"
          : preview.isError
            ? "No pudimos calcular el total."
            : "El total aparece cuando todas las líneas se pueden calcular."}
      </p>
    );

  const emitButton = canEmit ? (
    <Button
      key="emitir"
      size="default"
      variant="primary"
      disabled={!ready || busy}
      aria-describedby={emitReason ? emitReasonId : undefined}
      onClick={() => setConfirming(true)}
    >
      <Send aria-hidden="true" data-icon="inline-start" />
      Emitir factura
    </Button>
  ) : null;
  const saveButton = (
    <AsyncButton
      key="guardar"
      type="submit"
      size="default"
      variant={canEmit ? "outline" : "primary"}
      pending={saving}
      pendingLabel="Guardando el borrador"
      disabled={emitPending}
    >
      <Save aria-hidden="true" data-icon="inline-start" />
      Guardar borrador
    </AsyncButton>
  );

  return (
    <section aria-labelledby="editor-titulo" className="flex flex-col gap-6">
      <PageHeader
        variant="editor"
        title={saved ? "Borrador de factura" : "Nueva factura"}
        titleId="editor-titulo"
      />

      {operationError && (
        <OperationAlert message={operationError.message} action={recovery} alertRef={alertRef} />
      )}

      <form noValidate onSubmit={onSave}>
        <FormLayout
          panel={
            <StickySummaryPanel title="Resumen" aside={<SaveStatus state={saveState} />}>
              {lines.fields.length > 0 && (
                <p className="flex items-center gap-2 text-sm text-foreground-muted">
                  {lines.fields.length === 1 ? "1 producto" : `${lines.fields.length} productos`}
                  {updating && (
                    <span role="status" className="flex items-center gap-1 text-xs">
                      <LoaderCircle
                        aria-hidden="true"
                        className="size-3 motion-safe:animate-spin"
                      />
                      Actualizando
                    </span>
                  )}
                </p>
              )}
              {totalsPanel}
              {missing.length > 0 && (
                <div data-slot="emit-checklist" className="flex flex-col gap-1.5">
                  <h3 className="text-sm font-medium">Para emitir</h3>
                  <ul className="flex flex-col gap-1 text-sm">
                    {checks.map((check) => (
                      <li key={check.key} className="flex items-center gap-2">
                        {check.ok ? (
                          <CircleCheck aria-hidden="true" className="size-4 text-success" />
                        ) : (
                          <CircleDashed aria-hidden="true" className="size-4 text-warning" />
                        )}
                        <span className={cn(check.ok ? "text-foreground-muted" : "font-medium")}>
                          {check.label}
                        </span>
                        <span className="sr-only">{check.ok ? ": listo" : ": falta"}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {generalIssues.length > 0 && (
                <div className="flex flex-col gap-1">
                  <h3 className="text-sm font-medium">Antes de emitir</h3>
                  <IssueList issues={generalIssues} />
                </div>
              )}
              <p className="text-xs text-foreground-muted">
                Vista previa sin validez fiscal: el comprobante toma los importes al emitirse.
              </p>
            </StickySummaryPanel>
          }
          actions={
            <StickyFormActions
              notice={
                <>
                  {canEmit && (
                    <EmissionEnvironmentNotice
                      document="factura"
                      className="@max-form-rail:py-1 @max-form-rail:text-xs"
                    />
                  )}
                  {/* Apilado, la barra del pie lleva el total para no perderlo de vista. */}
                  {totals && lines.fields.length > 0 && (
                    <p className="flex items-baseline justify-between text-sm @form-rail:hidden">
                      <span className="text-foreground-muted">Total</span>
                      <span className="text-lg font-semibold text-money tabular-nums">
                        {formatMoney(totals.total)}
                      </span>
                    </p>
                  )}
                </>
              }
              reason={canEmit ? emitReason : undefined}
              reasonId={emitReasonId}
            >
              {[emitButton, saveButton]}
            </StickyFormActions>
          }
        >
          {/* Mientras se guarda o se emite, el formulario no se edita: lo persistido es lo que se ve. */}
          <fieldset
            disabled={busy}
            aria-busy={busy || undefined}
            className="contents"
            data-slot="draft-fields"
          >
            <FormSection title="Datos de la factura">
              <div className="flex flex-col gap-4">
                <BuyerCard
                  buyer={buyer}
                  problem={buyerProblem}
                  onPick={() => setPickingBuyer(true)}
                  onConsumerFinal={chooseConsumerFinal}
                  consumerPending={consumerPending}
                />
                {singlePoint ? (
                  <div className="grid gap-4 @form-wide:grid-cols-2">
                    <div className="flex flex-col gap-1">
                      <span className="text-sm font-medium">Establecimiento</span>
                      <p className="text-sm text-foreground-muted">{singlePoint.establishment}</p>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-sm font-medium">Punto de emisión</span>
                      <p className="text-sm text-foreground-muted tabular-nums">
                        {singlePoint.point}
                      </p>
                      {pointProblem && <p className="text-xs text-danger">{pointProblem}</p>}
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-4 @form-wide:grid-cols-2">
                    <FormField id="establecimiento" label="Establecimiento">
                      <Select
                        id="establecimiento"
                        value={establishmentId}
                        onChange={(event) => chooseEstablishment(event.target.value)}
                      >
                        <option value="">Elige un establecimiento</option>
                        {establishmentChoices.map(({ establishment }) => (
                          <option key={establishment.id} value={establishment.id}>
                            {establishmentText(establishment)}
                          </option>
                        ))}
                      </Select>
                    </FormField>
                    <FormField id="punto" label="Punto de emisión" problem={pointProblem}>
                      <Select
                        {...fieldAria("punto", undefined, undefined, pointProblem)}
                        value={pointId}
                        disabled={!chosen}
                        onChange={(event) =>
                          form.setValue("emissionPointId", event.target.value, {
                            shouldDirty: true,
                          })
                        }
                      >
                        <option value="">
                          {chosen ? "Elige un punto" : "Elige primero el establecimiento"}
                        </option>
                        {chosen?.points.map((point) => (
                          <option key={point.id} value={point.id}>
                            {pointLabel(chosen.establishment, point)}
                            {point.available ? "" : " (no disponible)"}
                          </option>
                        ))}
                      </Select>
                    </FormField>
                  </div>
                )}
              </div>
            </FormSection>

            <FormSection
              title="Productos"
              action={
                lines.fields.length > 0 ? (
                  <Button variant="primary" size="default" onClick={() => setPickingProduct(true)}>
                    <PackagePlus aria-hidden="true" data-icon="inline-start" />
                    Agregar producto
                  </Button>
                ) : undefined
              }
            >
              {lines.fields.length === 0 ? (
                <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-8 text-center">
                  <PackagePlus aria-hidden="true" className="size-6 text-foreground-muted" />
                  <p className="text-sm text-foreground-muted">
                    Todavía no hay productos en esta factura.
                  </p>
                  <Button variant="primary" size="default" onClick={() => setPickingProduct(true)}>
                    <PackagePlus aria-hidden="true" data-icon="inline-start" />
                    Agregar producto
                  </Button>
                </div>
              ) : (
                <div className="@container">
                  {/* Encabezados visibles desde 40rem de contenedor; las etiquetas siguen en cada
                      campo para las tecnologías de asistencia. Los números van a la derecha. */}
                  <div
                    aria-hidden="true"
                    className="hidden gap-x-3 border-b pb-2 text-xs font-medium text-foreground-muted @form-wide:grid @form-wide:grid-cols-invoice-lines"
                  >
                    <span>Producto</span>
                    <span className="text-right">Cant.</span>
                    <span className="text-right">Precio unit.</span>
                    <span className="text-right">Desc. (USD)</span>
                    <span className="text-right">IVA</span>
                    <span className="text-right">Subtotal</span>
                    <span />
                  </div>
                  <ul className="flex flex-col">
                    {lines.fields.map((field, index) => {
                      const position = index + 1;
                      const lineError = errors.lines?.[index];
                      const problems = lineIssues(position);
                      // El aviso suma todas las líneas del producto: se muestra junto a la última.
                      const lastOfProduct = !lines.fields
                        .slice(index + 1)
                        .some((other) => other.productId === field.productId);
                      const warning = lastOfProduct
                        ? stockWarnings.find((candidate) => candidate.productId === field.productId)
                        : undefined;
                      // El cálculo del servidor de esta línea; mientras llega el nuevo, el anterior
                      // atenuado, solo si la línea sigue siendo el mismo producto.
                      const sameLine = previewInput?.lines?.[index]?.productId === field.productId;
                      const computed = sameLine
                        ? previewData?.lines.find((line) => line.position === position)
                        : undefined;
                      const iva = computed?.taxes.find((tax) => tax.taxCode === "2");
                      const stale = !fresh && computed !== undefined;
                      const subtotal = computed ? (
                        formatMoney(computed.taxableBase)
                      ) : (
                        <>
                          <span aria-hidden="true">—</span>
                          <span className="sr-only">calculando</span>
                        </>
                      );
                      return (
                        <li
                          key={field.id}
                          aria-label={`Línea ${position}: ${field.name}`}
                          aria-invalid={problems.length > 0 || undefined}
                          className="grid grid-cols-3 gap-x-3 gap-y-2 border-b py-3 last:border-b-0 aria-invalid:bg-danger/5 @form-wide:grid-cols-invoice-lines @form-wide:items-start"
                        >
                          <div className="col-span-2 flex min-w-0 flex-col @form-wide:col-span-1 @form-wide:min-h-10 @form-wide:justify-center">
                            <span className="font-medium break-words">{field.name}</span>
                            <span className="flex flex-wrap items-center gap-x-1.5 text-xs text-foreground-muted tabular-nums">
                              {field.mainCode && (
                                <code className="rounded-sm bg-muted px-1 py-0.5 font-mono">
                                  {field.mainCode}
                                </code>
                              )}
                              <span className="@form-wide:hidden">
                                {formatMoney(field.unitPrice)} c/u
                                {iva ? ` · IVA ${formatPercentage(iva.percentage)}` : ""}
                              </span>
                            </span>
                          </div>
                          <FormField
                            id={`cantidad-${index}`}
                            label="Cantidad"
                            labelClassName="@form-wide:sr-only"
                            error={lineError?.quantity?.message}
                          >
                            <Input
                              inputMode="decimal"
                              className="text-right tabular-nums"
                              {...fieldAria(`cantidad-${index}`, lineError?.quantity?.message)}
                              {...form.register(`lines.${index}.quantity`)}
                            />
                          </FormField>
                          <span className="hidden h-10 items-center justify-end text-sm tabular-nums @form-wide:flex">
                            {formatMoney(field.unitPrice)}
                          </span>
                          <FormField
                            id={`descuento-${index}`}
                            label="Descuento (USD)"
                            labelClassName="@form-wide:sr-only"
                            error={lineError?.discount?.message}
                          >
                            <Input
                              inputMode="decimal"
                              placeholder="0,00"
                              className="text-right tabular-nums"
                              {...fieldAria(`descuento-${index}`, lineError?.discount?.message)}
                              {...form.register(`lines.${index}.discount`)}
                            />
                          </FormField>
                          <span className="hidden h-10 items-center justify-end text-sm tabular-nums @form-wide:flex">
                            {iva ? (
                              <span className="rounded-full bg-info/10 px-2 py-0.5 text-xs font-medium text-info">
                                {formatPercentage(iva.percentage)}
                              </span>
                            ) : (
                              <span className="text-foreground-muted">—</span>
                            )}
                          </span>
                          <div className="flex flex-col gap-1 @form-wide:contents">
                            <span className="text-sm font-medium @form-wide:hidden">Subtotal</span>
                            <span
                              className={cn(
                                "flex h-10 items-center justify-end text-sm font-semibold tabular-nums transition-opacity max-md:h-11",
                                computed && "text-money",
                                stale && "opacity-50",
                              )}
                            >
                              {subtotal}
                            </span>
                          </div>
                          {/* Quitar va al final del orden del teclado (cantidad, descuento y quitar);
                              la rejilla lo coloca arriba a la derecha. */}
                          <div className="col-start-3 row-start-1 flex justify-end @form-wide:col-start-7 @form-wide:min-h-10 @form-wide:items-center @form-wide:justify-center">
                            <RowActionButton
                              icon={Trash2}
                              tone="danger"
                              label={`Quitar ${field.name}`}
                              onClick={() => removeLine(index)}
                            />
                          </div>
                          {(problems.length > 0 || warning) && (
                            <div className="col-span-full flex flex-col gap-2">
                              <IssueList issues={problems} />
                              {warning && <StockWarningNote warning={warning} />}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </FormSection>

            {/* El pago se pide cuando ya hay algo que cobrar. */}
            {lines.fields.length > 0 && (
              <FormSection
                title="Formas de pago"
                description={split ? "Reparte el total entre las formas de pago." : undefined}
              >
                <div className="@container flex flex-col gap-4">
                  {payments.fields.map((field, index) => {
                    const position = index + 1;
                    const paymentError = errors.payments?.[index];
                    const problems = paymentIssues(position);
                    const current = values.payments?.[index];
                    const method = current?.paymentMethod
                      ? methods.get(current.paymentMethod)
                      : undefined;
                    const methodHint = method
                      ? `SRI ${method.code} · ${sentenceCase(method.official)}`
                      : undefined;
                    return (
                      <fieldset
                        key={field.id}
                        aria-label={`Forma de pago ${position}`}
                        className="grid gap-x-4 gap-y-2 @form-wide:grid-cols-payment @form-wide:items-start"
                      >
                        <FormField
                          id={`forma-${index}`}
                          label="Forma de pago"
                          {...(methodHint ? { hint: methodHint } : {})}
                          error={paymentError?.paymentMethod?.message}
                        >
                          <Controller
                            control={form.control}
                            name={`payments.${index}.paymentMethod`}
                            render={({ field: select }) => (
                              <Select
                                {...fieldAria(
                                  `forma-${index}`,
                                  paymentError?.paymentMethod?.message,
                                  methodHint,
                                )}
                                value={select.value}
                                onChange={select.onChange}
                                onBlur={select.onBlur}
                                ref={select.ref}
                              >
                                <option value="">Elige la forma de pago</option>
                                {[...methods].map(([value, option]) => (
                                  <option key={value} value={value}>
                                    {option.name}
                                  </option>
                                ))}
                              </Select>
                            )}
                          />
                        </FormField>
                        {split ? (
                          <FormField
                            id={`importe-${index}`}
                            label="Importe (USD)"
                            error={paymentError?.amount?.message}
                            problem={problems[0]?.message}
                            action={
                              <RowActionButton
                                icon={Trash2}
                                tone="danger"
                                label={`Quitar la forma de pago ${position}${method ? ` (${method.name})` : ""}`}
                                onClick={() => removePayment(index)}
                              />
                            }
                          >
                            <Input
                              inputMode="decimal"
                              placeholder="0,00"
                              className="text-right tabular-nums"
                              {...fieldAria(
                                `importe-${index}`,
                                paymentError?.amount?.message,
                                undefined,
                                problems[0]?.message,
                              )}
                              {...form.register(`payments.${index}.amount`)}
                            />
                          </FormField>
                        ) : (
                          <div className="flex flex-col gap-1">
                            <span className="text-sm font-medium">Importe</span>
                            <span
                              className={cn(
                                "flex h-10 items-center justify-end text-sm font-semibold tabular-nums max-md:h-11",
                                totals && "text-money",
                              )}
                            >
                              {totals ? formatMoney(totals.total) : "—"}
                            </span>
                            <span className="text-right text-xs text-foreground-muted">
                              El total de la factura
                            </span>
                          </div>
                        )}
                        {split && !current?.amount && pending !== null && pending > 0 && (
                          <Button
                            variant="link"
                            size="xs"
                            className="justify-self-end @form-wide:col-start-2"
                            onClick={() =>
                              form.setValue(`payments.${index}.amount`, fromCents(pending), {
                                shouldDirty: true,
                                shouldValidate: true,
                              })
                            }
                          >
                            Asignar lo pendiente ({formatMoney(fromCents(pending))})
                          </Button>
                        )}
                        {!split && problems.length > 0 && (
                          <div className="col-span-full">
                            <IssueList issues={problems} />
                          </div>
                        )}
                      </fieldset>
                    );
                  })}
                  <div className="flex flex-col gap-2">
                    {/* A todo el ancho y punteado: se ve como el lugar donde nace otra forma de pago
                        (decisión del propietario, 2026-10-22). */}
                    <Button
                      variant="outline"
                      size="default"
                      className="h-12 w-full border-dashed hover:border-primary/50 hover:bg-transparent hover:bg-linear-to-r hover:from-primary/15 hover:via-primary/5 hover:to-primary/15 hover:text-primary max-md:h-12"
                      onClick={addPayment}
                    >
                      {split ? (
                        <Plus aria-hidden="true" data-icon="inline-start" />
                      ) : (
                        <Split aria-hidden="true" data-icon="inline-start" />
                      )}
                      {split ? "Agregar otra forma de pago" : "Dividir el pago"}
                    </Button>
                    {split && pending !== null && (
                      <p
                        role="status"
                        className={cn(
                          "flex items-center gap-1.5 text-sm font-medium tabular-nums",
                          pending === 0 && "text-success",
                          pending < 0 && "text-danger",
                        )}
                      >
                        {pending === 0 ? (
                          <CircleCheck aria-hidden="true" className="size-4 shrink-0" />
                        ) : (
                          <TriangleAlert
                            aria-hidden="true"
                            className={cn("size-4 shrink-0", pending > 0 && "text-warning")}
                          />
                        )}
                        {pending === 0
                          ? "El pago cubre el total."
                          : pending > 0
                            ? `Faltan ${formatMoney(fromCents(pending))} por asignar.`
                            : `Asignaste ${formatMoney(fromCents(-pending))} más que el total.`}
                      </p>
                    )}
                  </div>
                  {paymentsProblem && pending === null && (
                    <p className="text-sm text-danger">{paymentsProblem}</p>
                  )}
                </div>
              </FormSection>
            )}
          </fieldset>
        </FormLayout>
      </form>

      <EntityPickerDialog<PartyView>
        open={pickingBuyer}
        onOpenChange={setPickingBuyer}
        title="Elegir comprador"
        searchLabel="Buscar por nombre o identificación"
        searchPlaceholder="Nombre, cédula o RUC"
        queryKey={["parties", "customers"]}
        fetchPage={fetchCustomers}
        getKey={(party) => party.id}
        getLabel={(party) =>
          `${party.legalName} · ${identificationText(party.identificationType, party.identification)}`
        }
        renderItem={(party) => (
          <span className="flex flex-col">
            <span className="font-medium">{party.legalName}</span>
            <span className="text-sm text-foreground-muted tabular-nums">
              {identificationText(party.identificationType, party.identification)}
            </span>
          </span>
        )}
        onSelect={(party) =>
          form.setValue("buyer", asBuyer(party), { shouldDirty: true, shouldValidate: true })
        }
        quickOption={{
          label: "Consumidor final",
          description: "Sin identificar al comprador, hasta el monto máximo vigente.",
          highlight: true,
          onSelect: chooseConsumerFinal,
        }}
        emptyTitle="Todavía no hay clientes"
        emptyDescription="Registra al comprador en Terceros con el rol de cliente."
      />
      <ProductPickerDialog
        open={pickingProduct}
        onOpenChange={setPickingProduct}
        inInvoice={new Set(lines.fields.map((field) => field.productId))}
        onAdd={(products) => {
          addedLine.current = lines.fields.length;
          lines.append(
            products.map((product) => ({
              productId: product.id,
              name: product.name,
              mainCode: product.mainCode,
              unitPrice: product.unitPrice,
              quantity: "1",
              discount: "",
            })),
            { shouldFocus: false },
          );
        }}
        onCloseAutoFocus={(event) => {
          // Para cargar rápido con el teclado, el foco va a la cantidad de la primera línea nueva.
          if (addedLine.current === null) return;
          event.preventDefault();
          form.setFocus(`lines.${addedLine.current}.quantity`, { shouldSelect: true });
          addedLine.current = null;
        }}
      />

      <ConfirmDialog
        open={confirming}
        onOpenChange={(open) => {
          if (!emitPending) setConfirming(open);
        }}
        title="Emitir factura"
        confirmLabel="Emitir factura"
        pending={emitPending}
        onConfirm={() => void confirmEmit()}
        description={
          <div className="flex flex-col gap-3">
            <p>La emisión reserva el número de la factura y la firma; no se puede deshacer.</p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-foreground">
              <dt className="text-foreground-muted">Comprador</dt>
              <dd className="break-words">
                {buyer ? (
                  <>
                    {buyer.legalName}
                    <span className="block text-xs text-foreground-muted tabular-nums">
                      {buyer.consumerFinal
                        ? `Consumidor final · ${buyer.identification}`
                        : identificationText(buyer.identificationType, buyer.identification)}
                    </span>
                  </>
                ) : (
                  "—"
                )}
              </dd>
              <dt className="text-foreground-muted">Productos</dt>
              <dd className="tabular-nums">{lines.fields.length}</dd>
              <dt className="text-foreground-muted">Pago</dt>
              <dd>
                {(values.payments ?? []).map((payment, index) => {
                  const name = methods.get(payment.paymentMethod)?.name ?? payment.paymentMethod;
                  return (
                    <span key={index} className="block tabular-nums">
                      {name}
                      {split && payment.amount
                        ? ` · ${formatMoney(normalizeDecimal(payment.amount))}`
                        : ""}
                    </span>
                  );
                })}
              </dd>
              <dt className="text-foreground-muted">Ambiente</dt>
              <dd>{environment ?? "Desconocido"}</dd>
              <dt className="font-medium text-foreground">Total</dt>
              <dd className={cn("text-lg font-semibold tabular-nums", totals && "text-money")}>
                {totals ? formatMoney(totals.total) : "—"}
              </dd>
            </dl>
            <EmissionEnvironmentNotice document="factura" />
            {buyer?.consumerFinal && (
              <p className="rounded-md border border-warning/40 bg-warning/10 px-2 py-1 text-foreground">
                Una factura a consumidor final tiene restricciones para anularse o corregirse con
                una nota de crédito. Si el cliente necesita la factura a su nombre, identifícalo
                antes de emitir.
              </p>
            )}
          </div>
        }
      />
    </section>
  );
}

/** Encabezado de los estados del editor: el mismo `PageHeader` de editor. */
function EditorStateHeader() {
  return <PageHeader variant="editor" title="Borrador de factura" titleId="editor-titulo" />;
}

/** Editor de un borrador existente (`draftId`) o de uno nuevo (`null`). */
export function DraftEditorScreen({ draftId }: { draftId: string | null }) {
  const { me } = useSession();
  const allowed = canSee(me.role, "invoices.draft");
  const canEmit = canSee(me.role, "invoices.emit");
  const draft = useDraft(draftId, allowed);

  if (!allowed) {
    return (
      <section aria-labelledby="editor-titulo" className="flex flex-col gap-6">
        <EditorStateHeader />
        <EmptyState
          kind="no-permission"
          title="No tienes acceso a los borradores"
          description="Pide a un administrador que revise tu rol."
        />
      </section>
    );
  }
  if (draftId && draft.isPending) return <DraftEditorSkeleton />;
  if (draftId && draft.isError) {
    const error = draft.error;
    const emitted = error instanceof ApiError && error.code === "INVOICE_DRAFT_ALREADY_EMITTED";
    // Un borrador de otra empresa es, para esta, inexistente: el servidor responde 404.
    const missing = error instanceof ApiError && error.status === 404;
    return (
      <section aria-labelledby="editor-titulo" className="flex flex-col gap-6">
        <EditorStateHeader />
        {emitted || missing ? (
          <EmptyState
            kind="empty"
            title={emitted ? "Este borrador ya se emitió" : "El borrador no existe"}
            description={
              emitted
                ? "Encuéntralo en Facturas: un borrador emitido ya no se corrige."
                : "Puede que se haya eliminado."
            }
            action={
              <Button asChild variant="outline">
                <Link href={emitted ? "/facturas" : "/facturas?estado=borradores"}>
                  {emitted ? "Ver facturas" : "Ver borradores"}
                </Link>
              </Button>
            }
          />
        ) : (
          <ErrorState
            message="No pudimos cargar el borrador."
            onRetry={() => void draft.refetch()}
          />
        )}
      </section>
    );
  }
  const data = draftId ? (draft.data ?? null) : null;
  // Un editor por borrador: sus guardados no lo vuelven a montar, porque el editor lleva su versión.
  return <DraftEditor key={data ? data.id : "nuevo"} draft={data} canEmit={canEmit} />;
}

/** Carga sin saltos: el mismo encabezado y la misma distribución que el editor. */
export function DraftEditorSkeleton() {
  return (
    <section aria-busy="true" aria-labelledby="editor-titulo" className="flex flex-col gap-6">
      <EditorStateHeader />
      <span className="sr-only" role="status">
        Cargando el borrador
      </span>
      <FormLayout panel={<Skeleton className="h-48 w-full rounded-xl" />}>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-24 w-full" />
      </FormLayout>
    </section>
  );
}
