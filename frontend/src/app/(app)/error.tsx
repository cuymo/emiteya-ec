// Error inesperado de una pantalla autenticada (adopt-premium-design-foundation-and-shell, design D16).
// El shell sigue visible porque vive en el layout. El mensaje es fijo: nunca se muestra `error.message`,
// su traza ni su `digest`.
"use client";

import { RouteError } from "@/components/route-states/route-states";

export default function ScreenError({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <RouteError onRetry={retry} />;
}
