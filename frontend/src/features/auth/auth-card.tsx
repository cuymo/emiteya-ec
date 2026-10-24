// La tarjeta de las pantallas sin sesión (add-password-reset-by-email, design D6): el logo y el nombre
// de EmiteYa arriba, el título de la pantalla, su ayuda y su contenido, sobre un degradado azul suave.
// Toma la composición de la tarjeta de ingreso de 21st.dev (`login-card-1`), rehecha con las
// primitivas del proyecto.
import type { ReactNode } from "react";
import { BrandLogo } from "@/components/brand-logo";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";

export function AuthCard({
  title,
  description,
  children,
  footer,
  busy = false,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  /** Debajo de la tarjeta, como volver a iniciar sesión. */
  footer?: ReactNode;
  busy?: boolean;
}) {
  return (
    <main
      id="contenido"
      aria-busy={busy || undefined}
      className="flex min-h-dvh items-center justify-center bg-linear-to-b from-primary/8 via-background to-background px-4 py-12"
    >
      <div className="flex w-full max-w-sm flex-col items-center gap-6">
        <p className="flex items-center gap-2.5 text-xl font-semibold text-foreground">
          <BrandLogo className="h-10" />
          EmiteYa
        </p>
        <Card
          data-slot="auth-card"
          className="w-full gap-6 py-6 shadow-sm [--card-spacing:--spacing(6)]"
        >
          <CardHeader className="gap-1.5">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {description && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent>{children}</CardContent>
        </Card>
        {footer && <div className="text-center text-sm text-foreground-muted">{footer}</div>}
      </div>
    </main>
  );
}
