// SemanticToaster y useMutationFeedback (feedback-and-states.md): un único sistema de toasts y un
// único camino de mutación que posee el estado pendiente, el resultado, la invalidación y el
// mapeo de códigos de error del backend a mensajes de negocio.
"use client";

import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { Toaster, toast } from "sonner";
import { isUnauthenticated } from "@/components/session";
import { ApiError } from "@/lib/api";

export function SemanticToaster() {
  const { resolvedTheme } = useTheme();
  return (
    <Toaster
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      position="bottom-right"
      closeButton
      richColors
      // Siempre desplegados: un aviso nuevo no tapa la acción Deshacer de uno anterior.
      expand
      offset={16}
      mobileOffset={16}
      toastOptions={{ className: "text-sm" }}
    />
  );
}

export { toast };

export type SuccessFeedback =
  string | { message: string; action?: { label: string; onClick: () => void } };

const GENERIC_ERROR = "No pudimos completar la operación. Intenta de nuevo.";

/** Mensaje de negocio para un error: el del backend si es conocido, nunca el detalle técnico. */
export function errorMessage(error: unknown, overrides: Record<string, string> = {}): string {
  if (error instanceof ApiError) {
    if (overrides[error.code]) return overrides[error.code] as string;
    if (
      error.status === 400 ||
      error.status === 403 ||
      error.status === 404 ||
      error.status === 409
    ) {
      return error.message;
    }
    return error.requestId ? `${GENERIC_ERROR} Referencia: ${error.requestId}.` : GENERIC_ERROR;
  }
  if (error instanceof Error && error.name === "AuthError") return error.message;
  return GENERIC_ERROR;
}

export function useMutationFeedback<TVariables, TResult>({
  mutationFn,
  success,
  invalidate = [],
  errorMessages,
  onSuccess,
  onError,
}: {
  mutationFn: (variables: TVariables) => Promise<TResult>;
  success: (result: TResult, variables: TVariables) => SuccessFeedback;
  invalidate?: QueryKey[];
  errorMessages?: Record<string, string>;
  onSuccess?: (result: TResult, variables: TVariables) => void;
  /** Devuelve true si el llamador mostró el error junto al campo, para no repetirlo en un toast. */
  onError?: (error: unknown) => boolean;
}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async (result, variables) => {
      await Promise.all(invalidate.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
      const feedback = success(result, variables);
      const { message, action } =
        typeof feedback === "string" ? { message: feedback, action: undefined } : feedback;
      toast.success(message, {
        id: message,
        ...(action ? { action, duration: 10_000 } : {}),
      });
      onSuccess?.(result, variables);
    },
    onError: (error) => {
      // La sesión vencida la resuelve el manejador global, que lleva al inicio de sesión.
      if (isUnauthenticated(error)) return;
      if (onError?.(error)) return;
      const message = errorMessage(error, errorMessages);
      toast.error(message, { id: message });
    },
  });
}
