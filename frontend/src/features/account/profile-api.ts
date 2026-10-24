// Perfil y avatar propios (redesign-account-profile, design D1, D6 y D7). El perfil se lee con una
// sola consulta, que comparten «Mi cuenta» y el menú de cuenta. La foto se reduce en el navegador a
// 512 px por el lado mayor antes de subirla; sin `createImageBitmap` (jsdom, navegadores antiguos)
// se sube tal cual y manda el límite del servidor.
"use client";

import { useQuery } from "@tanstack/react-query";
import { ownProfileSchema } from "@facturador/contracts";
import { useMutationFeedback } from "@/components/feedback";
import { apiFetch } from "@/lib/api";

export const PROFILE_KEY = ["me", "profile"] as const;

/** La foto propia, con su versión en la URL para que un cambio no quede en la caché. */
export const avatarSrc = (version: string) => `/api/v1/me/avatar?v=${encodeURIComponent(version)}`;

export const AVATAR_ACCEPT = ["image/png", "image/jpeg"] as const;
export const AVATAR_ACCEPT_LABEL = "PNG o JPEG";
const AVATAR_SIDE = 512;

export function useOwnProfile(enabled = true) {
  return useQuery({
    queryKey: PROFILE_KEY,
    enabled,
    staleTime: 60_000,
    queryFn: ({ signal }) => apiFetch("/me/profile", { schema: ownProfileSchema, signal }),
  });
}

/**
 * Reduce la imagen a 512 px por el lado mayor y la vuelve a codificar: PNG se queda en PNG, por la
 * transparencia; lo demás, JPEG. Sin las APIs del navegador, o si algo falla, devuelve el archivo.
 */
export async function shrinkAvatar(file: Blob): Promise<Blob> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, AVATAR_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const type = file.type === "image/png" ? "image/png" : "image/jpeg";
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, type, type === "image/jpeg" ? 0.9 : undefined),
    );
    return blob ?? file;
  } catch {
    return file;
  }
}

export function useReplaceAvatar(options: { onError: (error: unknown) => boolean }) {
  return useMutationFeedback({
    mutationFn: (image: Blob) =>
      apiFetch("/me/avatar", { method: "PUT", binary: image, schema: ownProfileSchema }),
    success: () => "Actualizaste tu foto de perfil.",
    invalidate: [PROFILE_KEY],
    onError: options.onError,
  });
}

export function useRemoveAvatar() {
  return useMutationFeedback({
    mutationFn: () => apiFetch("/me/avatar", { method: "DELETE", schema: ownProfileSchema }),
    success: () => "Quitaste tu foto de perfil.",
    invalidate: [PROFILE_KEY],
  });
}
