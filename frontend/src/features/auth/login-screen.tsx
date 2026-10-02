// Iniciar sesión (design D12). Usuario: cualquiera, también quien entra por primera vez. Objetivo:
// entrar. Información mínima: correo, contraseña y error si ocurre. Acción principal: Iniciar sesión.
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { AsyncButton } from "@/components/async-button";
import { fieldAria, FormField } from "@/components/form-dialog";
import { PasswordField } from "@/components/password-field";
import { Skeleton } from "@/components/states";
import { ME_KEY, useMe } from "@/components/session";
import { Input } from "@/components/ui/input";
import { AuthError, safeNextPath, signIn } from "@/lib/auth-client";

const loginSchema = z.object({
  email: z.email({ error: "Escribe tu correo." }),
  password: z.string().min(1, "Escribe tu contraseña."),
});
type LoginForm = z.infer<typeof loginSchema>;

export function LoginScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const next = safeNextPath(params.get("siguiente"));
  const expired = params.get("motivo") === "sesion";
  const [error, setError] = useState<string | null>(null);
  const me = useMe();

  // Con una sesión activa no se pide iniciar sesión otra vez.
  useEffect(() => {
    if (me.data) router.replace(next);
  }, [me.data, next, router]);

  const form = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async ({ email, password }) => {
    setError(null);
    try {
      await signIn(email, password);
      await queryClient.invalidateQueries({ queryKey: ME_KEY });
      router.replace(next);
    } catch (cause) {
      setError(
        cause instanceof AuthError ? cause.message : "No pudimos iniciar sesión. Intenta de nuevo.",
      );
      form.setValue("password", "");
      form.setFocus("password");
    }
  });

  return (
    <main
      id="contenido"
      className="flex min-h-dvh items-center justify-center bg-background px-2 py-6"
    >
      <div className="flex w-full max-w-sm flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <p className="text-sm font-semibold text-foreground-muted">Facturador SRI</p>
          <h1 className="text-3xl font-bold">Iniciar sesión</h1>
        </div>
        {expired && !error && (
          <p
            role="status"
            className="rounded-md border border-info/40 bg-info/10 px-1.5 py-1 text-sm"
          >
            Tu sesión terminó. Inicia sesión de nuevo para continuar.
          </p>
        )}
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-2">
          <FormField id="email" label="Correo" error={errors.email?.message}>
            <Input
              {...fieldAria("email", errors.email?.message)}
              {...form.register("email")}
              type="email"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
            />
          </FormField>
          <FormField id="password" label="Contraseña" error={errors.password?.message}>
            <PasswordField
              {...fieldAria("password", errors.password?.message)}
              {...form.register("password")}
              autoComplete="current-password"
            />
          </FormField>
          {error && (
            <p
              role="alert"
              className="rounded-md border border-danger/40 bg-danger/10 px-1.5 py-1 text-sm"
            >
              {error}
            </p>
          )}
          <AsyncButton
            type="submit"
            pending={isSubmitting}
            pendingLabel="Iniciando sesión"
            className="w-full"
          >
            Iniciar sesión
          </AsyncButton>
        </form>
        <p className="text-sm text-foreground-muted">
          ¿Olvidaste tu contraseña? Pide a un administrador que la restablezca.
        </p>
      </div>
    </main>
  );
}

/** Misma geometría que la pantalla mientras se leen los parámetros de la URL. */
export function LoginSkeleton() {
  return (
    <main
      className="flex min-h-dvh items-center justify-center bg-background px-2 py-6"
      aria-busy="true"
    >
      <div className="flex w-full max-w-sm flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <p className="text-sm font-semibold text-foreground-muted">Facturador SRI</p>
          <h1 className="text-3xl font-bold">Iniciar sesión</h1>
        </div>
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-5 w-full" />
      </div>
    </main>
  );
}
