// Correos (add-email-delivery, design D14). Usuario: administrador, ocasionalmente. Objetivo: que
// los comprobantes autorizados salgan por el servidor de correo de la empresa, y comprobarlo.
// Decisión: si el envío está listo. P0: el estado (listo, desactivado por el despliegue o sin
// configurar) y la prueba. P1: servidor, puerto, seguridad, usuario, contraseña y remitente. P2:
// copia oculta, correo de prueba y envío automático. Todo va en un recuadro centrado bajo las
// pestañas, que ya nombran la pantalla (el título queda para los lectores de pantalla), como Firma:
// el estado arriba y, al pie, «Enviar correo de prueba» como secundaria y «Guardar servidor» como
// principal.
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  updateEmailSettingsSchema,
  type EmailSecurity,
  type EmailSettingsResponse,
  type EmailSettingsView,
  type UpdateEmailSettingsInput,
} from "@facturador/contracts";
import { KeyRound, MailCheck, MailMinus, MailWarning, Send, type LucideIcon } from "lucide-react";
import { useState, type ComponentProps, type ReactNode } from "react";
import { Controller, useForm, type DefaultValues } from "react-hook-form";
import { z } from "zod";
import { AsyncButton } from "@/components/async-button";
import { errorMessage } from "@/components/feedback";
import { fieldAria, FormField } from "@/components/form-dialog";
import { FormGrid } from "@/components/layout/form-grid";
import { PasswordField } from "@/components/password-field";
import { useSession } from "@/components/session";
import {
  EmptyState,
  ErrorState,
  Skeleton,
  StatusBadge,
  type StatusTone,
} from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ApiError } from "@/lib/api";
import { canSee } from "@/lib/permissions";
import { EMAIL_SETTINGS_FIELD_ERRORS, useEmailSettings, useSaveEmailSettings } from "./email-api";
import { EMAIL_SECURITY_DEFAULT_PORTS, EMAIL_SECURITY_LABELS } from "./email-format";
import { TestEmailDialog } from "./test-email-dialog";

const shape = updateEmailSettingsSchema.shape;

// Las reglas de cada campo son las del contrato; aquí solo cambia la contraseña, que vacía se
// conserva: no se envía.
const formSchema = z.object({
  host: shape.host,
  port: shape.port,
  security: shape.security,
  username: shape.username,
  password: z
    .string()
    .transform((value) => (value === "" ? undefined : value))
    .pipe(shape.password),
  fromName: shape.fromName,
  fromAddress: shape.fromAddress,
  bccAddress: shape.bccAddress,
  autoSend: shape.autoSend,
  testRecipient: shape.testRecipient,
});

type FormInput = z.input<typeof formSchema>;
type FormOutput = z.output<typeof formSchema>;

function toFormValues(settings: EmailSettingsView | null): DefaultValues<FormInput> {
  return {
    host: settings?.host ?? "",
    port: settings?.port ?? EMAIL_SECURITY_DEFAULT_PORTS.STARTTLS,
    security: settings?.security ?? "STARTTLS",
    username: settings?.username ?? "",
    password: "",
    fromName: settings?.fromName ?? "",
    fromAddress: settings?.fromAddress ?? "",
    bccAddress: settings?.bccAddress ?? "",
    // Configurar el servidor es para que los comprobantes salgan: sin configuración, propuesto.
    autoSend: settings?.autoSend ?? true,
    testRecipient: settings?.testRecipient ?? "",
  };
}

function toInput(values: FormOutput, expectedVersion: number | null): UpdateEmailSettingsInput {
  const { password, ...rest } = values;
  return { ...rest, ...(password === undefined ? {} : { password }), expectedVersion };
}

type Readiness = { tone: StatusTone; label: string; icon: LucideIcon; text: string };

/** El estado del envío con lo guardado, no con los cambios sin guardar del formulario. */
function readinessOf(response: EmailSettingsResponse): Readiness {
  if (!response.deliveryEnabled) {
    return {
      tone: "neutral",
      label: "Desactivado",
      icon: MailMinus,
      text: "El envío de correos está apagado en este despliegue: puedes guardar el servidor, pero ningún correo sale hasta que el responsable de la instalación lo encienda.",
    };
  }
  if (response.settings === null) {
    return {
      tone: "warning",
      label: "Sin configurar",
      icon: MailWarning,
      text: "Registra el servidor de correo de la empresa para enviar a cada receptor su comprobante autorizado, con el XML y el RIDE.",
    };
  }
  if (!response.settings.autoSend) {
    return {
      tone: "info",
      label: "Listo",
      icon: MailCheck,
      text: "El envío automático está apagado: cada comprobante autorizado se envía a mano desde su detalle.",
    };
  }
  return {
    tone: "success",
    label: "Listo",
    icon: MailCheck,
    text: "Cada comprobante autorizado sale por correo a su receptor, con el XML y el RIDE.",
  };
}

function Checkbox({
  id,
  label,
  ...props
}: { id: string; label: string } & ComponentProps<"input">) {
  return (
    <label htmlFor={id} className="flex min-h-8 items-center gap-2 text-sm font-medium">
      <input id={id} type="checkbox" className="size-4 accent-primary" {...props} />
      {label}
    </label>
  );
}

/** Un grupo de campos del recuadro, con su título. */
function Group({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4 border-t border-border p-4">
      <h2 id={id} className="text-sm font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

const HINTS = {
  security:
    "Tu proveedor de correo indica cuál usar. TLS directo suele ir en el puerto 465 y STARTTLS en el 587.",
  username: "Déjalo vacío si el servidor no pide usuario y contraseña.",
  fromAddress:
    "La dirección desde la que salen los correos: tu servidor debe permitir enviar con ella.",
  bccAddress: "Recibe una copia de cada comprobante enviado, sin que el receptor lo vea.",
  testRecipient:
    "En el ambiente de Pruebas del SRI, los comprobantes van solo a este correo, nunca a tus clientes.",
} as const;

function EmailForm({ response }: { response: EmailSettingsResponse }) {
  const { me } = useSession();
  const settings = response.settings;
  // La versión de la que parte el formulario: la que se cargó, no la última que llegó después.
  const [baseVersion, setBaseVersion] = useState(settings?.version ?? null);
  const [conflict, setConflict] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const query = useEmailSettings(true);
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(formSchema),
    defaultValues: toFormValues(settings),
  });
  const { errors } = form.formState;

  const reload = async () => {
    const fresh = await query.refetch();
    if (fresh.data) {
      form.reset(toFormValues(fresh.data.settings));
      setBaseVersion(fresh.data.settings?.version ?? null);
    }
    setConflict(false);
  };

  const save = useSaveEmailSettings({
    onSuccess: (saved) => {
      form.reset(toFormValues(saved.settings));
      setBaseVersion(saved.settings?.version ?? null);
    },
    onError: (cause) => {
      if (!(cause instanceof ApiError)) return false;
      if (cause.code === "EMAIL_SETTINGS_CHANGED") {
        setConflict(true);
        return true;
      }
      const field =
        EMAIL_SETTINGS_FIELD_ERRORS[cause.code as keyof typeof EMAIL_SETTINGS_FIELD_ERRORS];
      if (field) {
        form.setError(field, { message: cause.message }, { shouldFocus: true });
        return true;
      }
      return false;
    },
  });

  // «Sin cifrado» solo si el despliegue lo admite, o si es lo guardado: el servidor lo rechaza junto
  // al campo en lugar de cambiarlo sin decirlo.
  const securities: EmailSecurity[] =
    response.plaintextAllowed || settings?.security === "NONE"
      ? ["TLS", "STARTTLS", "NONE"]
      : ["TLS", "STARTTLS"];
  const readiness = readinessOf(response);
  const passwordHint = settings?.passwordSet
    ? "Hay una contraseña guardada: déjala vacía para conservarla."
    : undefined;

  return (
    <>
      <form
        noValidate
        aria-label="Servidor de correo"
        onSubmit={form.handleSubmit((values) => save.mutate(toInput(values, baseVersion)))}
        className="flex flex-col rounded-lg border border-border bg-surface"
      >
        <div role="status" className="flex flex-col gap-2 p-4">
          <div>
            <StatusBadge tone={readiness.tone} label={readiness.label} icon={readiness.icon} />
          </div>
          <p className="text-sm">{readiness.text}</p>
          {settings && !settings.testRecipient && (
            <p className="text-sm text-foreground-muted">
              Sin correo de prueba, los comprobantes del ambiente de Pruebas no se envían.
            </p>
          )}
        </div>

        <Group id="correos-servidor" title="Servidor de correo">
          <div className="grid items-start gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
            <FormField id="email-host" label="Servidor" error={errors.host?.message}>
              <Input
                {...fieldAria("email-host", errors.host?.message)}
                {...form.register("host")}
                placeholder="smtp.tuempresa.ec"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
              />
            </FormField>
            <FormField id="email-port" label="Puerto" error={errors.port?.message}>
              <Input
                {...fieldAria("email-port", errors.port?.message)}
                {...form.register("port", { valueAsNumber: true })}
                inputMode="numeric"
                autoComplete="off"
              />
            </FormField>
          </div>
          <FormField
            id="email-security"
            label="Seguridad"
            hint={HINTS.security}
            error={errors.security?.message}
          >
            <Controller
              control={form.control}
              name="security"
              render={({ field }) => (
                <Select
                  {...fieldAria("email-security", errors.security?.message, HINTS.security)}
                  ref={field.ref}
                  name={field.name}
                  value={field.value}
                  onBlur={field.onBlur}
                  onChange={(event) => {
                    const next = event.target.value as EmailSecurity;
                    const port = form.getValues("port");
                    // Un puerto que era el habitual del cifrado anterior pasa al del nuevo.
                    if (Number.isNaN(port) || port === EMAIL_SECURITY_DEFAULT_PORTS[field.value]) {
                      form.setValue("port", EMAIL_SECURITY_DEFAULT_PORTS[next], {
                        shouldDirty: true,
                      });
                    }
                    field.onChange(next);
                  }}
                >
                  {securities.map((security) => (
                    <option key={security} value={security}>
                      {EMAIL_SECURITY_LABELS[security]}
                    </option>
                  ))}
                </Select>
              )}
            />
          </FormField>
          <FormGrid>
            <FormField
              id="email-username"
              label="Usuario (opcional)"
              hint={HINTS.username}
              error={errors.username?.message}
            >
              <Input
                {...fieldAria("email-username", errors.username?.message, HINTS.username)}
                {...form.register("username")}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
              />
            </FormField>
            <FormField
              id="email-password"
              label="Contraseña"
              hint={passwordHint}
              badge={
                settings?.passwordSet ? (
                  <StatusBadge tone="neutral" icon={KeyRound} label="Contraseña guardada" />
                ) : undefined
              }
              error={errors.password?.message}
            >
              <PasswordField
                {...fieldAria("email-password", errors.password?.message, passwordHint)}
                {...form.register("password")}
                autoComplete="new-password"
                placeholder={settings?.passwordSet ? "Déjala vacía para conservarla" : undefined}
              />
            </FormField>
          </FormGrid>
        </Group>

        <Group id="correos-remitente" title="Remitente">
          <FormGrid>
            <FormField id="email-from-name" label="Nombre" error={errors.fromName?.message}>
              <Input
                {...fieldAria("email-from-name", errors.fromName?.message)}
                {...form.register("fromName")}
                autoComplete="organization"
              />
            </FormField>
            <FormField
              id="email-from-address"
              label="Correo"
              hint={HINTS.fromAddress}
              error={errors.fromAddress?.message}
            >
              <Input
                {...fieldAria("email-from-address", errors.fromAddress?.message, HINTS.fromAddress)}
                {...form.register("fromAddress")}
                type="email"
                autoComplete="email"
              />
            </FormField>
          </FormGrid>
          <FormField
            id="email-bcc"
            label="Copia oculta (opcional)"
            hint={HINTS.bccAddress}
            error={errors.bccAddress?.message}
          >
            <Input
              {...fieldAria("email-bcc", errors.bccAddress?.message, HINTS.bccAddress)}
              {...form.register("bccAddress")}
              type="email"
              autoComplete="email"
            />
          </FormField>
        </Group>

        <Group id="correos-envio" title="Envío">
          <FormField
            id="email-test-recipient"
            label="Correo de prueba (opcional)"
            hint={HINTS.testRecipient}
            error={errors.testRecipient?.message}
          >
            <Input
              {...fieldAria(
                "email-test-recipient",
                errors.testRecipient?.message,
                HINTS.testRecipient,
              )}
              {...form.register("testRecipient")}
              type="email"
              autoComplete="email"
            />
          </FormField>
          <div className="flex flex-col gap-1">
            <Checkbox
              id="email-auto-send"
              label="Enviar por correo cada comprobante autorizado"
              aria-describedby="email-auto-send-description"
              {...form.register("autoSend")}
            />
            <p id="email-auto-send-description" className="pl-6 text-sm text-foreground-muted">
              Sale al guardar su RIDE. Apagado, cada comprobante se envía a mano desde su detalle.
            </p>
          </div>
        </Group>

        {conflict && (
          <div className="px-4 pb-4">
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm"
            >
              <span>
                Otro administrador cambió el servidor de correo. Recarga para ver la versión
                vigente.
              </span>
              <Button variant="outline" size="legacy-sm" onClick={() => void reload()}>
                Recargar
              </Button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 rounded-b-lg border-t border-border bg-surface-subtle px-4 py-3">
          {/* La prueba usa el servidor guardado: sin configuración no hay qué probar. */}
          {settings && (
            <Button variant="outline" size="default" onClick={() => setTestOpen(true)}>
              <Send aria-hidden="true" />
              Enviar correo de prueba
            </Button>
          )}
          {/* Pendiente también mientras se valida: un doble clic no envía dos veces. */}
          <AsyncButton
            type="submit"
            size="default"
            pending={save.isPending || form.formState.isSubmitting}
            pendingLabel="Guardando el servidor"
          >
            Guardar servidor
          </AsyncButton>
        </div>
      </form>
      {settings && (
        <TestEmailDialog
          open={testOpen}
          onOpenChange={setTestOpen}
          defaultTo={settings.testRecipient ?? me.email}
          unsavedChanges={form.formState.isDirty}
        />
      )}
    </>
  );
}

export function EmailScreen() {
  const { me } = useSession();
  const allowed = canSee(me.role, "email.configure");
  const query = useEmailSettings(allowed);
  const frame = (children: ReactNode, busy = false) => (
    <section
      aria-labelledby="correos-titulo"
      aria-busy={busy || undefined}
      data-panel-width="form"
      data-panel-align="center"
      className="flex flex-col gap-6"
    >
      <h1 id="correos-titulo" className="sr-only">
        Correos
      </h1>
      {children}
    </section>
  );

  if (!allowed) {
    return frame(
      <EmptyState
        kind="no-permission"
        title="No tienes permiso para ver esta sección"
        description="Solo un administrador configura el servidor de correo de la empresa."
      />,
    );
  }
  if (query.isPending) return frame(<Skeleton className="h-96 w-full" />, true);
  if (query.isError) {
    return frame(
      <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />,
    );
  }
  return frame(<EmailForm response={query.data} />);
}
