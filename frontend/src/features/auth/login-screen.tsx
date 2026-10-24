// Iniciar sesión (design D12). Usuario: cualquiera, también quien entra por primera vez. Objetivo:
// entrar. Información mínima: correo, contraseña y error si ocurre. Acción principal: Iniciar sesión.
// En la tarjeta con el logo, con «¿Olvidaste tu contraseña?» junto a la contraseña
// (add-password-reset-by-email, design D6).
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
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
import { AuthCard } from "./auth-card";

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
    <AuthCard title="Iniciar sesión" description="Ingresa con tu correo y tu contraseña.">
      <div className="flex flex-col gap-4">
        {expired && !error && (
          <p
            role="status"
            className="rounded-md border border-info/40 bg-info/10 px-3 py-2 text-sm"
          >
            Tu sesión terminó. Inicia sesión de nuevo para continuar.
          </p>
        )}
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <FormField id="email" label="Correo" error={errors.email?.message}>
            <Input
              {...fieldAria("email", errors.email?.message)}
              {...form.register("email")}
              type="email"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="tucorreo@empresa.ec"
            />
          </FormField>
          <FormField
            id="password"
            label="Contraseña"
            error={errors.password?.message}
            labelClassName="justify-between"
            badge={
              <Link
                href="/recuperar-contrasena"
                className="text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                ¿Olvidaste tu contraseña?
              </Link>
            }
          >
            <PasswordField
              {...fieldAria("password", errors.password?.message)}
              {...form.register("password")}
              autoComplete="current-password"
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
            pendingLabel="Iniciando sesión"
            className="w-full"
          >
            Iniciar sesión
          </AsyncButton>
        </form>
      </div>
    </AuthCard>
  );
}

/** Misma geometría que la pantalla mientras se leen los parámetros de la URL. */
export function LoginSkeleton() {
  return (
    <AuthCard title="Iniciar sesión" description="Ingresa con tu correo y tu contraseña." busy>
      <div className="flex flex-col gap-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    </AuthCard>
  );
}
