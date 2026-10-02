// Sesión del usuario en el cliente (design D12): la cuenta viene de GET /api/v1/me, sin datos de
// Better Auth. Una respuesta 401 durante el uso lleva al inicio de sesión conservando la URL.
"use client";

import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { meSchema, type Me } from "@facturador/contracts";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, use, useEffect, useEffectEvent, useState, type ReactNode } from "react";
import { ErrorState } from "@/components/states";
import { ApiError, apiFetch } from "@/lib/api";
import { AuthError, signOut as signOutRequest } from "@/lib/auth-client";

export const ME_KEY = ["me"] as const;

const unauthenticatedListeners = new Set<() => void>();
/** 401 de la API propia o sesión rechazada por Better Auth: en ambos casos la sesión ya no sirve. */
export const isUnauthenticated = (error: unknown) =>
  (error instanceof ApiError && error.status === 401) ||
  (error instanceof AuthError && error.kind === "unauthenticated");

function createQueryClient() {
  const notify = (error: unknown) => {
    if (isUnauthenticated(error)) unauthenticatedListeners.forEach((listener) => listener());
  };
  return new QueryClient({
    queryCache: new QueryCache({ onError: notify }),
    mutationCache: new MutationCache({ onError: notify }),
    defaultOptions: {
      queries: {
        // Solo se reintentan fallos del servidor o de red, nunca 4xx.
        retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
        refetchOnWindowFocus: false,
      },
    },
  });
}

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(createQueryClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

export function useMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: ({ signal }) => apiFetch("/me", { schema: meSchema, signal }),
    retry: false,
    staleTime: 30_000,
  });
}

type Session = { me: Me; signOut: () => Promise<void> };
const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = use(SessionContext);
  if (!session) throw new Error("useSession fuera de SessionGate");
  return session;
}

export function loginUrl(path: string, expired: boolean): string {
  const params = new URLSearchParams({ siguiente: path });
  if (expired) params.set("motivo", "sesion");
  return `/iniciar-sesion?${params.toString()}`;
}

/** Protege el shell: verifica la sesión sin pantalla en blanco y redirige ante un 401. */
export function SessionGate({ fallback, children }: { fallback: ReactNode; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const queryClient = useQueryClient();
  const me = useMe();

  // Una sesión que existía y deja de autorizar es una sesión vencida; sin sesión previa, no.
  const leave = useEffectEvent(() => {
    const expired = me.data !== undefined;
    queryClient.clear();
    router.replace(loginUrl(search ? `${pathname}?${search}` : pathname, expired));
  });

  useEffect(() => {
    const handler = () => leave();
    unauthenticatedListeners.add(handler);
    return () => {
      unauthenticatedListeners.delete(handler);
    };
  }, []);

  const rejected = me.isError && isUnauthenticated(me.error);
  useEffect(() => {
    if (rejected) leave();
  }, [rejected]);

  const [session] = useState(() => ({
    signOut: async () => {
      await signOutRequest().catch(() => {});
      queryClient.clear();
      router.replace("/iniciar-sesion");
    },
  }));

  if (me.isError && !rejected) {
    return <ErrorState message="No pudimos cargar tu cuenta." onRetry={() => void me.refetch()} />;
  }
  if (!me.data) return fallback;
  return (
    <SessionContext value={{ me: me.data, signOut: session.signOut }}>{children}</SessionContext>
  );
}
