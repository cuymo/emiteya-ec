// Mi cuenta (design D12). Usuario: cualquiera. Objetivo: ver su acceso y cambiar su contraseña.
// Página completa porque no es una fila de ninguna tabla. P0: cambio de contraseña. P1: nombre,
// correo y rol como etiquetas de solo lectura. Acción principal: Cambiar contraseña.
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  DEFAULT_PASSWORD_POLICY,
  userSchemas,
  type ChangeOwnPasswordInput,
} from "@facturador/contracts";
import { useForm } from "react-hook-form";
import { AsyncButton } from "@/components/async-button";
import { useMutationFeedback } from "@/components/feedback";
import { fieldAria, FormField } from "@/components/form-dialog";
import { PasswordField } from "@/components/password-field";
import { useSession } from "@/components/session";
import { AuthError, changeOwnPassword } from "@/lib/auth-client";
import { ROLE_LABELS } from "@/lib/permissions";

const schema = userSchemas(DEFAULT_PASSWORD_POLICY).changeOwnPassword;
const HINT = `Entre ${DEFAULT_PASSWORD_POLICY.minLength} y ${DEFAULT_PASSWORD_POLICY.maxLength} caracteres.`;

export function AccountScreen() {
  const { me } = useSession();
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
        form.setError(
          "newPassword",
          { message: `${cause.message} ${HINT}` },
          { shouldFocus: true },
        );
        return true;
      }
      return false;
    },
  });

  return (
    <section aria-labelledby="cuenta-titulo" className="flex max-w-xl flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 id="cuenta-titulo" className="text-3xl font-bold">
          Mi cuenta
        </h1>
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-sm">
          <dt className="text-foreground-muted">Nombre</dt>
          <dd className="break-words">{me.name}</dd>
          <dt className="text-foreground-muted">Correo</dt>
          <dd className="break-words">{me.email}</dd>
          <dt className="text-foreground-muted">Rol</dt>
          <dd>{ROLE_LABELS[me.role]}</dd>
        </dl>
      </div>

      <form
        aria-labelledby="contrasena-titulo"
        noValidate
        onSubmit={form.handleSubmit((input) => change.mutate(input))}
        className="flex flex-col gap-2"
      >
        <div className="flex flex-col gap-0.5">
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
        <FormField
          id="new-password"
          label="Contraseña nueva"
          hint={HINT}
          error={errors.newPassword?.message}
        >
          <PasswordField
            {...fieldAria("new-password", errors.newPassword?.message, HINT)}
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
    </section>
  );
}
