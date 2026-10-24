// Mi cuenta como página de perfil (redesign-account-profile, design D8, con el ajuste del propietario
// del 2026-10-24). Usuario: cualquiera. Objetivo: confirmar con qué cuenta trabaja y corregir su
// nombre, su foto, su contraseña o su punto predeterminado. Arriba, el avatar con el nombre, el
// correo y las insignias de la cuenta; debajo, las pestañas «Datos», «Cambiar contraseña» y
// «Establecimiento predeterminado», con la elegida en la dirección (`?pestana=`).
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { changeOwnNameSchema, type ChangeOwnPasswordInput } from "@facturador/contracts";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { AsyncButton } from "@/components/async-button";
import { useMutationFeedback } from "@/components/feedback";
import { fieldAria, FormField } from "@/components/form-dialog";
import { PasswordField } from "@/components/password-field";
import { useSession } from "@/components/session";
import { Input } from "@/components/ui/input";
import { useCompanyStatus } from "@/features/company/company-api";
import { DocumentDetailTabs } from "@/features/documents/document-detail-tabs";
import { ApiError } from "@/lib/api";
import { AuthError, changeOwnPassword } from "@/lib/auth-client";
import { ROLE_LABELS } from "@/lib/permissions";
import { DefaultPointSection } from "./default-point-section";
import { ProfileHeader } from "./profile-header";
import { useChangeName, useOwnProfile } from "./profile-api";

// La longitud de la contraseña es configuración del despliegue: la valida el servidor, cuyo mensaje
// indica el valor vigente. El cliente solo exige ambos campos.
const schema = z.strictObject({
  currentPassword: z.string().min(1, "Escribe tu contraseña actual."),
  newPassword: z.string().min(1, "Escribe la contraseña nueva."),
});

const FULL_DATE = new Intl.DateTimeFormat("es-EC", {
  dateStyle: "long",
  timeZone: "America/Guayaquil",
});

/** «Datos»: el nombre editable y, de solo lectura, el correo, el rol, el estado y la empresa. */
function AccountDetails() {
  const { me } = useSession();
  const profile = useOwnProfile();
  const company = useCompanyStatus().data?.displayName;
  const form = useForm<{ name: string }>({
    resolver: zodResolver(changeOwnNameSchema),
    values: { name: profile.data?.name ?? me.name },
  });
  const { errors, isDirty } = form.formState;
  const change = useChangeName({
    onError: (cause) => {
      if (cause instanceof ApiError && cause.status === 400) {
        form.setError("name", { message: cause.message }, { shouldFocus: true });
        return true;
      }
      return false;
    },
  });
  const data = profile.data;
  return (
    <div className="flex flex-col gap-6 pt-2">
      <form
        aria-labelledby="nombre-titulo"
        noValidate
        onSubmit={form.handleSubmit(({ name }) => change.mutate(name))}
        className="flex flex-col gap-3"
      >
        <h2 id="nombre-titulo" className="text-lg font-semibold">
          Tus datos
        </h2>
        <FormField id="account-name" label="Nombre" error={errors.name?.message}>
          <Input
            {...fieldAria("account-name", errors.name?.message)}
            {...form.register("name")}
            autoComplete="name"
          />
        </FormField>
        <div>
          <AsyncButton
            type="submit"
            pending={change.isPending}
            pendingLabel="Guardando el nombre"
            disabled={!isDirty}
          >
            Guardar nombre
          </AsyncButton>
        </div>
      </form>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
        <dt className="text-foreground-muted">Correo</dt>
        <dd className="flex flex-col gap-0.5">
          <span className="break-words">{me.email}</span>
          <span className="text-xs text-foreground-muted">
            Es tu usuario para iniciar sesión; por ahora no se puede cambiar.
          </span>
        </dd>
        <dt className="text-foreground-muted">Rol</dt>
        <dd>{ROLE_LABELS[me.role]}</dd>
        {data && (
          <>
            <dt className="text-foreground-muted">Estado</dt>
            <dd>{data.membershipStatus === "ACTIVE" ? "Activa" : "Desactivada"}</dd>
            <dt className="text-foreground-muted">Cuenta desde</dt>
            <dd>{FULL_DATE.format(new Date(data.memberSince))}</dd>
          </>
        )}
        {company && (
          <>
            <dt className="text-foreground-muted">Empresa</dt>
            <dd className="break-words">{company}</dd>
          </>
        )}
      </dl>
    </div>
  );
}

/** «Cambiar contraseña»: pide la actual y cierra las demás sesiones. */
function PasswordTab() {
  const form = useForm<ChangeOwnPasswordInput>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: "", newPassword: "" },
  });
  const { errors } = form.formState;

  const change = useMutationFeedback({
    mutationFn: ({ currentPassword, newPassword }: ChangeOwnPasswordInput) =>
      changeOwnPassword(currentPassword, newPassword),
    success: () => "Cambiaste tu contraseña. Cerramos tus demás sesiones.",
    onSuccess: () => form.reset(),
    onError: (cause) => {
      if (cause instanceof AuthError && cause.kind === "invalid_current_password") {
        form.setError("currentPassword", { message: cause.message }, { shouldFocus: true });
        return true;
      }
      if (cause instanceof AuthError && cause.kind === "password_policy") {
        form.setError("newPassword", { message: cause.message }, { shouldFocus: true });
        return true;
      }
      return false;
    },
  });

  return (
    <form
      aria-labelledby="contrasena-titulo"
      noValidate
      onSubmit={form.handleSubmit((input) => change.mutate(input))}
      className="flex flex-col gap-4 pt-2"
    >
      <div className="flex flex-col gap-1">
        <h2 id="contrasena-titulo" className="text-lg font-semibold">
          Cambiar contraseña
        </h2>
        <p className="text-sm text-foreground-muted">
          Al cambiarla se cerrarán tus sesiones en otros dispositivos.
        </p>
      </div>
      <FormField
        id="current-password"
        label="Contraseña actual"
        error={errors.currentPassword?.message}
      >
        <PasswordField
          {...fieldAria("current-password", errors.currentPassword?.message)}
          {...form.register("currentPassword")}
          autoComplete="current-password"
        />
      </FormField>
      <FormField id="new-password" label="Contraseña nueva" error={errors.newPassword?.message}>
        <PasswordField
          {...fieldAria("new-password", errors.newPassword?.message)}
          {...form.register("newPassword")}
          autoComplete="new-password"
        />
      </FormField>
      <div>
        <AsyncButton
          type="submit"
          pending={change.isPending}
          pendingLabel="Cambiando la contraseña"
        >
          Cambiar contraseña
        </AsyncButton>
      </div>
    </form>
  );
}

export function AccountScreen() {
  return (
    <section aria-labelledby="cuenta-titulo" data-page-width="form" className="flex flex-col gap-8">
      <ProfileHeader />
      <DocumentDetailTabs
        label="Secciones de tu cuenta"
        param="pestana"
        tabs={[
          { id: "datos", label: "Datos", content: <AccountDetails /> },
          { id: "contrasena", label: "Cambiar contraseña", content: <PasswordTab /> },
          {
            id: "establecimiento",
            label: "Establecimiento predeterminado",
            content: (
              <div className="pt-2">
                <DefaultPointSection />
              </div>
            ),
          },
        ]}
      />
    </section>
  );
}
