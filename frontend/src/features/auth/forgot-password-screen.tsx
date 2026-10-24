// Recuperar la contraseña (add-password-reset-by-email, design D6). Usuario: quien olvidó su
// contraseña, sin sesión. Objetivo: recibir el enlace para poner una nueva. Acción principal: «Enviar
// enlace». La respuesta es siempre la misma, exista o no la cuenta: nunca revela si el correo está
// registrado, si la cuenta está activa ni si su empresa tiene el correo configurado.
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { MailCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { AsyncButton } from "@/components/async-button";
import { fieldAria, FormField } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthError, requestPasswordReset } from "@/lib/auth-client";
import { AuthCard } from "./auth-card";

const schema = z.object({ email: z.email({ error: "Escribe tu correo." }) });
type ForgotForm = z.infer<typeof schema>;

const BACK = (
  <Link
    href="/iniciar-sesion"
    className="font-medium text-primary underline-offset-4 hover:underline"
  >
    Volver a iniciar sesión
  </Link>
);

export function ForgotPasswordScreen() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<ForgotForm>({ resolver: zodResolver(schema), defaultValues: { email: "" } });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async ({ email }) => {
    setError(null);
    try {
      await requestPasswordReset(email.trim());
      setSent(true);
    } catch (cause) {
      setError(
        cause instanceof AuthError
          ? cause.message
          : "No pudimos enviar la solicitud. Intenta de nuevo.",
      );
    }
  });

  if (sent) {
    return (
      <AuthCard title="Revisa tu correo" footer={BACK}>
        <div role="status" className="flex flex-col gap-4 text-sm">
          <span className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <MailCheck aria-hidden="true" className="size-5" />
          </span>
          <p>
            Si el correo pertenece a una cuenta activa y tu empresa tiene el correo configurado, te
            enviamos un enlace para poner una contraseña nueva. Vence en 30 minutos y sirve una sola
            vez.
          </p>
          <p className="text-foreground-muted">
            Si no llega en unos minutos, revisa el correo no deseado o pide a un administrador de tu
            empresa que te ponga una contraseña nueva.
          </p>
          <Button asChild variant="outline" className="w-full">
            <Link href="/iniciar-sesion">Volver a iniciar sesión</Link>
          </Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Recuperar tu contraseña"
      description="Escribe el correo de tu cuenta y te enviaremos un enlace para poner una contraseña nueva."
      footer={BACK}
    >
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
          pendingLabel="Enviando el enlace"
          className="w-full"
        >
          Enviar enlace
        </AsyncButton>
      </form>
    </AuthCard>
  );
}
