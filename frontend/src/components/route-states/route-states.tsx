// Estados de ruta compartidos (adopt-premium-design-foundation-and-shell, design D16; spec
// web-application-shell, «Carga de una pantalla», «Error inesperado en una pantalla», «Dirección
// inexistente» y «Destino no permitido»). Componen los primitivos derivados de la plantilla `empty`,
// `button` y `skeleton`, con mensajes fijos en español: nunca muestran detalles técnicos, trazas, JSON
// ni identificadores internos.
import { FileQuestion, Lock, TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";

/** Mientras una pantalla carga: el esqueleto de su cabecera y su contenido, anunciado. */
export function RouteLoading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <span className="sr-only" role="status">
        Cargando la pantalla
      </span>
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-9 w-full max-w-md" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

function RouteMessage({
  icon,
  title,
  description,
  action,
  alert = false,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action: ReactNode;
  alert?: boolean;
}) {
  return (
    <Empty className="min-h-80" role={alert ? "alert" : undefined}>
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle asChild>
          <h1 className="text-xl font-semibold">{title}</h1>
        </EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>{action}</EmptyContent>
    </Empty>
  );
}

function HomeLink() {
  return (
    <Button asChild variant="outline" size="default">
      <Link href="/">Ir a Inicio</Link>
    </Button>
  );
}

/** Una pantalla falló de forma inesperada: un mensaje comprensible y la opción de reintentar. */
export function RouteError({ onRetry }: { onRetry: () => void }) {
  return (
    <RouteMessage
      alert
      icon={<TriangleAlert aria-hidden="true" />}
      title="No pudimos mostrar esta pantalla"
      description="Ocurrió un error inesperado. Puedes intentarlo de nuevo o ir a otra sección."
      action={
        <Button variant="outline" size="default" onClick={onRetry}>
          Intentar de nuevo
        </Button>
      }
    />
  );
}

/** La dirección no corresponde a ninguna pantalla. */
export function RouteNotFound() {
  return (
    <RouteMessage
      icon={<FileQuestion aria-hidden="true" />}
      title="Esta página no existe"
      description="La dirección que abriste no corresponde a ninguna pantalla de EmiteYa."
      action={<HomeLink />}
    />
  );
}

/** El rol de la sesión no permite este destino. La API sigue rechazando la operación. */
export function RouteForbidden() {
  return (
    <RouteMessage
      icon={<Lock aria-hidden="true" />}
      title="No tienes acceso a esta sección"
      description="Tu rol no permite usar esta sección. Si la necesitas, pídele acceso a un administrador."
      action={<HomeLink />}
    />
  );
}
