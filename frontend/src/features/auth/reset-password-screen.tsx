// Poner una contraseña nueva con el enlace (add-password-reset-by-email, design D2 y D6). El token
// llega en el fragmento de la dirección, que no viaja al servidor ni en el `Referer`: la pantalla lo
// lee, lo quita de la dirección y lo envía en el cuerpo. Al guardarla, el servidor cierra todas las
// sesiones de la cuenta. Un enlace vencido, usado o incompleto ofrece pedir otro.
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CircleCheck, LinkIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { AsyncButton } from "@/components/async-button";
import { fieldAria, FormField } from "@/components/form-dialog";
import { PasswordField } from "@/components/password-field";
import { Skeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { AuthError, resetPassword } from "@/lib/auth-client";
import { AuthCard } from "./auth-card";

const schema = z
  .object({
    password: z.string().min(1, "Escribe la contraseña nueva."),
    confirmation: z.string().min(1, "Repite la contraseña nueva."),
  })
  .refine((values) => values.password === values.confirmation, {
    path: ["confirmation"],
    message: "Las contraseñas no coinciden.",
  });
type ResetForm = z.infer<typeof schema>;

/** El token del fragmento `#token=…`, o null si no viene. */
export function tokenFromHash(hash: string): string | null {
  const value = new URLSearchParams(hash.replace(/^#/, "")).get("token");
  return value ? value : null;
}

/** El token del enlace, leído una sola vez en el navegador; `undefined` mientras no se leyó. */
let captured: string | null | undefined;

function capturedToken(): string | null {
  if (captured === undefined) captured = tokenFromHash(window.location.hash);
  return captured;
}

/** Para las pruebas: olvida el token leído. */
export function forgetCapturedToken() {
  captured = undefined;
}

const subscribe = () => () => {};

const BACK = (
  <Link
    href="/iniciar-sesion"
    className="font-medium text-primary underline-offset-4 hover:underline"
  >
    Volver a iniciar sesión
  </Link>
);

export function ResetPasswordScreen() {
  // En el servidor no hay fragmento: la pantalla espera al navegador para leerlo.
  const token = useSyncExternalStore(subscribe, capturedToken, () => undefined);
  const [outcome, setOutcome] = useState<"invalid" | "done" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const state = outcome ?? (token === undefined ? "reading" : token === null ? "invalid" : "form");
  const form = useForm<ResetForm>({
    resolver: zodResolver(schema),
    defaultValues: { password: "", confirmation: "" },
  });
  const { errors, isSubmitting } = form.formState;

  // Ya leído, el fragmento se quita de la dirección y del historial: el token no queda a la vista ni
  // se comparte al copiar la dirección.
  useEffect(() => {
    if (token !== undefined && window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, [token]);

  const onSubmit = form.handleSubmit(async ({ password }) => {
    if (!token) return setOutcome("invalid");
    setError(null);
    try {
      await resetPassword(token, password);
      setOutcome("done");
    } catch (cause) {
      if (cause instanceof AuthError && cause.kind === "invalid_token") {
        return setOutcome("invalid");
      }
      if (cause instanceof AuthError && cause.kind === "password_policy") {
        form.setError("password", { message: cause.message });
        form.setFocus("password");
        return;
      }
      setError(
        cause instanceof AuthError
          ? cause.message
          : "No pudimos guardar la contraseña. Intenta de nuevo.",
      );
    }
  });

  if (state === "reading") {
    return (
      <AuthCard title="Poner una contraseña nueva" busy>
        <div className="flex flex-col gap-4">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </AuthCard>
    );
  }

  if (state === "invalid") {
    return (
      <AuthCard title="El enlace ya no sirve" footer={BACK}>
        <div role="alert" className="flex flex-col gap-4 text-sm">
          <span className="flex size-10 items-center justify-center rounded-full bg-warning/15 text-warning">
            <LinkIcon aria-hidden="true" className="size-5" />
          </span>
          <p>
            El enlace venció, ya se usó o está incompleto. Los enlaces sirven una sola vez y durante
            30 minutos.
          </p>
          <Button asChild className="w-full">
            <Link href="/recuperar-contrasena">Pedir otro enlace</Link>
          </Button>
        </div>
      </AuthCard>
    );
  }

  if (state === "done") {
    return (
      <AuthCard title="Tu contraseña cambió">
        <div role="status" className="flex flex-col gap-4 text-sm">
          <span className="flex size-10 items-center justify-center rounded-full bg-success/15 text-success">
            <CircleCheck aria-hidden="true" className="size-5" />
          </span>
          <p>Cerramos las sesiones abiertas de tu cuenta. Inicia sesión con tu contraseña nueva.</p>
          <Button asChild className="w-full">
            <Link href="/iniciar-sesion">Iniciar sesión</Link>
          </Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Poner una contraseña nueva"
      description="Elige una contraseña nueva para tu cuenta. Al guardarla se cerrarán tus sesiones abiertas."
      footer={BACK}
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <FormField id="password" label="Contraseña nueva" error={errors.password?.message}>
          <PasswordField
            {...fieldAria("password", errors.password?.message)}
            {...form.register("password")}
            autoComplete="new-password"
          />
        </FormField>
        <FormField
          id="confirmation"
          label="Repite la contraseña nueva"
          error={errors.confirmation?.message}
        >
          <PasswordField
            {...fieldAria("confirmation", errors.confirmation?.message)}
            {...form.register("confirmation")}
            autoComplete="new-password"
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
        <AsyncButton
          type="submit"
          pending={isSubmitting}
          pendingLabel="Guardando la contraseña"
          className="w-full"
        >
          Guardar contraseña
        </AsyncButton>
      </form>
    </AuthCard>
  );
}
