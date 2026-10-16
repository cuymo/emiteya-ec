// Empresa (add-taxpayer-setup, design D14). Usuario: administrador. Objetivo: registrar o corregir
// los datos con que la empresa emite. Decisión: qué datos y atributos declarar, sabiendo que cada
// cambio aplica a los comprobantes futuros. Acción principal: Guardar datos. P1: estado del RUC y
// versión vigente. P2: logo, en Identificación. P3 (historial): fuera de la pantalla. La pestaña
// ya nombra la pantalla: el título queda solo para los lectores de pantalla, y cada sección lleva
// su título y su descripción a la izquierda de sus campos.
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  taxpayerProfileShape,
  type TaxpayerView,
  type UpdateTaxpayerInput,
} from "@facturador/contracts";
import { Lock } from "lucide-react";
import { useState, type ComponentProps, type ReactNode } from "react";
import { Controller, useForm, useWatch, type DefaultValues } from "react-hook-form";
import { z } from "zod";
import { AsyncButton } from "@/components/async-button";
import { errorMessage } from "@/components/feedback";
import { fieldAria, FormField } from "@/components/form-dialog";
import { SegmentedControl } from "@/components/segmented-control";
import { SelectionCardGroup } from "@/components/selection-card-group";
import { useSession } from "@/components/session";
import { EmptyState, ErrorState, Skeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api";
import { canSee } from "@/lib/permissions";
import { useTaxpayer, useUpdateTaxpayer } from "./company-api";
import { LogoField } from "./logo-field";

const RIMPE_OPTIONS = [
  { value: "NONE", label: "No aplica", description: "La empresa no está en el régimen RIMPE." },
  {
    value: "EMPRENDEDOR",
    label: "Emprendedor",
    description: "Régimen RIMPE para emprendedores.",
  },
  {
    value: "NEGOCIO_POPULAR",
    label: "Negocio popular",
    description: "Régimen RIMPE para negocios populares.",
  },
] as const;

const ACCOUNTING_OPTIONS = [
  { value: "SI", label: "Sí" },
  { value: "NO", label: "No" },
] as const;

/** Los opcionales condicionados por una casilla: con la casilla marcada, el número es obligatorio. */
function requireWhen(
  ctx: z.RefinementCtx,
  enabled: boolean,
  value: string,
  schema: z.ZodType,
  path: string,
  missing: string,
) {
  if (!enabled) return;
  const result = schema.safeParse(value);
  if (!result.success) {
    ctx.addIssue({ code: "custom", path: [path], message: result.error.issues[0]!.message });
  } else if (result.data === null) {
    ctx.addIssue({ code: "custom", path: [path], message: missing });
  }
}

// Las reglas de cada campo son las del contrato (XSD oficiales, design D3); aquí solo se añaden
// las casillas que revelan los números y la elección explícita de contabilidad.
const formSchema = z
  .object({
    ruc: taxpayerProfileShape.ruc,
    legalName: taxpayerProfileShape.legalName,
    tradeName: taxpayerProfileShape.tradeName,
    headOfficeAddress: taxpayerProfileShape.headOfficeAddress,
    phone: taxpayerProfileShape.phone,
    email: taxpayerProfileShape.email,
    accountingRequired: z.enum(["SI", "NO"], {
      error: "Indica si la empresa está obligada a llevar contabilidad.",
    }),
    isSpecialTaxpayer: z.boolean(),
    specialTaxpayerNumber: z.string(),
    isWithholdingAgent: z.boolean(),
    withholdingAgentResolution: z.string(),
    largeTaxpayer: z.boolean(),
    rimpeCategory: z.enum(["NONE", "EMPRENDEDOR", "NEGOCIO_POPULAR"]),
    providerRuc: taxpayerProfileShape.providerRuc,
  })
  .superRefine((values, ctx) => {
    requireWhen(
      ctx,
      values.isSpecialTaxpayer,
      values.specialTaxpayerNumber,
      taxpayerProfileShape.specialTaxpayerNumber,
      "specialTaxpayerNumber",
      "Escribe el número de contribuyente especial.",
    );
    requireWhen(
      ctx,
      values.isWithholdingAgent,
      values.withholdingAgentResolution,
      taxpayerProfileShape.withholdingAgentResolution,
      "withholdingAgentResolution",
      "Escribe el número de resolución de agente de retención.",
    );
  });

type FormInput = z.input<typeof formSchema>;
type FormOutput = z.output<typeof formSchema>;

function toFormValues(view: TaxpayerView): DefaultValues<FormInput> {
  const profile = view.profile;
  return {
    ruc: profile?.ruc ?? "",
    legalName: profile?.legalName ?? "",
    tradeName: profile?.tradeName ?? "",
    headOfficeAddress: profile?.headOfficeAddress ?? "",
    phone: profile?.phone ?? "",
    email: profile?.email ?? "",
    // Sin datos registrados no hay preselección: se declara, no se infiere (ERS RF-103).
    accountingRequired: profile ? (profile.accountingRequired ? "SI" : "NO") : undefined,
    isSpecialTaxpayer: Boolean(profile?.specialTaxpayerNumber),
    specialTaxpayerNumber: profile?.specialTaxpayerNumber ?? "",
    isWithholdingAgent: Boolean(profile?.withholdingAgentResolution),
    withholdingAgentResolution: profile?.withholdingAgentResolution ?? "",
    largeTaxpayer: profile?.largeTaxpayer ?? false,
    rimpeCategory: profile?.rimpeCategory ?? "NONE",
    providerRuc: profile?.providerRuc ?? "",
  };
}

function toInput(values: FormOutput, expectedVersion: number | null): UpdateTaxpayerInput {
  return {
    ruc: values.ruc,
    legalName: values.legalName,
    tradeName: values.tradeName,
    headOfficeAddress: values.headOfficeAddress,
    phone: values.phone,
    email: values.email,
    accountingRequired: values.accountingRequired === "SI",
    specialTaxpayerNumber: values.isSpecialTaxpayer ? values.specialTaxpayerNumber : null,
    withholdingAgentResolution: values.isWithholdingAgent
      ? values.withholdingAgentResolution
      : null,
    largeTaxpayer: values.largeTaxpayer,
    rimpeCategory: values.rimpeCategory === "NONE" ? null : values.rimpeCategory,
    providerRuc: values.providerRuc,
    expectedVersion,
  };
}

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="grid gap-4 py-8 first:pt-0 @settings-split:grid-cols-3 @settings-split:gap-8"
    >
      <div className="flex flex-col gap-1">
        <h2 id={id} className="text-base font-semibold">
          {title}
        </h2>
        <p className="text-sm text-foreground-muted">{description}</p>
      </div>
      <div className="flex min-w-0 flex-col gap-4 @settings-split:col-span-2">{children}</div>
    </section>
  );
}

function Checkbox({
  id,
  label,
  ...props
}: { id: string; label: string } & ComponentProps<"input">) {
  return (
    <label htmlFor={id} className="flex min-h-8 items-center gap-2 text-sm">
      <input id={id} type="checkbox" className="size-4 accent-primary" {...props} />
      {label}
    </label>
  );
}

function CompanyForm({ taxpayer }: { taxpayer: TaxpayerView }) {
  // La versión de la que parte el formulario: la que se cargó, no la última que llegó después.
  const [baseVersion, setBaseVersion] = useState(taxpayer.version);
  const [conflict, setConflict] = useState(false);
  const query = useTaxpayer();
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(formSchema),
    defaultValues: toFormValues(taxpayer),
  });
  const { errors } = form.formState;
  const locked = taxpayer.taxIdentityLocked;

  const reload = async () => {
    const fresh = await query.refetch();
    if (fresh.data) {
      form.reset(toFormValues(fresh.data));
      setBaseVersion(fresh.data.version);
    }
    setConflict(false);
  };

  const save = useUpdateTaxpayer({
    onSuccess: (view) => {
      form.reset(toFormValues(view));
      setBaseVersion(view.version);
    },
    onError: (cause) => {
      if (cause instanceof ApiError && cause.code === "CONFIG_VERSION_CONFLICT") {
        setConflict(true);
        return true;
      }
      if (cause instanceof ApiError && cause.code === "TAX_IDENTITY_LOCKED") {
        form.setError("ruc", { message: cause.message }, { shouldFocus: true });
        void query.refetch();
        return true;
      }
      return false;
    },
  });

  const isSpecial = useWatch({ control: form.control, name: "isSpecialTaxpayer" });
  const isWithholding = useWatch({ control: form.control, name: "isWithholdingAgent" });

  return (
    <form
      noValidate
      aria-label="Datos de la empresa"
      onSubmit={form.handleSubmit((values) => save.mutate(toInput(values, baseVersion)))}
      className="@container flex flex-col gap-6"
    >
      <div className="flex flex-col divide-y divide-border">
        <Section
          id="identificacion"
          title="Identificación"
          description="Con estos datos y este logo la empresa aparece en sus comprobantes."
        >
          <LogoField
            taxpayer={taxpayer}
            onVersionChange={(previous, next) => {
              // Un cambio propio del logo avanza la versión de partida solo si nadie más cambió nada.
              setBaseVersion((current) => (current === previous ? next : current));
            }}
          />
          {locked ? (
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium">RUC</span>
              <span className="text-base">{taxpayer.profile?.ruc}</span>
              <p className="flex items-center gap-1 text-xs text-foreground-muted">
                <Lock aria-hidden="true" className="size-3" />
                El RUC ya no puede cambiar en esta empresa. Para emitir con otro RUC se necesita
                otra empresa.
              </p>
            </div>
          ) : (
            <FormField
              id="ruc"
              label="RUC"
              hint="Puedes corregir el RUC hasta que se use en un comprobante."
              error={errors.ruc?.message}
            >
              <Input
                {...fieldAria(
                  "ruc",
                  errors.ruc?.message,
                  "Puedes corregir el RUC hasta que se use en un comprobante.",
                )}
                {...form.register("ruc")}
                inputMode="numeric"
                autoComplete="off"
                className="max-w-xs"
              />
            </FormField>
          )}
          <FormField id="legalName" label="Razón social" error={errors.legalName?.message}>
            <Input
              {...fieldAria("legalName", errors.legalName?.message)}
              {...form.register("legalName")}
              autoComplete="organization"
            />
          </FormField>
          <FormField
            id="tradeName"
            label="Nombre comercial (opcional)"
            error={errors.tradeName?.message}
          >
            <Input
              {...fieldAria("tradeName", errors.tradeName?.message)}
              {...form.register("tradeName")}
            />
          </FormField>
        </Section>

        <Section
          id="contacto"
          title="Dirección y contacto"
          description="La dirección matriz va en cada comprobante; el teléfono y el correo, si los registras."
        >
          <FormField
            id="headOfficeAddress"
            label="Dirección matriz"
            error={errors.headOfficeAddress?.message}
          >
            <Input
              {...fieldAria("headOfficeAddress", errors.headOfficeAddress?.message)}
              {...form.register("headOfficeAddress")}
              autoComplete="street-address"
            />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="phone" label="Teléfono (opcional)" error={errors.phone?.message}>
              <Input
                {...fieldAria("phone", errors.phone?.message)}
                {...form.register("phone")}
                inputMode="tel"
                autoComplete="tel"
              />
            </FormField>
            <FormField id="email" label="Correo (opcional)" error={errors.email?.message}>
              <Input
                {...fieldAria("email", errors.email?.message)}
                {...form.register("email")}
                type="email"
                autoComplete="email"
              />
            </FormField>
          </div>
        </Section>

        <Section
          id="atributos"
          title="Atributos tributarios"
          description="Lo que declaras aquí se imprime en los comprobantes y define cómo se emiten."
        >
          <div className="flex flex-col gap-1">
            <span id="accounting-label" className="text-sm font-medium">
              Obligada a llevar contabilidad
            </span>
            <Controller
              control={form.control}
              name="accountingRequired"
              render={({ field }) => (
                <SegmentedControl
                  options={ACCOUNTING_OPTIONS}
                  value={field.value}
                  onChange={field.onChange}
                  aria-labelledby="accounting-label"
                  aria-invalid={Boolean(errors.accountingRequired)}
                  {...(errors.accountingRequired ? { "aria-describedby": "accounting-error" } : {})}
                />
              )}
            />
            {errors.accountingRequired && (
              <p id="accounting-error" role="alert" className="text-xs text-danger">
                {errors.accountingRequired.message}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Checkbox
              id="isSpecialTaxpayer"
              label="Es contribuyente especial"
              {...form.register("isSpecialTaxpayer")}
            />
            {isSpecial && (
              <FormField
                id="specialTaxpayerNumber"
                label="Número de contribuyente especial"
                error={errors.specialTaxpayerNumber?.message}
              >
                <Input
                  {...fieldAria("specialTaxpayerNumber", errors.specialTaxpayerNumber?.message)}
                  {...form.register("specialTaxpayerNumber")}
                  className="max-w-xs"
                />
              </FormField>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Checkbox
              id="isWithholdingAgent"
              label="Es agente de retención"
              {...form.register("isWithholdingAgent")}
            />
            {isWithholding && (
              <FormField
                id="withholdingAgentResolution"
                label="Número de resolución de agente de retención"
                hint="Solo el número de la resolución, hasta 8 dígitos."
                error={errors.withholdingAgentResolution?.message}
              >
                <Input
                  {...fieldAria(
                    "withholdingAgentResolution",
                    errors.withholdingAgentResolution?.message,
                    "Solo el número de la resolución, hasta 8 dígitos.",
                  )}
                  {...form.register("withholdingAgentResolution")}
                  inputMode="numeric"
                  className="max-w-xs"
                />
              </FormField>
            )}
          </div>
          <Checkbox
            id="largeTaxpayer"
            label="Es gran contribuyente"
            {...form.register("largeTaxpayer")}
          />
          <div className="flex flex-col gap-1">
            <span id="rimpe-label" className="text-sm font-medium">
              Régimen RIMPE
            </span>
            <Controller
              control={form.control}
              name="rimpeCategory"
              render={({ field }) => (
                <SelectionCardGroup
                  options={RIMPE_OPTIONS}
                  value={field.value}
                  onChange={field.onChange}
                  aria-labelledby="rimpe-label"
                />
              )}
            />
          </div>
        </Section>

        <Section
          id="proveedor"
          title="Proveedor del sistema"
          description="Solo si un tercero te provee este sistema de facturación."
        >
          <FormField
            id="providerRuc"
            label="RUC proveedor (opcional)"
            hint="Solo si un tercero te provee este sistema (Anexo 26). Déjalo vacío si no aplica."
            error={errors.providerRuc?.message}
          >
            <Input
              {...fieldAria(
                "providerRuc",
                errors.providerRuc?.message,
                "Solo si un tercero te provee este sistema (Anexo 26). Déjalo vacío si no aplica.",
              )}
              {...form.register("providerRuc")}
              inputMode="numeric"
              autoComplete="off"
              className="max-w-xs"
            />
          </FormField>
        </Section>
      </div>

      {conflict && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm"
        >
          <span>Otro administrador cambió los datos. Recarga para ver la versión vigente.</span>
          <Button variant="outline" size="legacy-sm" onClick={() => void reload()}>
            Recargar
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-6">
        <p className="flex flex-col text-sm text-foreground-muted">
          {taxpayer.version !== null && <span>Versión {taxpayer.version}</span>}
          <span>Los cambios aplican a los comprobantes que se emitan después.</span>
        </p>
        {/* Pendiente también mientras se valida: un doble clic no envía dos veces. */}
        <AsyncButton
          type="submit"
          pending={save.isPending || form.formState.isSubmitting}
          pendingLabel="Guardando los datos"
        >
          Guardar datos
        </AsyncButton>
      </div>
    </form>
  );
}

/** El título de la pantalla, solo para los lectores de pantalla: la pestaña ya lo muestra. */
function CompanyTitle() {
  return (
    <h1 id="empresa-titulo" className="sr-only">
      Empresa
    </h1>
  );
}

export function CompanyScreen() {
  const { me } = useSession();
  const allowed = canSee(me.role, "taxpayer.read");
  const taxpayer = useTaxpayer(allowed);

  if (!allowed) {
    return (
      <section aria-labelledby="empresa-titulo" className="flex flex-col gap-6">
        <CompanyTitle />
        <EmptyState
          kind="no-permission"
          title="No tienes permiso para ver esta sección"
          description="Pide a un administrador que configure los datos de la empresa."
        />
      </section>
    );
  }
  if (taxpayer.isPending) return <CompanySkeleton />;
  if (taxpayer.isError) {
    return (
      <section aria-labelledby="empresa-titulo" className="flex flex-col gap-6">
        <CompanyTitle />
        <ErrorState
          message={errorMessage(taxpayer.error)}
          onRetry={() => void taxpayer.refetch()}
        />
      </section>
    );
  }

  const view = taxpayer.data;
  return (
    <section aria-labelledby="empresa-titulo" className="flex flex-col gap-6">
      <CompanyTitle />
      {!view.configured && (
        <p className="text-sm text-foreground-muted">
          Registra los datos con que tu empresa emitirá.
        </p>
      )}
      <CompanyForm taxpayer={view} />
    </section>
  );
}

export function CompanySkeleton() {
  return (
    <section aria-busy="true" className="@container flex flex-col gap-6">
      <h1 className="sr-only">Empresa</h1>
      <div className="grid gap-4 @settings-split:grid-cols-3 @settings-split:gap-8">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-full" />
        </div>
        <div className="flex flex-col gap-4 @settings-split:col-span-2">
          <Skeleton className="size-20" />
          <Skeleton className="h-10 w-full max-w-xs" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    </section>
  );
}
